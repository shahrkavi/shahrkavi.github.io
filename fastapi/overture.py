"""
Shahrkavi - Overture Maps router.

Provides building footprints from the Overture Maps release inside a bbox:

  GET  /overture/buildings           -> metadata (count, truncated, urls)
  GET  /overture/buildings/geojson   -> FeatureCollection body (map preview)
  GET  /overture/buildings/download  -> GeoJSON file attachment
  GET  /overture/buildings/export    -> shp / geojson / gpkg / csv / kml (sync)
  POST /overture/buildings/export-async -> queued export job (async)
  GET  /overture/jobs/{job_id}       -> job status polling
  GET  /overture/jobs                -> list recent jobs

Queries against the Overture S3 dataset are slow (minutes); results are
cached on disk per (bbox, limit) so repeat queries are instant.
"""

import hashlib
import io
import json
import os
import queue
import tempfile
import threading
import time
import traceback
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

try:
    import pyarrow as pa
    # More aggressive IO parallelism shortens the parquet footer scans
    pa.set_io_thread_count(16)
    pa.set_cpu_thread_count(8)
except Exception:
    pa = None

router = APIRouter()

# === Processing job queue ===
# Jobs are processed sequentially by a single background worker thread.
OVT_JOBS: dict = {}
OVT_JOB_QUEUE: "queue.Queue" = queue.Queue()
OVT_JOBS_LOCK = threading.Lock()

# Hard cap on features returned per request; larger regions are truncated
# and the client is told so.
MAX_LIMIT = 50000

# Disk cache for query results (bbox+limit keyed GeoJSON)
CACHE_DIR = Path(__file__).parent / "cache" / "overture"
CACHE_TTL_SECONDS = 24 * 3600

EXPORT_FORMATS = {
    "shp": ("Shapefile (ZIP)", "application/zip", "zip"),
    "geojson": ("GeoJSON", "application/geo+json", "geojson"),
    "kml": ("KML", "application/vnd.google-earth.kml+xml", "kml"),
    "gpkg": ("GeoPackage", "application/geopackage+sqlite3", "gpkg"),
    "csv": ("CSV", "text/csv", "csv"),
}

# Columns kept from the Overture building theme
KEEP_COLUMNS = [
    "id", "names", "sources", "level", "height", "min_height",
    "is_underground", "num_floors", "min_floor", "num_floors_underground",
    "subtype", "class", "facade_color", "facade_material",
    "roof_material", "roof_shape", "roof_orientation", "roof_color",
    "roof_height", "has_parts", "version",
]


def _scalar(value):
    """Return a scalar so nested values survive vector-exports.

    Shapefile/GeoPackage attribute tables only support flat scalar values, so
    `names` (dict) and `sources` (list of dicts) are serialised to JSON text.
    """
    if value is None or value == "":
        return None
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False)
    return value


def _shp_column_names(columns):
    """Truncate columns to the DBF 10-char limit and de-duplicate collisions.

    Shapefile field names are limited to 10 chars. `num_floors` and
    `num_floors_underground` would both truncate to `num_floors`, so we append
    a numeric suffix to later duplicates (e.g. `num_floo_1`).
    """
    seen = {}
    result = []
    for col in columns:
        base = str(col)[:10]
        if base in seen:
            seen[base] += 1
            base = f"{base[:8]}_{seen[base]}"
        else:
            seen[base] = 0
        result.append(base)
    return result


def _bbox_param(north: float, south: float, east: float, west: float) -> tuple:
    if north <= south or east <= west:
        raise HTTPException(status_code=400, detail="محدوده جغرافیایی نامعتبر است")
    return (float(west), float(south), float(east), float(north))


