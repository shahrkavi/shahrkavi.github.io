"""Local Global Human Settlement (GHS) raster search and download endpoints."""

from pathlib import Path
import re
import uuid
import io
import struct
import zlib
import zipfile
import threading
from datetime import datetime
import numpy as np

import rasterio
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel
from fastapi.responses import FileResponse
from rasterio.merge import merge
from rasterio.windows import from_bounds
from rasterio.warp import calculate_default_transform, reproject, Resampling, transform_bounds

router = APIRouter()
# Keep Rasterio's PROJ database ahead of system GIS installations.
RASTERIO_PROJ_DATA = Path(rasterio.__file__).parent / "proj_data"
if RASTERIO_PROJ_DATA.exists():
    import os
    os.environ["PROJ_LIB"] = str(RASTERIO_PROJ_DATA)
    os.environ["PROJ_DATA"] = str(RASTERIO_PROJ_DATA)
GHS_ROOT = Path(__file__).resolve().parent.parent / "data" / "GHS"
LAYER_DIRS = {"pop": "POP", "built": "BUILT", "built_v": "BUILT_V"}
YEAR_PATTERN = re.compile(r"_E(\d{4})_", re.IGNORECASE)
DOWNLOAD_DIR = Path(__file__).resolve().parent / "downloads"
GHS_JOBS = {}
GHS_JOBS_LOCK = threading.Lock()


class GhsBulkRequest(BaseModel):
    years: list[int]
    layer: str
    north: float
    south: float
    east: float
    west: float


def _files_for(layer: str, year: int) -> list[Path]:
    directory = GHS_ROOT / LAYER_DIRS[layer]
    return sorted(directory.glob(f"GHS_*_E{year}_*.tif"))


def _available_years() -> list[int]:
    years_by_layer = []
    for layer in LAYER_DIRS:
        years = {
            int(match.group(1))
            for path in (GHS_ROOT / LAYER_DIRS[layer]).glob("*.tif")
            if (match := YEAR_PATTERN.search(path.name))
        }
        years_by_layer.append(years)
    return sorted(set.intersection(*years_by_layer)) if years_by_layer else []


def _validate_bounds(north: float, south: float, east: float, west: float) -> None:
    if north <= south or east <= west:
        raise HTTPException(status_code=400, detail="محدوده جغرافیایی نامعتبر است")


@router.get("/years")
def ghs_years():
    years = _available_years()
    return {"success": True, "years": years, "message": f"{len(years)} سال GHS در دسترس است"}


@router.get("/search")
def search_ghs(
    north: float = Query(...), south: float = Query(...),
    east: float = Query(...), west: float = Query(...),
    years: str | None = Query(None),
    layer: str = Query("all"),
):
    _validate_bounds(north, south, east, west)
    layer = layer.lower()
    if layer != "all" and layer not in LAYER_DIRS:
        raise HTTPException(status_code=400, detail="لایه GHS نامعتبر است")
    available = _available_years() if layer == "all" else sorted({
        int(match.group(1))
        for path in (GHS_ROOT / LAYER_DIRS[layer]).glob("*.tif")
        if (match := YEAR_PATTERN.search(path.name))
    })
    requested = None
    if years:
        try:
            requested = {int(value) for value in years.split(",") if value.strip()}
        except ValueError:
            raise HTTPException(status_code=400, detail="سال GHS نامعتبر است")
    selected = [year for year in available if requested is None or year in requested]
    bounds = {"north": north, "south": south, "east": east, "west": west}
    data = [
        {
            "id": f"GHS_{year}",
            "year": year,
            "name": f"GHS {year}",
            "layers": list(LAYER_DIRS),
            "layer": layer,
            "resolution": "۱۰۰ متر",
            "download_url": "/ghs/download?" + "&".join(
                f"{key}={value}" for key, value in {**bounds, "year": year, "layer": layer}.items()
            ),
            "preview_url": "/ghs/preview?" + "&".join(
                f"{key}={value}" for key, value in {**bounds, "year": year, "layer": layer}.items()
            ),
        }
        for year in selected
    ]
    return {
        "success": True,
        "data": data,
        "total": len(data),
        "years": available,
        "ghs": {"years": selected, "layers": list(LAYER_DIRS)},
        "message": f"{len(data)} سال GHS یافت شد" if data else "سال انتخاب‌شده‌ای در دسترس نیست",
    }


