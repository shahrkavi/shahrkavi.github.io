"""
Shahrkavi - Google Earth Historical Imagery Router

Wraps the GEHistoricalImagery CLI (https://github.com/Mbucari/GEHistoricalImagery)
to list imagery dates available for a region (tab 1) and to download the
imagery of a user-specified date (tab 3) as a georeferenced GeoTIFF.

The binary is expected in fastapi/bin/ (win: GEHistoricalImagery.bat,
linux: GEHistoricalImagery) or via the GEHISTORICALIMAGERY_PATH env var.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, field_validator

from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform as shapely_transform

try:
    from pyproj import Transformer
except ImportError:  # pragma: no cover - pyproj ships with rasterio
    Transformer = None

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent
BIN_DIR = BASE_DIR / "bin"
CACHE_DIR = BASE_DIR / "cache"
DOWNLOADS_DIR = BASE_DIR / "downloads"
GEH_CACHE_DIR = BIN_DIR / "cache"

GEH_ENV_LOCK = threading.Lock()
GEH_ENV_OVERRIDES = {
    "GEHistoricalImagery_Cache": str(GEH_CACHE_DIR),
    "GDAL_DATA": str(BIN_DIR / "gdal"),
    "GEOTIFF_CSV": str(BIN_DIR / "gdal"),
    "PROJ_LIB": str(BIN_DIR / "gdal"),
    "PROJ_DATA": str(BIN_DIR / "gdal"),
}

# CLI runtime limits
AVAILABILITY_TIMEOUT = 15 * 60          # seconds
DOWNLOAD_TIMEOUT = 60 * 60              # seconds
MAX_TILES_AVAILABILITY = 60_000
MAX_TILES_DOWNLOAD = 120_000

PROVIDERS = {"tm", "wayback"}


def _run_with_geh_env(cmd, **kwargs):
    """Run a command with GEH-specific env vars applied to os.environ.

    The GEHistoricalImagery exe reads env vars from the process environment
    at startup, bypassing subprocess env= overrides. We must modify
    os.environ directly (under a lock for thread safety), run the command,
    then restore the original values.
    """
    with GEH_ENV_LOCK:
        saved = {}
        for key, value in GEH_ENV_OVERRIDES.items():
            saved[key] = os.environ.get(key)
            os.environ[key] = value
        try:
            return subprocess.run(cmd, **kwargs)
        finally:
            for key, old_val in saved.items():
                if old_val is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = old_val


def _popen_with_geh_env(cmd, **kwargs):
    """Launch a Popen with GEH-specific env vars applied to os.environ."""
    with GEH_ENV_LOCK:
        saved = {}
        for key, value in GEH_ENV_OVERRIDES.items():
            saved[key] = os.environ.get(key)
            os.environ[key] = value
        try:
            proc = subprocess.Popen(cmd, **kwargs)
        finally:
            for key, old_val in saved.items():
                if old_val is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = old_val
    return proc
DATE_MATCHES = {"closest", "exact", "closestbefore", "closestafter"}

GEH_JOBS: Dict[str, dict] = {}
GEH_JOBS_LOCK = threading.Lock()
# Serialize CLI invocations so parallel requests don't fight over the cache
GEH_RUN_LOCK = threading.Lock()

PERCENT_RE = re.compile(r"(\d{1,3}(?:\.\d+)?)%")


# === Binary discovery ===

def _binary_path() -> Optional[Path]:
    """Locate the GEHistoricalImagery executable for this platform."""
    override = os.getenv("GEHISTORICALIMAGERY_PATH")
    if override:
        candidate = Path(override)
        if candidate.exists():
            return candidate
    if os.name == "nt":
        # Prefer direct .exe over .bat launcher (bat doesn't work from hidden processes)
        nested_exe = BIN_DIR / "gdal" / "GEHistoricalImagery.exe"
        if nested_exe.exists():
            return nested_exe
        for name in ("GEHistoricalImagery.exe", "GEHistoricalImagery.bat"):
            candidate = BIN_DIR / name
            if candidate.exists():
                return candidate
    else:
        for name in ("GEHistoricalImagery", "GEHistoricalImagery.exe"):
            candidate = BIN_DIR / name
            if candidate.exists():
                return candidate
        nested = BIN_DIR / "gdal" / "GEHistoricalImagery"
        if nested.exists():
            return nested
    return None


def _build_command(args: List[str]) -> Optional[List[str]]:
    """Return the full command line for the CLI, or None when unavailable."""
    binary = _binary_path()
    if binary is None:
        return None
    if os.name == "nt" and binary.suffix.lower() == ".bat":
        return ["cmd", "/c", str(binary), *args]
    return [str(binary), *args]


def _tile_count(zoom: int, north: float, south: float, east: float, west: float) -> int:
    """Approximate the number of web-mercator tiles covered by the region."""
    n = 2 ** zoom
    nx = abs(east - west) / 360.0 * n
    import math

    def lat_to_y(lat: float) -> float:
        lat = max(-85.05112878, min(85.05112878, lat))
        return (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2

    ny = abs(lat_to_y(north) - lat_to_y(south)) * n
    return max(1, int(nx * ny))


# === Response cache (availability) ===

def _cache_key(params: dict) -> str:
    return hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()


def _get_cached(key: str, ttl_hours: float = 24) -> Optional[Any]:
    path = CACHE_DIR / f"geh_{key}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        created = datetime.fromisoformat(payload.get("timestamp", "2000-01-01"))
        if datetime.now() - created < timedelta(hours=ttl_hours):
            return payload.get("data")
    except Exception:
        pass
    return None


def _set_cached(key: str, data: Any) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = CACHE_DIR / f"geh_{key}.json"
        path.write_text(
            json.dumps({"timestamp": datetime.now().isoformat(), "data": data}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass


# === CLI execution ===

def _run_cli(args: List[str], timeout: int, progress_cb=None) -> str:
    """
    Run GEHistoricalImagery synchronously and return the stderr tail.

    progress_cb(percent) receives the latest progress percentage reported by
    the tool's progress writer (parsed from the stderr stream).
    """
    command = _build_command(args)
    if command is None:
        raise RuntimeError(
            "ابزار GEHistoricalImagery روی سرور نصب نیست. فایل اجرایی را در fastapi/bin قرار دهید."
        )

    process = _popen_with_geh_env(
        command,
        cwd=str(BIN_DIR if BIN_DIR.is_dir() else Path.cwd()),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    tail_parts: List[str] = []
    last_percent: Optional[float] = None
    lock = threading.Lock()

    def read_stderr() -> None:
        nonlocal last_percent
        assert process.stderr is not None
        for raw in iter(process.stderr.readline, b""):
            text = raw.decode("utf-8", errors="replace")
            with lock:
                tail_parts.append(text)
                if len(tail_parts) > 400:
                    del tail_parts[:200]
            if progress_cb is not None:
                matches = PERCENT_RE.findall(text)
                if matches:
                    try:
                        percent = float(matches[-1])
                        if 0 <= percent <= 100:
                            last_percent = percent
                            progress_cb(percent)
                    except ValueError:
                        pass

    reader = threading.Thread(target=read_stderr, daemon=True)
    reader.start()

    try:
        returncode = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise RuntimeError("زمان اجرای GEHistoricalImagery به پایان رسید")
    reader.join(timeout=5)

    if process.stdout is not None:
        try:
            process.stdout.close()
        except Exception:
            pass

    with lock:
        tail = "".join(tail_parts)[-4000:]

    if returncode != 0:
        detail = tail.strip().splitlines()
        message = detail[-1] if detail else f"exit code {returncode}"
        raise RuntimeError(f"اجرای GEHistoricalImagery ناموفق بود: {message}")

    return tail


def _run_cli_stdout(args: List[str], timeout: int) -> tuple:
    """Run the CLI and return (stdout, stderr) as strings."""
    command = _build_command(args)
    if command is None:
        raise RuntimeError(
            "ابزار GEHistoricalImagery روی سرور نصب نیست. فایل اجرایی را در fastapi/bin قرار دهید."
        )

    result = _run_with_geh_env(
        command,
        cwd=str(BIN_DIR if BIN_DIR.is_dir() else Path.cwd()),
        capture_output=True,
        stdin=subprocess.DEVNULL,
        timeout=timeout,
    )

    stdout_text = result.stdout.decode("utf-8", errors="replace")
    stderr_text = result.stderr.decode("utf-8", errors="replace")

    if result.returncode != 0:
        detail = stderr_text.strip().splitlines()
        message = detail[-1] if detail else f"exit code {result.returncode}"
        raise RuntimeError(f"اجرای GEHistoricalImagery ناموفق بود: {message}")

    return stdout_text, stderr_text


# === Availability ===

def _region_args(north: float, south: float, east: float, west: float) -> List[str]:
    return [
        "--lower-left", f"{south},{west}",
        "--upper-right", f"{north},{east}",
    ]


def _availability(bounds: dict, zoom: int, provider: str) -> List[dict]:
    """
    Full imagery-date availability for the region (no date filter so one run
    can serve any calendar window). Result is cached for 24 hours.

    Returns a list of {date, complete, coverage} sorted by date descending.
    """
    key = _cache_key({
        "source": "geh-availability-v3",
        "b": [round(bounds["north"], 6), round(bounds["south"], 6),
              round(bounds["east"], 6), round(bounds["west"], 6)],
        "z": zoom,
        "p": provider,
    })
    cached = _get_cached(key)
    if cached is not None:
        return cached, None

    out_file = CACHE_DIR / f"geh_avail_{uuid.uuid4().hex[:10]}.json"
    args = [
        "availability",
        *_region_args(bounds["north"], bounds["south"], bounds["east"], bounds["west"]),
        "--zoom", str(zoom),
        "--provider", provider,
        "-o", str(out_file),
        "-q",
    ]
    debug_info = {"command": " ".join(args), "stdout_len": 0, "feature_count": 0}
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        binary = _binary_path()
        if binary is None:
            raise RuntimeError("ابزار GEHistoricalImagery روی سرور نصب نیست")
        if os.name == "nt" and binary.suffix.lower() == ".bat":
            cmd = ["cmd", "/c", str(binary), *args]
        else:
            cmd = [str(binary), *args]
        result = _run_with_geh_env(
            cmd,
            cwd=str(BIN_DIR if BIN_DIR.is_dir() else Path.cwd()),
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=AVAILABILITY_TIMEOUT,
        )
        debug_info["returncode"] = result.returncode
        if result.stderr:
            debug_info["stderr_preview"] = result.stderr.decode("utf-8", errors="replace")[-500:]
        if not out_file.exists():
            debug_info["error"] = "output file not created"
            return [], debug_info
        raw = out_file.read_text(encoding="utf-8")
        debug_info["stdout_len"] = len(raw)
        if not raw.strip():
            return [], debug_info
        payload = json.loads(raw)
        debug_info["feature_count"] = len(payload.get("features", []))
    except json.JSONDecodeError as e:
        debug_info["json_error"] = str(e)
        debug_info["stdout_preview"] = raw[:1000] if raw else "(empty)"
        return [], debug_info
    except subprocess.TimeoutExpired:
        debug_info["error"] = "timeout"
        return [], debug_info
    finally:
        if out_file.exists():
            try:
                out_file.unlink()
            except OSError:
                pass

    region_polygon = Polygon([
        (bounds["west"], bounds["south"]),
        (bounds["west"], bounds["north"]),
        (bounds["east"], bounds["north"]),
        (bounds["east"], bounds["south"]),
    ])
    if not region_polygon.is_valid:
        region_polygon = region_polygon.buffer(0)

    # Wayback availability output is in Web Mercator; compare in one CRS.
    region_cmp = region_polygon
    if provider == "wayback" and Transformer is not None:
        project = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform
        region_cmp = shapely_transform(project, region_polygon)
    region_area = max(region_cmp.area, 1e-12)
    to_wgs84 = None
    if provider == "wayback" and Transformer is not None:
        to_wgs84 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True).transform

    rows: List[dict] = []
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        date_value = props.get("image_date") or props.get("layer_date")
        if not date_value:
            continue
        coverage = 0.0
        coverage_geometry = None
        try:
            geom = shape(feature.get("geometry", {}))
            if geom.is_valid and not geom.is_empty and not region_cmp.is_empty:
                coverage = geom.intersection(region_cmp).area / region_area * 100
                coverage = max(0.0, min(100.0, coverage))
                display_geom = shapely_transform(to_wgs84, geom) if to_wgs84 else geom
                if display_geom.is_valid and not display_geom.is_empty:
                    coverage_geometry = mapping(display_geom)
        except Exception:
            coverage = 0.0
        rows.append({
            "date": str(date_value),
            "complete": bool(props.get("iscomplete", 0)),
            "coverage": round(coverage, 1),
            "coverageGeometry": coverage_geometry,
        })

    rows.sort(key=lambda row: row["date"], reverse=True)
    _set_cached(key, rows)
    return rows, debug_info


def _filter_window(rows: List[dict], start: Optional[str], end: Optional[str]) -> List[dict]:
    if not start and not end:
        return rows
    return [
        row for row in rows
        if (not start or row["date"] >= start) and (not end or row["date"] <= end)
    ]


def _validate_common(north: float, south: float, east: float, west: float,
                     zoom: int, provider: str) -> None:
    if north <= south or east <= west:
        raise HTTPException(status_code=400, detail="محدوده جغرافیایی نامعتبر است")
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="منبع تصویر نامعتبر است (tm یا wayback)")
    max_zoom = 20 if provider == "wayback" else 21
    if not 1 <= zoom <= max_zoom:
        raise HTTPException(status_code=400, detail=f"سطح زوم باید بین ۱ تا {max_zoom} باشد")
    if _binary_path() is None:
        raise HTTPException(
            status_code=503,
            detail="ابزار GEHistoricalImagery روی سرور نصب نیست. فایل اجرایی را در fastapi/bin قرار دهید.",
        )


# === Endpoints ===

@router.get("/status")
def geh_status():
    binary = _binary_path()
    return {"success": True, "available": binary is not None, "path": str(binary) if binary else None}


@router.get("/available-dates")
def geh_available_dates(
    north: float = Query(...), south: float = Query(...),
    east: float = Query(...), west: float = Query(...),
    zoom: int = Query(18, ge=1, le=23),
    provider: str = Query("tm"),
    start: str = Query(..., description="Window start date (YYYY-MM-DD)"),
    end: str = Query(..., description="Window end date (YYYY-MM-DD)"),
):
    """Distinct imagery dates available inside the calendar window (green dots)."""
    _validate_common(north, south, east, west, zoom, provider)
    if _tile_count(zoom, north, south, east, west) > MAX_TILES_AVAILABILITY:
        raise HTTPException(
            status_code=400,
            detail="محدوده انتخابی در این سطح زوم بسیار بزرگ است؛ زوم را کاهش دهید یا محدوده را کوچک‌تر کنید.",
        )
    for value in (start, end):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="قالب تاریخ نامعتبر است (YYYY-MM-DD)")

    bounds = {"north": north, "south": south, "east": east, "west": west}
    try:
        rows, _ = _availability(bounds, zoom, provider)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))

    window_rows = _filter_window(rows, start, end)
    return {
        "success": True,
        "dates": sorted({row["date"] for row in window_rows}),
        "total": len({row["date"] for row in window_rows}),
        "window": {"start": start, "end": end},
    }


@router.get("/search")
def geh_search(
    north: float = Query(...), south: float = Query(...),
    east: float = Query(...), west: float = Query(...),
    zoom: int = Query(18, ge=1, le=23),
    provider: str = Query("tm"),
    dateFrom: Optional[str] = Query(None, description="Window start (YYYY-MM-DD)"),
    dateTo: Optional[str] = Query(None, description="Window end (YYYY-MM-DD)"),
):
    """List historical imagery dates available for the selected region."""
    _validate_common(north, south, east, west, zoom, provider)

    if _tile_count(zoom, north, south, east, west) > MAX_TILES_AVAILABILITY:
        raise HTTPException(
            status_code=400,
            detail="محدوده انتخابی در این سطح زوم بسیار بزرگ است؛ زوم را کاهش دهید یا محدوده را کوچک‌تر کنید.",
        )

    for value in (dateFrom, dateTo):
        if value:
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="قالب تاریخ نامعتبر است (YYYY-MM-DD)")

    bounds = {"north": north, "south": south, "east": east, "west": west}
    try:
        rows, debug = _availability(bounds, zoom, provider)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))

    window_rows = _filter_window(rows, dateFrom, dateTo)
    provider_label = "Google Earth" if provider == "tm" else "Esri Wayback"
    data = [
        {
            "id": f"GEH_{row['date']}",
            "date": row["date"],
            "provider": provider_label,
            "providerCode": provider,
            "zoom": zoom,
            "coveragePercent": row["coverage"],
            "coverageGeometry": row.get("coverageGeometry"),
            "complete": row["complete"],
        }
        for row in window_rows
    ]

    result = {
        "success": True,
        "data": data,
        "total": len(data),
        "geh": {"count": len(data), "zoom": zoom, "provider": provider},
        "message": (
            f"{len(data)} تاریخ تصویر تاریخی برای این محدوده یافت شد"
            if data else "تصویری برای این محدوده/بازه یافت نشد"
        ),
    }
    if debug:
        result["debug"] = debug
    return result


# === Download (GeoTIFF) ===

class GehDownloadRequest(BaseModel):
    north: float
    south: float
    east: float
    west: float
    dates: List[str]
    zoom: int = 18
    provider: str = "tm"
    dateMatch: str = "closest"

    @field_validator("dates")
    @classmethod
    def validate_dates(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("حداقل یک تاریخ لازم است")
        cleaned = []
        for item in value:
            date = datetime.strptime(item, "%Y-%m-%d").strftime("%Y/%m/%d")
            if date not in cleaned:
                cleaned.append(date)
        return cleaned


@router.post("/download")
def enqueue_geh_download(request: GehDownloadRequest, background_tasks: BackgroundTasks):
    """Queue a GeoTIFF download job; follow progress via GET /geh/jobs/{id}."""
    _validate_common(request.north, request.south, request.east, request.west,
                     request.zoom, request.provider)
    if request.dateMatch not in DATE_MATCHES:
        raise HTTPException(status_code=400, detail="حالت تطبیق تاریخ نامعتبر است")
    if _tile_count(request.zoom, request.north, request.south, request.east, request.west) > MAX_TILES_DOWNLOAD:
        raise HTTPException(
            status_code=400,
            detail="محدوده انتخابی در این سطح زوم بسیار بزرگ است؛ زوم را کاهش دهید یا محدوده را کوچک‌تر کنید.",
        )

    job_id = uuid.uuid4().hex[:12]
    with GEH_JOBS_LOCK:
        GEH_JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0,
            "message": "در صف دانلود قرار گرفت",
            "dataset": "GEH",
            "process_type": "geh_download",
            "scene_ids": list(request.dates),
            "total_tiles": _tile_count(request.zoom, request.north, request.south, request.east, request.west),
            "created_at": datetime.utcnow().isoformat(),
            "started_at": None,
            "finished_at": None,
            "download_url": None,
            "preview_url": None,
            "output_path": None,
            "error": None,
        }
    background_tasks.add_task(_run_download, job_id, request)
    return JSONResponse(
        status_code=202,
        content={"success": True, "job_id": job_id, "status": "queued", "job_url": f"/geh/jobs/{job_id}"},
    )


@router.get("/jobs")
def list_geh_jobs():
    """List recent GEH processing jobs (newest first)."""
    with GEH_JOBS_LOCK:
        jobs = sorted(GEH_JOBS.values(), key=lambda j: j.get("created_at") or "", reverse=True)
    return {"jobs": jobs, "total": len(jobs)}


@router.get("/jobs/{job_id}")
def get_geh_job(job_id: str):
    with GEH_JOBS_LOCK:
        job = GEH_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="کار پردازش یافت نشد")
    return job


def _update_geh_job(job_id: str, **fields) -> None:
    with GEH_JOBS_LOCK:
        if job_id in GEH_JOBS:
            GEH_JOBS[job_id].update(fields)


def _run_download(job_id: str, request: GehDownloadRequest) -> None:
    date_tag = request.dates[0].replace("/", "-")
    base_name = f"geh_{request.provider}_z{request.zoom}_{date_tag}_{uuid.uuid4().hex[:8]}"
    output_path = DOWNLOADS_DIR / f"{base_name}.tif"

    def on_progress(percent: float) -> None:
        # CLI progress: 0-100%. Map to job progress 5%-95%.
        # Add 1% minimum step to ensure progress always moves forward.
        job_progress = max(5, int(5 + 0.9 * percent))
        _update_geh_job(job_id, progress=job_progress,
                        message=f"در حال دریافت کاشی‌های تصویر ({int(percent)}٪)")

    try:
        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
        _update_geh_job(job_id, status="running", started_at=datetime.utcnow().isoformat(),
                        progress=2, message="در حال آماده‌سازی درخواست...")

        args = [
            "download",
            *_region_args(request.north, request.south, request.east, request.west),
            "--zoom", str(request.zoom),
            "--provider", request.provider,
            "--date", ",".join(request.dates),
            "--output", str(output_path),
        ]
        if request.dateMatch == "exact":
            args.append("--exact-date")
        else:
            _DATE_MATCH_CASE = {
                "closest": "Closest",
                "closestbefore": "ClosestBefore",
                "closestafter": "ClosestAfter",
            }
            args += ["--date-match", _DATE_MATCH_CASE.get(request.dateMatch, request.dateMatch)]

        with GEH_RUN_LOCK:
            _run_cli(args, DOWNLOAD_TIMEOUT, progress_cb=on_progress)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("فایل خروجی تولید نشد")

        _update_geh_job(job_id, progress=97, message="در حال ساخت پیش‌نمایش...")
        preview_name = _write_preview(output_path)

        _update_geh_job(
            job_id,
            status="success",
            progress=100,
            finished_at=datetime.utcnow().isoformat(),
            download_url=f"/geh/file-download?path={output_path.name}",
            preview_url=f"/geh/preview?path={output_path.name}" if preview_name else None,
            output_path=str(output_path),
            message="فایل GeoTIFF آماده دانلود است",
        )
    except Exception as error:
        if output_path.exists():
            try:
                output_path.unlink()
            except OSError:
                pass
        _update_geh_job(job_id, status="failed", finished_at=datetime.utcnow().isoformat(),
                        error=str(error))
    finally:
        # Keep the downloads retention worker (main.py) in charge of cleanup.
        pass


def _write_preview(tif_path: Path) -> Optional[str]:
    """Create a small PNG preview next to the GeoTIFF (same stem, .png)."""
    try:
        import numpy as np
        from PIL import Image
        import rasterio

        preview_path = tif_path.with_suffix(".png")
        with rasterio.open(tif_path) as source:
            height = min(512, source.height)
            width = max(1, int(source.width * (height / source.height)))
            bands = min(3, source.count)
            data = source.read(
                list(range(1, bands + 1)),
                out_shape=(bands, height, width),
                resampling=rasterio.enums.Resampling.bilinear,
            )
        if bands == 1:
            data = np.repeat(data, 3, axis=0)
        image = np.transpose(data[:3], (1, 2, 0))
        Image.fromarray(image.astype("uint8")).save(preview_path, format="PNG")
        return preview_path.name
    except Exception:
        return None


@router.get("/file-download")
def geh_file_download(path: str = Query(...)):
    safe_name = Path(path).name
    file_path = DOWNLOADS_DIR / safe_name
    if not file_path.is_file() or file_path.suffix.lower() not in {".tif", ".tiff", ".png"}:
        raise HTTPException(status_code=404, detail="فایل دانلود یافت نشد")
    media = "image/png" if file_path.suffix.lower() == ".png" else "image/tiff"
    return FileResponse(file_path, media_type=media, filename=safe_name)


@router.get("/preview")
def geh_preview(path: str = Query(...)):
    safe_name = Path(path).name
    preview_path = DOWNLOADS_DIR / safe_name.replace(".tif", ".png").replace(".tiff", ".png")
    if not preview_path.is_file():
        raise HTTPException(status_code=404, detail="پیش‌نمایش یافت نشد")
    return FileResponse(preview_path, media_type="image/png", filename=preview_path.name)