def _run_overture_query(bbox: tuple, limit: int):
    """Query the Overture buildings theme via the `overturemaps` CLI.

    The CLI's download pipeline uses the STAC index to fetch only the parquet
    files that intersect the bbox (~10x faster than a naive full-theme scan).
    """
    import subprocess
    import sys

    try:
        import overturemaps  # noqa: F401 - availability check
    except ImportError:
        raise HTTPException(status_code=500, detail="پکیج overturemaps روی سرور نصب نیست")

    xmin, ymin, xmax, ymax = bbox
    fd, tmp_path = tempfile.mkstemp(suffix=".geojson", prefix="overture_")
    os.close(fd)
    cmd = [
        sys.executable, "-m", "overturemaps", "download",
        f"--bbox={xmin},{ymin},{xmax},{ymax}",
        "--type=building",
        "-f", "geojson",
        "-o", tmp_path,
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=900,   # generous: large bboxes take minutes on slow links
        )
        if proc.returncode != 0:
            stderr_tail = (proc.stderr or "").strip()[-400:]
            raise RuntimeError(stderr_tail or f"exit code {proc.returncode}")

        with open(tmp_path, encoding="utf-8") as fh:
            fc = json.load(fh)
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=504,
            detail="زمان دریافت دادههای Overture Maps به پایان رسید؛ محدوده کوچکتری امتحان کنید",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"خطا در دریافت دادههای Overture Maps: {str(e)}",
        )
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    features = fc.get("features") or []
    total = len(features)

    # Keep the full attribute set; complex values (names/sources) are turned
    # into JSON text so they survive shapefile/geopackage exports.
    slim_features = []
    for feat in features[:limit]:
        props = feat.get("properties", {}) or {}
        slim = {k: _scalar(props.get(k)) for k in KEEP_COLUMNS}
        slim_features.append({
            "type": "Feature",
            "properties": slim,
            "geometry": feat.get("geometry"),
        })

    out_fc = {
        "type": "FeatureCollection",
        "name": "overture_buildings",
        "features": slim_features,
    }
    return out_fc, total, total > limit


def _cache_paths(key: str):
    base = CACHE_DIR / key
    return base.with_suffix(".geojson"), base.with_suffix(".meta.json")


def _load_cached(key: str):
    fc_path, meta_path = _cache_paths(key)
    try:
        if not (fc_path.exists() and meta_path.exists()):
            return None
        if time.time() - fc_path.stat().st_mtime > CACHE_TTL_SECONDS:
            return None
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        fc = json.loads(fc_path.read_text(encoding="utf-8"))
        return fc, meta["total"], meta["truncated"]
    except Exception:
        return None


def _store_cache(key: str, fc: dict, total: int, truncated: bool) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        fc_path, meta_path = _cache_paths(key)
        fc_path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
        meta_path.write_text(
            json.dumps({"total": total, "truncated": truncated}),
            encoding="utf-8",
        )
    except Exception:
        pass  # cache failures must never break the request


def _buildings_fc(bbox: tuple, limit: int):
    """Cached FeatureCollection query: returns (fc, total, truncated)."""
    key = hashlib.md5(f"{bbox}|{limit}".encode()).hexdigest()
    cached = _load_cached(key)
    if cached is not None:
        return cached
    fc, total, truncated = _run_overture_query(bbox, limit)
    _store_cache(key, fc, total, truncated)
    return fc, total, truncated


@router.get("/buildings")
def buildings_metadata(
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    limit: int = Query(5000, ge=1, le=MAX_LIMIT),
):
    """Metadata for the buildings query (counts + download url)."""
    bbox = _bbox_param(north, south, east, west)
    _fc, total, truncated = _buildings_fc(bbox, limit)
    download_params = (
        f"north={north}&south={south}&east={east}&west={west}&limit={limit}"
    )
    return {
        "success": True,
        "type": "overture",
        "total": total,
        "count": min(total, limit),
        "truncated": truncated,
        "download_url": f"/overture/buildings/download?{download_params}",
        "message": f"{total} ساختمان یافت شد",
    }


@router.get("/buildings/geojson")
def buildings_geojson(
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    limit: int = Query(5000, ge=1, le=MAX_LIMIT),
):
    """FeatureCollection body - used by the map preview."""
    bbox = _bbox_param(north, south, east, west)
    fc, _total, _truncated = _buildings_fc(bbox, limit)
    return Response(
        content=json.dumps(fc, ensure_ascii=False),
        media_type="application/geo+json",
    )