@router.get("/download")
def download_ghs(
    year: int = Query(...), north: float = Query(...), south: float = Query(...),
    east: float = Query(...), west: float = Query(...),
    layer: str = Query("all"),
):
    _validate_bounds(north, south, east, west)
    layer = layer.lower()
    if layer != "all" and layer not in LAYER_DIRS:
        raise HTTPException(status_code=400, detail="لایه GHS نامعتبر است")
    layer_years = _available_years() if layer == "all" else {
        int(match.group(1))
        for path in (GHS_ROOT / LAYER_DIRS[layer]).glob("*.tif")
        if (match := YEAR_PATTERN.search(path.name))
    }
    if year not in layer_years:
        raise HTTPException(status_code=404, detail="سال GHS یافت نشد")

    output = DOWNLOAD_DIR / f"ghs_{year}_{uuid.uuid4().hex[:10]}.tif"
    sources_by_layer: list[list[Path]] = []
    try:
        layers = list(LAYER_DIRS) if layer == "all" else [layer]
        for layer_name in layers:
            paths = _files_for(layer_name, year)
            if not paths:
                raise HTTPException(status_code=404, detail=f"لایه {layer_name} برای این سال یافت نشد")
            with rasterio.open(paths[0]) as source:
                raster_bounds = transform_bounds("EPSG:4326", source.crs, west, south, east, north)
                paths = [
                    path for path in paths
                    if _intersects(path, raster_bounds)
                ]
            if not paths:
                raise HTTPException(status_code=404, detail="محدوده انتخابی خارج از پوشش GHS است")
            sources_by_layer.append(paths)

        output.parent.mkdir(parents=True, exist_ok=True)
        merged_layers = []
        profile = None
        for paths in sources_by_layer:
            with rasterio.Env():
                opened = [rasterio.open(path) for path in paths]
                try:
                    mosaic, transform = merge(opened)
                    source_profile = opened[0].profile.copy()
                finally:
                    for source in opened:
                        source.close()
            if profile is None:
                profile = source_profile
            destination_transform, destination_width, destination_height = calculate_default_transform(
                source_profile["crs"], "EPSG:4326", mosaic.shape[2], mosaic.shape[1], *opened_bounds(paths)
            )
            reprojected = np.zeros((destination_height, destination_width), dtype=mosaic.dtype)
            reproject(
                source=mosaic[0], destination=reprojected,
                src_transform=transform, src_crs=source_profile["crs"],
                dst_transform=destination_transform, dst_crs="EPSG:4326",
                resampling=Resampling.nearest,
            )
            window = from_bounds(west, south, east, north, transform=destination_transform).round_offsets().round_lengths()
            row_start = max(0, int(window.row_off))
            col_start = max(0, int(window.col_off))
            row_stop = min(reprojected.shape[0], row_start + int(window.height))
            col_stop = min(reprojected.shape[1], col_start + int(window.width))
            merged_layers.append(reprojected[row_start:row_stop, col_start:col_stop])
            if profile is not None:
                profile.update(
                    height=row_stop - row_start, width=col_stop - col_start,
                    crs="EPSG:4326",
                    transform=destination_transform * rasterio.Affine.translation(col_start, row_start),
                    # The source layers use different integer/float types;
                    # float64 keeps all three values in one GeoTIFF safely.
                    count=len(layers), dtype="float64", nodata=None,
                )

        with rasterio.open(output, "w", **profile) as destination:
            for index, layer in enumerate(merged_layers, start=1):
                destination.write(layer, index)
            for index, name in enumerate(layers, start=1):
                destination.set_band_description(index, name)
    except HTTPException:
        raise
    except Exception as error:
        if output.exists():
            output.unlink()
        raise HTTPException(status_code=500, detail=f"ساخت رستر GHS ناموفق بود: {error}")

    suffix = "_".join(name.upper() for name in layers)
    return FileResponse(output, media_type="image/tiff", filename=f"GHS_{year}_{suffix}.tif")


@router.get("/preview")
def preview_ghs(
    year: int = Query(...), north: float = Query(...), south: float = Query(...),
    east: float = Query(...), west: float = Query(...), layer: str = Query(...),
):
    result = download_ghs(year, north, south, east, west, layer)
    with rasterio.open(result.path) as source:
        values = source.read(1, masked=True).filled(0)
    values = np.asarray(values, dtype="float64")
    valid = values[np.isfinite(values) & (values != 0)]
    if valid.size:
        low, high = np.percentile(valid, [2, 98])
        if high <= low:
            high = low + 1
        pixels = np.clip((values - low) * 255 / (high - low), 0, 255).astype("uint8")
    else:
        pixels = np.zeros(values.shape, dtype="uint8")
    buffer = io.BytesIO()
    buffer.write(_encode_grayscale_png(pixels))
    result_path = Path(result.path)
    if result_path.exists():
        result_path.unlink()
    buffer.seek(0)
    from fastapi.responses import StreamingResponse
    return StreamingResponse(buffer, media_type="image/png")