@router.get("/buildings/download")
def buildings_download(
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    limit: int = Query(5000, ge=1, le=MAX_LIMIT),
):
    """Buildings as a GeoJSON file attachment."""
    bbox = _bbox_param(north, south, east, west)
    fc, _total, _truncated = _buildings_fc(bbox, limit)
    return Response(
        content=json.dumps(fc, ensure_ascii=False),
        media_type="application/geo+json",
        headers={"Content-Disposition": 'attachment; filename="overture_buildings.geojson"'},
    )


def _gdf_to_export_bytes(gdf, fmt: str) -> bytes:
    if fmt == "shp":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            with tempfile.TemporaryDirectory() as tmp:
                base = os.path.join(tmp, "overture_buildings")
                gdf.to_file(base + ".shp", driver="ESRI Shapefile")
                for fn in sorted(os.listdir(tmp)):
                    zf.write(os.path.join(tmp, fn), fn)
        return buf.getvalue()
    if fmt == "csv":
        # to_csv serialises geometry as WKT text
        return gdf.to_csv(index=False).encode("utf-8")
    drivers = {"geojson": ("GeoJSON", "geojson"), "kml": ("KML", "kml"), "gpkg": ("GPKG", "gpkg")}
    driver, ext = drivers[fmt]
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, f"overture_buildings.{ext}")
        gdf.to_file(path, driver=driver)
        with open(path, "rb") as fh:
            return fh.read()