@router.get("/download-all")
def download_all_ghs(
    years: str = Query(...), layer: str = Query(...),
    north: float = Query(...), south: float = Query(...),
    east: float = Query(...), west: float = Query(...),
):
    try:
        selected_years = sorted({int(value) for value in years.split(",") if value.strip()})
    except ValueError:
        raise HTTPException(status_code=400, detail="سال GHS نامعتبر است")
    if not selected_years:
        raise HTTPException(status_code=400, detail="هیچ سالی انتخاب نشده است")

    zip_path = DOWNLOAD_DIR / f"ghs_{layer}_{uuid.uuid4().hex[:10]}.zip"
    generated = []
    try:
        for year in selected_years:
            result = download_ghs(year, north, south, east, west, layer)
            generated.append(Path(result.path))
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for tif_path in generated:
                archive.write(tif_path, f"GHS_{layer.upper()}_{tif_path.name.split('_')[1]}.tif")
    except HTTPException:
        raise
    except Exception as error:
        if zip_path.exists():
            zip_path.unlink()
        raise HTTPException(status_code=500, detail=f"ساخت فایل فشرده GHS ناموفق بود: {error}")
    finally:
        for tif_path in generated:
            if tif_path.exists():
                tif_path.unlink()

    return FileResponse(zip_path, media_type="application/zip", filename=f"GHS_{layer.upper()}_all.zip")


@router.post("/download-all")
def enqueue_download_all_ghs(request: GhsBulkRequest, background_tasks: BackgroundTasks):
    layer = request.layer.lower()
    if layer not in LAYER_DIRS:
        raise HTTPException(status_code=400, detail="لایه GHS نامعتبر است")
    years = sorted(set(request.years))
    if not years:
        raise HTTPException(status_code=400, detail="هیچ سالی انتخاب نشده است")
    job_id = uuid.uuid4().hex[:12]
    with GHS_JOBS_LOCK:
        GHS_JOBS[job_id] = {
            "job_id": job_id, "status": "queued", "progress": 0,
            "message": "در صف ساخت فایل فشرده قرار گرفت", "dataset": f"GHS_{layer.upper()}",
            "process_type": "bulk_download", "scene_ids": [], "created_at": datetime.utcnow().isoformat(),
            "download_url": None, "preview_url": None, "error": None,
        }
    background_tasks.add_task(_run_bulk_download, job_id, request.model_copy(update={"years": years, "layer": layer}))
    return {"success": True, "job_id": job_id, "status": "queued", "job_url": f"/ghs/jobs/{job_id}"}


@router.get("/jobs/{job_id}")
def get_ghs_job(job_id: str):
    with GHS_JOBS_LOCK:
        job = GHS_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="کار پردازش یافت نشد")
    return job


def _run_bulk_download(job_id: str, request: GhsBulkRequest) -> None:
    generated = []
    zip_path = DOWNLOAD_DIR / f"ghs_{request.layer}_{uuid.uuid4().hex[:10]}.zip"
    try:
        _update_ghs_job(job_id, status="running", progress=5, message="در حال ساخت رسترهای سالانه...")
        for index, year in enumerate(request.years, start=1):
            result = download_ghs(year, request.north, request.south, request.east, request.west, request.layer)
            generated.append(Path(result.path))
            _update_ghs_job(job_id, progress=5 + int(85 * index / len(request.years)), message=f"سال {year} آماده شد")
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for tif_path in generated:
                archive.write(tif_path, f"GHS_{request.layer.upper()}_{tif_path.name.split('_')[1]}.tif")
        _update_ghs_job(job_id, status="success", progress=100, finished_at=datetime.utcnow().isoformat(),
                        download_url=f"/ghs/file-download?path={zip_path.name}", message="فایل فشرده آماده دانلود است")
    except Exception as error:
        if zip_path.exists():
            zip_path.unlink()
        _update_ghs_job(job_id, status="failed", finished_at=datetime.utcnow().isoformat(), error=str(error))
    finally:
        for tif_path in generated:
            if tif_path.exists():
                tif_path.unlink()


def _update_ghs_job(job_id: str, **fields) -> None:
    with GHS_JOBS_LOCK:
        if job_id in GHS_JOBS:
            GHS_JOBS[job_id].update(fields)


@router.get("/file-download")
def download_ghs_job_file(path: str = Query(...)):
    safe_name = Path(path).name
    file_path = DOWNLOAD_DIR / safe_name
    if not file_path.is_file() or file_path.suffix.lower() != ".zip":
        raise HTTPException(status_code=404, detail="فایل دانلود یافت نشد")
    return FileResponse(file_path, media_type="application/zip", filename=safe_name)


def _encode_grayscale_png(pixels: np.ndarray) -> bytes:
    """Encode a 2D uint8 array as a PNG without requiring an image package."""
    height, width = pixels.shape
    raw = b"".join(b"\x00" + pixels[row].tobytes() for row in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

    signature = b"\x89PNG\r\n\x1a\n"
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return signature + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _intersects(path: Path, bounds: tuple[float, float, float, float]) -> bool:
    with rasterio.open(path) as source:
        left, bottom, right, top = source.bounds
    west, south, east, north = bounds
    return left < east and right > west and bottom < north and top > south


def opened_bounds(paths: list[Path]) -> tuple[float, float, float, float]:
    """Return the outer native-CRS bounds of the selected source tiles."""
    bounds = []
    for path in paths:
        with rasterio.open(path) as source:
            bounds.append(source.bounds)
    return (
        min(item.left for item in bounds), min(item.bottom for item in bounds),
        max(item.right for item in bounds), max(item.top for item in bounds),
    )