@router.get("/buildings/export")
def buildings_export(
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    limit: int = Query(20000, ge=1, le=MAX_LIMIT),
    format: str = Query("shp"),
):
    """Convert queried buildings to a vector format for download."""
    fmt = format.strip().lower()
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail="فرمت خروجی نامعتبر است")
    bbox = _bbox_param(north, south, east, west)

    fc, _total, _truncated = _buildings_fc(bbox, limit)
    if not fc.get("features"):
        raise HTTPException(status_code=404, detail="هیچ ساختمانی برای خروجی یافت نشد")

    import geopandas as gpd

    gdf = gpd.GeoDataFrame.from_features(fc["features"], crs="EPSG:4326")

    # Shapefile column names are limited to 10 characters
    if fmt == "shp":
        gdf.columns = _shp_column_names(gdf.columns)

    content = _gdf_to_export_bytes(gdf, fmt)
    _, media, ext = EXPORT_FORMATS[fmt]
    return Response(
        content=content,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="overture_buildings.{ext}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


# === Async export job endpoints ===

def _update_ovt_job(job_id: str, **fields) -> None:
    """Thread-safe partial update of an OVT job record."""
    with OVT_JOBS_LOCK:
        if job_id in OVT_JOBS:
            OVT_JOBS[job_id].update(fields)


def _run_ovt_export_job(job_id: str, north: float, south: float,
                         east: float, west: float, fmt: str, limit: int) -> None:
    """Execute a queued OVT export job in the background worker thread."""
    try:
        _update_ovt_job(job_id, status="running", started_at=datetime.utcnow().isoformat(),
                        progress=10, message="در حال دریافت دادههای ساختمانها...")

        bbox = _bbox_param(north, south, east, west)

        _update_ovt_job(job_id, progress=20, message="در حال جستجوی ساختمانها...")
        fc, total, truncated = _buildings_fc(bbox, limit)

        if not fc.get("features"):
            _update_ovt_job(job_id, status="failed", error="هیچ ساختمانی یافت نشد",
                            finished_at=datetime.utcnow().isoformat())
            return

        _update_ovt_job(job_id, progress=50, message=f"تعداد {total} ساختمان یافت شد. در حال تبدیل فرمت...")

        import geopandas as gpd
        gdf = gpd.GeoDataFrame.from_features(fc["features"], crs="EPSG:4326")

        if fmt == "shp":
            gdf.columns = _shp_column_names(gdf.columns)

        _update_ovt_job(job_id, progress=70, message="در حال ساخت فایل خروجی...")
        content = _gdf_to_export_bytes(gdf, fmt)

        # Save the output file
        _, _, ext = EXPORT_FORMATS[fmt]
        out_filename = f"overture_buildings_{job_id}.{ext}"
        out_path = DOWNLOADS_DIR / out_filename
        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(content)

        _update_ovt_job(job_id, progress=100, status="success",
                        message="پردازش با موفقیت انجام شد",
                        download_url=f"/overture/buildings/export-download?file={out_filename}",
                        total_buildings=total,
                        finished_at=datetime.utcnow().isoformat())

    except Exception as e:
        _update_ovt_job(job_id, status="failed",
                        error=f"خطا در پردازش: {str(e)}",
                        finished_at=datetime.utcnow().isoformat())
        print(f"OVT job {job_id} failed:\n{traceback.format_exc()}")


def _ovt_job_worker() -> None:
    """Consume queued OVT export jobs one at a time."""
    while True:
        job_id, north, south, east, west, fmt, limit = OVT_JOB_QUEUE.get()
        try:
            _run_ovt_export_job(job_id, north, south, east, west, fmt, limit)
        finally:
            OVT_JOB_QUEUE.task_done()


# Download directory for exported files
DOWNLOADS_DIR = Path(__file__).parent / "downloads"

# Start the background OVT export worker on import.
threading.Thread(target=_ovt_job_worker, daemon=True, name="ovt-export-worker").start()


class OVTExportRequest(BaseModel):
    """Request body for OVT async export."""
    north: float
    south: float
    east: float
    west: float
    format: str = "shp"
    limit: int = 20000


@router.post("/buildings/export-async")
async def enqueue_ovt_export(request: OVTExportRequest):
    """
    Enqueue an OVT building export job. The job runs in the background and
    its progress can be followed via GET /overture/jobs/{job_id}. Returns HTTP 202.
    """
    fmt = request.format.strip().lower()
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail="فرمت خروجی نامعتبر است")

    if request.north <= request.south or request.east <= request.west:
        raise HTTPException(status_code=400, detail="محدوده جغرافیایی نامعتبر است")

    limit = max(1, min(request.limit, MAX_LIMIT))

    job_id = uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat()
    with OVT_JOBS_LOCK:
        OVT_JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0,
            "message": "در صف پردازش قرار گرفت",
            "dataset": "OVT",
            "process_type": "overture_export",
            "format": fmt,
            "bounds": {
                "north": request.north,
                "south": request.south,
                "east": request.east,
                "west": request.west,
            },
            "limit": limit,
            "total_buildings": None,
            "created_at": now,
            "started_at": None,
            "finished_at": None,
            "download_url": None,
            "error": None,
        }
    OVT_JOB_QUEUE.put((job_id, request.north, request.south, request.east, request.west, fmt, limit))

    return JSONResponse(
        status_code=202,
        content={
            "success": True,
            "job_id": job_id,
            "status": "queued",
            "job_url": f"/overture/jobs/{job_id}",
        },
    )


@router.get("/jobs/{job_id}")
async def get_ovt_job(job_id: str):
    """Return the current status of an OVT export job."""
    with OVT_JOBS_LOCK:
        job = OVT_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="کار پردازش یافت نشد")
    return job


@router.get("/jobs")
async def list_ovt_jobs():
    """List recent OVT export jobs (newest first)."""
    with OVT_JOBS_LOCK:
        jobs = sorted(OVT_JOBS.values(), key=lambda j: j.get("created_at") or "", reverse=True)
    return {"jobs": jobs, "total": len(jobs)}


@router.get("/buildings/export-download")
async def download_ovt_export(file: str):
    """Download a completed OVT export file."""
    import re as _re
    if not _re.match(r'^overture_buildings_[a-f0-9]+\.\w+$', file):
        raise HTTPException(status_code=400, detail="نام فایل نامعتبر است")
    file_path = DOWNLOADS_DIR / file
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="فایل یافت نشد")
    ext = file_path.suffix.lstrip(".")
    _, media, _ = EXPORT_FORMATS.get(
        { "zip": "shp" }.get(ext, ext),
        ("unknown", "application/octet-stream", ext),
    )
    return Response(
        content=file_path.read_bytes(),
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="{file}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )
