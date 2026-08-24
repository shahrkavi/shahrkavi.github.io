"""
Shahrkavi - Satellite STAC API Router
Searches, downloads and processes optical satellite scenes
(Landsat, Sentinel-2, Sentinel-1, MODIS) via Microsoft Planetary Computer
(no USGS / Earthdata login required).
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any, Tuple
import requests
import json
import os
import re
import hashlib
import asyncio
import io
import zipfile
import shutil
import tempfile
import threading
import time
import traceback
import queue
import uuid
from datetime import datetime
from pathlib import Path
import numpy as np
import rasterio
from rasterio.merge import merge as merge_rasters
from rasterio.windows import from_bounds
from rasterio.warp import transform_bounds, reproject, Resampling as RioResampling
from shapely.geometry import Polygon, shape
from shapely.errors import GEOSException

# Prefer Rasterio's matching PROJ database. This prevents an unrelated system
# GIS/PostGIS installation from overriding it with an incompatible proj.db.
RASTERIO_PROJ_DATA = Path(rasterio.__file__).parent / "proj_data"
if RASTERIO_PROJ_DATA.exists():
    os.environ["PROJ_LIB"] = str(RASTERIO_PROJ_DATA)
    os.environ["PROJ_DATA"] = str(RASTERIO_PROJ_DATA)

router = APIRouter()

# === Constants ===
STAC_BASE_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
SAS_SIGN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
CACHE_DIR = Path(__file__).parent / "cache"
DOWNLOADS_DIR = Path(__file__).parent / "downloads"
# MPC queries over large regions/date ranges can take a while; give each
# request plenty of headroom and retry transient connection problems.
STAC_TIMEOUT = 180
STAC_RETRIES = 3

# === Processing job queue ===
# Jobs are processed sequentially by a single background worker thread.
JOBS: Dict[str, dict] = {}
JOB_QUEUE: "queue.Queue" = queue.Queue()
JOBS_LOCK = threading.Lock()

# === Dataset definitions ===
# Each code maps to a Planetary Computer STAC collection, platform filter
# values and a "family" that defines band naming and processing behaviour.
DATASET_CONFIGS: Dict[str, dict] = {
    "L4":  {"collection": "landsat-c2-l2",  "platforms": ["landsat-4"],  "family": "landsat",   "id_prefix": None},
    "L5":  {"collection": "landsat-c2-l2",  "platforms": ["landsat-5"],  "family": "landsat",   "id_prefix": None},
    "L7":  {"collection": "landsat-c2-l2",  "platforms": ["landsat-7"],  "family": "landsat",   "id_prefix": None},
    "L8":  {"collection": "landsat-c2-l2",  "platforms": ["landsat-8"],  "family": "landsat",   "id_prefix": None},
    "L9":  {"collection": "landsat-c2-l2",  "platforms": ["landsat-9"],  "family": "landsat",   "id_prefix": None},
    "S2":  {"collection": "sentinel-2-l2a", "platforms": ["Sentinel-2A", "Sentinel-2B"],
            "family": "sentinel2", "id_prefix": None},
    "S1":  {"collection": "sentinel-1-grd", "platforms": ["SENTINEL-1A", "SENTINEL-1B", "SENTINEL-1C"],
            "family": "sentinel1", "id_prefix": None},
    "MOD": {"collection": "modis-09A1-061", "platforms": [], "family": "modis", "id_prefix": "MOD09A1"},
    "MYD": {"collection": "modis-09A1-061", "platforms": [], "family": "modis", "id_prefix": "MYD09A1"},
    "DEM": {"collection": "cop-dem-glo-30", "platforms": [], "family": "dem", "id_prefix": None},
}

# Families whose items expose eo:cloud_cover (the cloud filter is ignored otherwise)
CLOUD_CAPABLE_FAMILIES = {"landsat", "sentinel2"}

FAMILY_META = {
    "landsat":   {"name": "Landsat",   "fullName": "Landsat Collection 2 L2",
                  "resolution": "۳۰ متر"},
    "sentinel2": {"name": "Sentinel-2", "fullName": "Sentinel-2 MSI L2A",
                  "resolution": "۱۰ متر"},
    "sentinel1": {"name": "Sentinel-1", "fullName": "Sentinel-1 SAR GRD",
                  "resolution": "۱۰ متر"},
    "modis":     {"name": "MODIS",     "fullName": "MODIS 8-Day Surface Reflectance",
                  "resolution": "۵۰۰ متر"},
    "dem":       {"name": "Copernicus DEM", "fullName": "Copernicus DEM GLO-30",
                  "resolution": "۳۰ متر"},
}

# Canonical band key -> actual MPC asset key per family.
# Canonical keys are used by the processing formulas (NDVI, EVI, ...).
FAMILY_BAND_MAP: Dict[str, Dict[str, str]] = {
    "landsat": {
        "blue": "blue", "green": "green", "red": "red",
        "nir": "nir08", "nir08": "nir08",
        "swir16": "swir16", "swir22": "swir22",
        "coastal": "coastal", "lwir11": "lwir11", "lwir": "lwir",
    },
    "sentinel2": {
        "coastal": "B01", "blue": "B02", "green": "B03", "red": "B04",
        "rededge1": "B05", "rededge2": "B06", "rededge3": "B07",
        "nir": "B08", "nir08": "B8A", "nir09": "B09",
        "swir16": "B11", "swir22": "B12", "scl": "SCL",
    },
    "sentinel1": {
        "vv": "vv", "vh": "vh", "hh": "hh", "hv": "hv",
    },
    "modis": {
        "red": "sur_refl_b01", "nir": "sur_refl_b02", "nir08": "sur_refl_b02",
        "blue": "sur_refl_b03", "green": "sur_refl_b04",
        "swir16": "sur_refl_b06", "swir22": "sur_refl_b07",
    },
    "dem": {
        "dem": "data",
    },
}

# Default calibration (scale, offset) used when the STAC asset has no raster:bands
DEFAULT_CALIBRATION: Dict[str, tuple] = {
    "sentinel2": (0.0001, -0.1),
    "modis":     (0.0001, 0.0),
}

# Spectral assets offered in the download modal, per family
FAMILY_DOWNLOAD_ASSETS: Dict[str, List[str]] = {
    "landsat": ["blue", "green", "red", "nir08", "swir16", "swir22",
                "coastal", "lwir11", "lwir"],
    "sentinel2": ["B01", "B02", "B03", "B04", "B05", "B06", "B07",
                  "B08", "B8A", "B09", "B11", "B12", "SCL"],
    "sentinel1": ["vv", "vh", "hh", "hv"],
    "modis": ["sur_refl_b01", "sur_refl_b02", "sur_refl_b03", "sur_refl_b04",
              "sur_refl_b05", "sur_refl_b06", "sur_refl_b07"],
    "dem": ["data"],
}

# Human-readable band labels (Persian) for the download modal
BAND_LABELS = {
    # Landsat common names
    "blue": "آبی (Blue)",
    "green": "سبز (Green)",
    "red": "قرمز (Red)",
    "nir08": "مادون قرمز نزدیک (NIR)",
    "swir16": "مادون قرمز کوتاه 1 (SWIR-1)",
    "swir22": "مادون قرمز کوتاه 2 (SWIR-2)",
    "coastal": "ساحلی (Coastal)",
    "lwir11": "حرارتی (Thermal)",
    "lwir": "حرارتی (Thermal)",
    "qa_pixel": "کیفیت پیکسل (QA Pixel)",
    "qa_aerosol": "کیفیت آئروسل (QA Aerosol)",
    "qa_radsat": "کیفیت اشباع (QA Radsat)",
    "mtl.txt": "متادیتا (MTL.txt)",
    "mtl.xml": "متادیتا (MTL.xml)",
    "mtl.json": "متادیتا (MTL.json)",
    # Sentinel-2
    "B01": "ساحلی (Coastal) - 60m",
    "B02": "آبی (Blue) - 10m",
    "B03": "سبز (Green) - 10m",
    "B04": "قرمز (Red) - 10m",
    "B05": "رد-لبه 1 (Red-edge 1) - 20m",
    "B06": "رد-لبه 2 (Red-edge 2) - 20m",
    "B07": "رد-لبه 3 (Red-edge 3) - 20m",
    "B08": "مادون قرمز نزدیک (NIR) - 10m",
    "B8A": "مادون قرمز نزدیک باریک (NIR narrow) - 20m",
    "B09": "بخار آب (Water vapour) - 60m",
    "B11": "مادون قرمز کوتاه 1 (SWIR-1) - 20m",
    "B12": "مادون قرمز کوتاه 2 (SWIR-2) - 20m",
    "SCL": "طبقه‌بندی صحنه (Scene Classification)",
    # Sentinel-1
    "vv": "VV (پلارایزاسیون عمودی)",
    "vh": "VH (پلارایزاسیون متقاطع)",
    "hh": "HH (پلارایزاسیون افقی)",
    "hv": "HV (پلارایزاسیون متقاطع)",
    # MODIS
    "sur_refl_b01": "قرمز (Red) 620-670nm",
    "sur_refl_b02": "مادون قرمز نزدیک (NIR) 841-876nm",
    "sur_refl_b03": "آبی (Blue) 459-479nm",
    "sur_refl_b04": "سبز (Green) 545-565nm",
    "sur_refl_b05": "SWIR 1230-1250nm",
    "sur_refl_b06": "SWIR 1628-1652nm",
    "sur_refl_b07": "SWIR 2105-2155nm",
    # DEM
    "data": "ارتفاع (Elevation DEM)",
}

# Map legacy USGS asset keys (Landsat only) -> MPC asset keys
USGS_TO_MPC_ASSETS = {
    "SR_B1": "coastal", "SR_B2": "blue", "SR_B3": "green", "SR_B4": "red",
    "SR_B5": "nir08", "SR_B6": "swir16", "SR_B7": "swir22", "SR_B8": "nir08",
    "MTL.txt": "mtl.txt", "MTL.xml": "mtl.xml", "MTL.json": "mtl.json",
    "QA_PIXEL": "qa_pixel", "QA_RADSAT": "qa_radsat", "SR_QA_AEROSOL": "qa_aerosol",
    "coastal": "coastal", "blue": "blue", "green": "green", "red": "red",
    "nir08": "nir08", "swir16": "swir16", "swir22": "swir22",
    "lwir": "lwir", "lwir11": "lwir11", "mtl.txt": "mtl.txt", "mtl.xml": "mtl.xml",
    "mtl.json": "mtl.json", "qa_pixel": "qa_pixel", "qa_radsat": "qa_radsat",
    "qa_aerosol": "qa_aerosol", "qa": "qa", "ang": "ang",
}


# === Helper Functions ===

def get_cache_key(params: dict) -> str:
    """Generate cache key from parameters."""
    param_str = json.dumps(params, sort_keys=True)
    return hashlib.md5(param_str.encode()).hexdigest()


def get_cached_response(cache_key: str) -> Optional[dict]:
    """Get cached response if exists and not too old (24 hours)."""
    cache_file = CACHE_DIR / f"{cache_key}.json"
    if not cache_file.exists():
        return None

    try:
        with open(cache_file, "r", encoding="utf-8") as f:
            cached = json.load(f)
        cached_time = datetime.fromisoformat(cached.get("timestamp", "2000-01-01"))
        age_hours = (datetime.now() - cached_time).total_seconds() / 3600
        if age_hours < 24:
            return cached.get("data")
    except Exception:
        pass
    return None


def set_cached_response(cache_key: str, data: dict) -> None:
    """Cache response with timestamp."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{cache_key}.json"
    cached = {"timestamp": datetime.now().isoformat(), "data": data}
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(cached, f, ensure_ascii=False)


def detect_family(scene_id: str) -> str:
    """Guess the dataset family from a scene ID prefix."""
    sid = (scene_id or "").upper()
    if sid.startswith(("LC0", "LE0", "LT0")):
        return "landsat"
    if sid.startswith("S2"):
        return "sentinel2"
    if sid.startswith("S1"):
        return "sentinel1"
    if sid.startswith(("MOD", "MYD")):
        return "modis"
    if sid.startswith("COP"):
        return "dem"
    return "landsat"


def normalize_scene_id(scene_id: str) -> str:
    """
    Normalize Landsat scene IDs to MPC format; pass other sensors through.
    USGS-style: LC08_L2SP_164036_20240626_20240709_02_T1_SR
    MPC-style:  LC08_L2SP_164036_20240626_02_T1
    """
    if not scene_id:
        return scene_id

    sid = scene_id.strip()
    # Sentinel / MODIS / other IDs are used as-is on Planetary Computer
    if not sid.startswith(("LC0", "LE0", "LT0")):
        return sid

    if sid.endswith("_SR") or sid.endswith("_ST"):
        sid = sid.rsplit("_", 1)[0]

    parts = sid.split("_")
    # LXSS_L2SP_PPPrrr_YYYYMMDD_YYYYMMDD_02_TX  -> drop processing date
    if len(parts) >= 7 and parts[3].isdigit() and len(parts[3]) == 8 and parts[4].isdigit() and len(parts[4]) == 8:
        sid = "_".join(parts[:4] + parts[5:])
    return sid


def map_asset_key(key: str, family: str = "landsat") -> str:
    """Map a requested (canonical) asset key to the MPC asset name."""
    fam_map = FAMILY_BAND_MAP.get(family, {})
    if key in fam_map:
        return fam_map[key]
    if family == "landsat":
        if key in USGS_TO_MPC_ASSETS:
            return USGS_TO_MPC_ASSETS[key]
        lower_map = {k.lower(): v for k, v in USGS_TO_MPC_ASSETS.items()}
        return lower_map.get(key.lower(), key)
    if family == "dem":
        # DEM stores elevation in the "data" asset
        if key in ("dem", "elevation", "data", "tiff"):
            return "data"
        return "data"
    return key


def build_stac_search_body(collection: str, bbox: List[float], datetime_range: str,
                           cloud_max: int, platforms: List[str], family: str,
                           limit: int) -> dict:
    """Build STAC search POST body with CQL2-JSON filter."""
    filters = []

    # Cloud cover filter (only for families that expose eo:cloud_cover)
    if family in CLOUD_CAPABLE_FAMILIES and cloud_max < 100:
        filters.append({
            "op": "<=",
            "args": [{"property": "eo:cloud_cover"}, cloud_max]
        })

    # Platform filter
    if platforms:
        if len(platforms) == 1:
            filters.append({
                "op": "=",
                "args": [{"property": "platform"}, platforms[0]]
            })
        else:
            filters.append({
                "op": "in",
                "args": [{"property": "platform"}, platforms]
            })

    if len(filters) == 0:
        cql2_filter = None
    elif len(filters) == 1:
        cql2_filter = filters[0]
    else:
        cql2_filter = {"op": "and", "args": filters}

    body = {
        "collections": [collection],
        "bbox": bbox,
        "datetime": datetime_range,
        "limit": limit,
    }

    if cql2_filter:
        body["filter"] = cql2_filter
        body["filter-lang"] = "cql2-json"

    return body


def stac_request(method: str, url: str, **kwargs) -> requests.Response:
    """
    Perform a STAC request with a generous timeout and retries on transient
    connection failures (timeouts / resets). Non-transient HTTP errors are
    raised immediately via raise_for_status().
    """
    kwargs.setdefault("timeout", STAC_TIMEOUT)
    kwargs.setdefault("headers", {"Accept": "application/geo+json, application/json"})
    last_exc: Optional[Exception] = None
    for attempt in range(STAC_RETRIES):
        try:
            response = requests.request(method, url, **kwargs)
            response.raise_for_status()
            return response
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
            last_exc = exc
            if attempt < STAC_RETRIES - 1:
                time.sleep(1 + attempt)
    raise last_exc  # type: ignore[misc]


def fetch_all_stac_items(search_body: dict, max_items: int) -> tuple[List[dict], bool]:
    """
    Fetch every advertised STAC result page up to the configured safety cap.

    STAC services may cap individual pages even when the requested limit is
    larger. Following rel=next prevents matching scenes on later pages from
    being silently omitted.
    """
    items: List[dict] = []
    seen_ids = set()
    request_url = f"{STAC_BASE_URL}/search"
    request_method = "POST"
    request_body = dict(search_body)
    request_body["limit"] = min(max_items, 500)
    truncated = False
    visited_requests = set()

    while request_url and len(items) < max_items:
        request_signature = (
            request_method,
            request_url,
            json.dumps(request_body, sort_keys=True) if request_method == "POST" else "",
        )
        if request_signature in visited_requests:
            break
        visited_requests.add(request_signature)

        if request_method == "GET":
            response = stac_request(
                "GET",
                request_url,
            )
        else:
            response = stac_request(
                "POST",
                request_url,
                json=request_body,
            )

        response.raise_for_status()
        page = response.json()

        for item in page.get("features", []):
            item_id = item.get("id")
            if item_id and item_id in seen_ids:
                continue
            if item_id:
                seen_ids.add(item_id)
            items.append(item)
            if len(items) >= max_items:
                break

        next_link = next(
            (link for link in page.get("links", []) if link.get("rel") == "next"),
            None,
        )
        if not next_link:
            request_url = None
            break

        if len(items) >= max_items:
            truncated = True
            break

        request_url = next_link.get("href")
        request_method = next_link.get("method", "GET").upper()
        if request_method == "POST":
            request_body = next_link.get("body") or request_body

    return items, truncated


def point_on_segment(point: List[float], start: List[float],
                     end: List[float], epsilon: float = 1e-9) -> bool:
    """Return True when a lon/lat point lies on a polygon edge."""
    px, py = point[:2]
    ax, ay = start[:2]
    bx, by = end[:2]
    cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
    if abs(cross) > epsilon:
        return False
    return (
        min(ax, bx) - epsilon <= px <= max(ax, bx) + epsilon
        and min(ay, by) - epsilon <= py <= max(ay, by) + epsilon
    )


def point_in_ring(point: List[float], ring: List[List[float]]) -> bool:
    """Boundary-inclusive ray-casting point-in-polygon test."""
    if len(ring) < 3:
        return False

    inside = False
    px, py = point[:2]
    previous = ring[-1]

    for current in ring:
        if point_on_segment(point, previous, current):
            return True

        x1, y1 = previous[:2]
        x2, y2 = current[:2]
        crosses = (y1 > py) != (y2 > py)
        if crosses:
            intersection_x = (x2 - x1) * (py - y1) / (y2 - y1) + x1
            if px < intersection_x:
                inside = not inside
        previous = current

    return inside


def geometry_covers_points(geometry: dict, points: List[List[float]]) -> bool:
    """
    Return True only when one scene polygon contains every selected-region
    vertex. Landsat footprints are convex, so containing all region vertices
    means the complete selected rectangle/polygon is covered.
    """
    if not geometry or not points:
        return False

    coordinates = geometry.get("coordinates") or []
    geometry_type = geometry.get("type")

    if geometry_type == "Polygon":
        exterior_rings = [coordinates[0]] if coordinates else []
    elif geometry_type == "MultiPolygon":
        exterior_rings = [
            polygon[0] for polygon in coordinates
            if polygon and polygon[0]
        ]
    else:
        return False

    return any(
        all(point_in_ring(point, ring) for point in points)
        for ring in exterior_rings
    )


def geometry_overlap_percent(geometry: dict, region_points: List[List[float]]) -> float:
    """Calculate how much of the selected region is covered by a scene."""
    if not geometry or len(region_points) < 3:
        return 0.0

    try:
        region = Polygon(region_points)
        scene = shape(geometry)

        if not region.is_valid:
            region = region.buffer(0)
        if not scene.is_valid:
            scene = scene.buffer(0)
        if region.is_empty or scene.is_empty or region.area <= 0:
            return 0.0

        overlap = scene.intersection(region).area / region.area * 100
        return max(0.0, min(100.0, overlap))
    except (GEOSException, TypeError, ValueError):
        return 0.0


def parse_region_points(region_geometry: Optional[str], bbox: List[float]) -> List[List[float]]:
    """Parse frontend vertices as [longitude, latitude], or use bbox corners."""
    if region_geometry:
        try:
            vertices = json.loads(region_geometry)
            if not isinstance(vertices, list) or not 3 <= len(vertices) <= 1000:
                raise ValueError("regionGeometry must contain 3 to 1000 vertices")

            points = []
            for vertex in vertices:
                if not isinstance(vertex, dict):
                    raise ValueError("Each region vertex must be an object")
                lat = float(vertex["lat"])
                lng = float(vertex["lng"])
                if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                    raise ValueError("Region vertex is outside valid coordinates")
                points.append([lng, lat])
            return points
        except (TypeError, ValueError, KeyError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid regionGeometry: {exc}") from exc

    west, south, east, north = bbox
    return [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
    ]


def get_preview_url(item: dict) -> Optional[str]:
    """Get a preview image URL for a STAC item (rendered_preview or thumbnail)."""
    assets = item.get("assets", {})
    if "rendered_preview" in assets:
        return assets["rendered_preview"].get("href")
    if "visual" in assets:
        return assets["visual"].get("href")
    if "thumbnail" in assets:
        return assets["thumbnail"].get("href")
    return None


def extract_tile(family: str, props: dict, item_id: str) -> Tuple[Any, Any]:
    """Return a (path, row) style tile identifier for a scene."""
    if family == "landsat":
        return props.get("landsat:wrs_path", 0), props.get("landsat:wrs_row", 0)
    if family == "sentinel2":
        m = re.search(r"_T(\d{2})([A-Z]{3})", item_id)
        if m:
            return int(m.group(1)), m.group(2)
        return 0, 0
    if family == "modis":
        m = re.search(r"\.A\d+\.h(\d+)v(\d+)", item_id)
        if m:
            return int(m.group(1)), m.group(2)
        return 0, 0
    return 0, 0


def stac_item_to_scene(item: dict, dataset_code: str) -> dict:
    """Transform STAC item to frontend scene shape."""
    props = item.get("properties", {})
    item_id = item.get("id", "")
    cfg = DATASET_CONFIGS[dataset_code]
    family = cfg["family"]
    sat_meta = FAMILY_META[family]

    name = sat_meta["name"]
    full_name = sat_meta["fullName"]
    resolution = sat_meta["resolution"]

    if family == "modis":
        is_aqua = item_id.startswith("MYD")
        name = "MODIS Aqua" if is_aqua else "MODIS Terra"
        full_name = f"{name} 8-Day Surface Reflectance"
    elif family == "sentinel2":
        plat = str(props.get("platform", "")).replace("Sentinel-", "")
        full_name = f"Sentinel-2 MSI L2A ({plat})"
    elif family == "sentinel1":
        plat = str(props.get("platform", ""))
        full_name = f"Sentinel-1 SAR GRD ({plat})"
    elif family == "landsat":
        full_name = f"{sat_meta['fullName']} {props.get('platform', '')}".strip()

    # Cloud cover (absent for MODIS / Sentinel-1 -> treated as clear)
    cloud_cover = int(round(float(props.get("eo:cloud_cover", 0) or 0)))
    if cloud_cover > 50:
        cloud_category = "high"
    elif cloud_cover > 20:
        cloud_category = "mid"
    else:
        cloud_category = "low"

    # Center point from bbox
    bbox = item.get("bbox", [0, 0, 0, 0])
    if len(bbox) >= 4:
        lng = (bbox[0] + bbox[2]) / 2
        lat = (bbox[1] + bbox[3]) / 2
    else:
        lat, lng = 0, 0

    # Footprint from Polygon or MultiPolygon geometry
    footprint = []
    geom = item.get("geometry", {})
    coords = geom.get("coordinates", [[]])
    geometry_type = geom.get("type", "Polygon")
    if coords:
        ring = coords[0][0] if geometry_type == "MultiPolygon" else coords[0]
        for coord in ring:
            if len(coord) >= 2:
                footprint.append({"lat": coord[1], "lng": coord[0]})

    thumbnail_url = get_preview_url(item) or ""

    path, row = extract_tile(family, props, item_id)

    # Size estimate (from advertised file sizes; fallback for no metadata)
    assets = item.get("assets", {})
    total_bytes = sum((asset.get("file:bytes") or 0) for asset in assets.values())
    size_mb = total_bytes / (1024 * 1024) if total_bytes > 0 else 200
    size_str = f"{size_mb:.1f} مگابایت"

    # Quality score (based on cloud and data availability)
    quality = max(0, min(10, 10 - (cloud_cover / 20)))

    # Date (MODIS stores it under start_datetime)
    datetime_str = props.get("datetime") or props.get("start_datetime", "")
    date_str = (datetime_str or "").split("T")[0]

    return {
        "id": item_id,
        "satellite": name,
        "satelliteCode": dataset_code,
        "fullName": full_name,
        "resolution": resolution,
        "date": date_str,
        "cloudCover": cloud_cover,
        "cloudCategory": cloud_category,
        "lat": round(lat, 4),
        "lng": round(lng, 4),
        "footprint": footprint,
        "thumbnail": thumbnail_url,
        "path": path,
        "row": row,
        "size": size_str,
        "quality": f"{quality:.1f}",
    }


def fetch_stac_item(scene_id: str) -> Optional[dict]:
    """Fetch a single STAC item by ID from Planetary Computer."""
    normalized_id = normalize_scene_id(scene_id)
    family = detect_family(scene_id)

    # Resolve the collection that contains items of this family
    collection = None
    for code, cfg in DATASET_CONFIGS.items():
        if cfg["family"] == family:
            collection = cfg["collection"]
            break

    if collection:
        url = f"{STAC_BASE_URL}/collections/{collection}/items/{normalized_id}"
        try:
            resp = stac_request("GET", url)
            return resp.json()
        except Exception:
            pass

    # Fallback: CQL2 search across collections by id
    try:
        resp = stac_request(
            "POST",
            f"{STAC_BASE_URL}/search",
            json={
                "filter": {
                    "op": "=",
                    "args": [{"property": "id"}, normalized_id],
                },
                "limit": 1,
            },
        )
        return resp.json().get("features", [None])[0]
    except Exception:
        return None


def sign_asset_url(href: str) -> str:
    """
    Sign a Planetary Computer blob URL with a short-lived SAS token.
    No account / API key is required for public collections.
    """
    if not href:
        return href

    # Already signed
    if "sig=" in href or "se=" in href:
        return href

    # Public non-blob URLs (e.g. rendered_preview on titiler) don't need signing
    if "blob.core.windows.net" not in href:
        return href

    try:
        resp = requests.get(
            SAS_SIGN_URL,
            params={"href": href},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("href", href)
    except Exception as e:
        raise RuntimeError(f"SAS signing failed: {str(e)}")


def resolve_asset_hrefs(item: dict, asset_keys: List[str], family: str = "landsat") -> Dict[str, str]:
    """Extract and SAS-sign download URLs for requested assets."""
    assets = item.get("assets", {})
    result = {}

    for key in asset_keys:
        mpc_key = map_asset_key(key, family)
        asset = assets.get(mpc_key) or assets.get(key)
        if not asset:
            continue

        href = asset.get("href", "")
        if not href:
            continue

        result[key] = sign_asset_url(href)

    return result


def get_asset_calibration(item: dict, asset_key: str, family: str) -> tuple[float, float]:
    """Read Planetary Computer raster scale/offset metadata for an asset."""
    mpc_key = map_asset_key(asset_key, family)
    asset = item.get("assets", {}).get(mpc_key) or item.get("assets", {}).get(asset_key) or {}
    raster_bands = asset.get("raster:bands") or []
    if raster_bands:
        metadata = raster_bands[0] or {}
        return float(metadata.get("scale", 1.0)), float(metadata.get("offset", 0.0))
    return DEFAULT_CALIBRATION.get(family, (1.0, 0.0))


def safe_path(base_dir: Path, filename: str) -> Path:
    """Prevent path traversal attacks."""
    safe_name = os.path.basename(filename)
    full_path = (base_dir / safe_name).resolve()

    if not str(full_path).startswith(str(base_dir.resolve())):
        raise ValueError("Path traversal detected")

    return full_path


def download_file_streaming(url: str, dest_path: Path) -> int:
    """Download file with streaming, return bytes downloaded."""
    try:
        resp = requests.get(url, stream=True, timeout=300)
        resp.raise_for_status()

        total_bytes = 0
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    total_bytes += len(chunk)

        return total_bytes
    except Exception as e:
        raise RuntimeError(f"Download failed: {str(e)}")


# === Request Models ===

class DownloadRequest(BaseModel):
    scene_id: str
    assets: List[str]
    output_dir: Optional[str] = None
    dataset: Optional[str] = None

    @field_validator('assets')
    @classmethod
    def validate_assets(cls, v):
        if not v:
            raise ValueError('assets list cannot be empty')
        return v


# === Endpoints ===

@router.get("/search")
async def search_landsat(
    north: float = Query(..., description="North latitude"),
    south: float = Query(..., description="South latitude"),
    east: float = Query(..., description="East longitude"),
    west: float = Query(..., description="West longitude"),
    dateFrom: str = Query(..., description="Start date (YYYY-MM-DD)"),
    dateTo: str = Query(..., description="End date (YYYY-MM-DD)"),
    cloudMax: int = Query(100, ge=0, le=100, description="Maximum cloud cover percent"),
    datasets: str = Query("L8,L9", description="Comma-separated dataset codes"),
    limit: int = Query(500, ge=1, le=5000, description="Maximum results"),
    regionGeometry: Optional[str] = Query(
        None,
        description="JSON array of selected region vertices ({lat, lng})"
    )
):
    """
    Search for satellite scenes (Landsat, Sentinel-2/1, MODIS) via the
    Microsoft Planetary Computer STAC API. No login required.
    """
    # Validate coordinates
    if north <= south:
        raise HTTPException(status_code=400, detail="شمال باید بزرگتر از جنوب باشد")
    if east <= west:
        raise HTTPException(status_code=400, detail="شرق باید بزرگتر از غرب باشد")

    # Parse datasets - filter to supported codes
    dataset_codes = [d.strip().upper() for d in datasets.split(",") if d.strip()]
    codes = [d for d in dataset_codes if d in DATASET_CONFIGS]

    if not codes:
        return JSONResponse(content={
            "success": True,
            "data": [],
            "total": 0,
            "message": "هیچ تصویری یافت نشد. یکی از L4-L9, S2, S1, MOD, MYD را انتخاب کنید."
        })

    # Build and validate datetime range
    try:
        date_from = datetime.strptime(dateFrom, "%Y-%m-%d")
        date_to = datetime.strptime(dateTo, "%Y-%m-%d")
        if date_from > date_to:
            raise ValueError("dateFrom must be on or before dateTo")
        datetime_range = f"{dateFrom}T00:00:00Z/{dateTo}T23:59:59Z"
    except ValueError:
        raise HTTPException(status_code=400, detail="فرمت تاریخ نامعتبر است")

    # Build bbox [west, south, east, north]
    bbox = [west, south, east, north]
    region_points = parse_region_points(regionGeometry, bbox)

    # Cache key (includes source so old cache entries are not reused)
    cache_params = {
        "source": "mpc-multisensor-v1",
        "codes": codes,
        "bbox": bbox,
        "region_points": region_points,
        "datetime": datetime_range,
        "cloud": cloudMax,
        "limit": limit
    }
    cache_key = get_cache_key(cache_params)
    cached = get_cached_response(cache_key)
    if cached:
        return JSONResponse(content=cached)

    # Fetch items per unique collection (a MODIS request combines Terra+Aqua)
    all_items: List[dict] = []
    truncated = False
    collections = {DATASET_CONFIGS[c]["collection"] for c in codes}

    try:
        for collection in collections:
            group_codes = [c for c in codes if DATASET_CONFIGS[c]["collection"] == collection]
            platforms = sorted({p for c in group_codes for p in DATASET_CONFIGS[c]["platforms"]})
            id_prefixes = {
                DATASET_CONFIGS[c]["id_prefix"] for c in group_codes
                if DATASET_CONFIGS[c]["id_prefix"]
            }
            family = DATASET_CONFIGS[group_codes[0]]["family"]

            search_body = build_stac_search_body(
                collection, bbox, datetime_range, cloudMax, platforms, family, limit
            )
            items, group_truncated = fetch_all_stac_items(search_body, limit)
            truncated = truncated or group_truncated

            if id_prefixes:
                items = [
                    it for it in items
                    if any((it.get("id") or "").startswith(p) for p in id_prefixes)
                ]
            all_items.extend(items)
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="درخواست به سرور Planetary Computer با مشکل مواجه شد")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"خطا در ارتباط با Planetary Computer: {str(e)}")

    # Calculate actual overlap using the scene footprint, not only its bbox.
    intersecting_total = len(all_items)
    scored_items = [
        (item, geometry_overlap_percent(item.get("geometry", {}), region_points))
        for item in all_items
    ]
    full_coverage_items = [
        (item, coverage) for item, coverage in scored_items if coverage >= 99.5
    ]

    if full_coverage_items:
        selected_items = full_coverage_items
        coverage_mode = "full"
        minimum_coverage = 99.5
    else:
        # A region spanning multiple tiles cannot be contained by one scene.
        # Use an adaptive threshold: 5% for normal selections, or 25%
        # of the best available tile coverage for very large regions.
        positive_coverages = [coverage for _, coverage in scored_items if coverage > 0]
        best_coverage = max(positive_coverages, default=0.0)
        minimum_coverage = min(5.0, best_coverage * 0.25)
        selected_items = [
            (item, coverage)
            for item, coverage in scored_items
            if coverage > 0 and coverage >= minimum_coverage
        ]
        coverage_mode = "partial"

    # Resolve each scene's dataset code (MODIS Terra/Aqua by ID prefix)
    def scene_code(item):
        for c in codes:
            p = DATASET_CONFIGS[c]["id_prefix"]
            if p and (item.get("id") or "").startswith(p):
                return c
        return codes[0]

    scenes = []
    for item, coverage in selected_items:
        scene = stac_item_to_scene(item, scene_code(item))
        scene["coveragePercent"] = round(coverage, 1)
        scenes.append(scene)
    scenes.sort(
        key=lambda scene: (
            scene.get("coveragePercent", 0),
            scene.get("date", ""),
            scene.get("id", ""),
        ),
        reverse=True,
    )

    # Build response
    message = f"{len(scenes)} تصویر یافت شد" if scenes else "هیچ تصویری با این معیارها یافت نشد"
    if scenes and coverage_mode == "full":
        message = f"{len(scenes)} تصویر با پوشش کامل منطقه یافت شد"
        if intersecting_total > len(scenes):
            message += f" ({intersecting_total - len(scenes)} تصویر با پوشش جزئی حذف شد)"
    elif scenes:
        message = (
            f"هیچ تصویر منفردی کل منطقه را پوشش نمی‌دهد؛ "
            f"{len(scenes)} تصویر همپوشان برای پوشش چندکاشی نمایش داده شد"
        )
    elif intersecting_total > 0:
        message = (
            f"{intersecting_total} تصویر با منطقه تقاطع داشت، "
            "اما هندسه واقعی آن‌ها با منطقه همپوشانی نداشت"
        )

    if truncated:
        message += f" (جستجو به سقف ایمنی {limit} نتیجه رسید)"

    result = {
        "success": True,
        "data": scenes,
        "total": len(scenes),
        "intersectingTotal": intersecting_total,
        "excludedPartial": intersecting_total - len(scenes),
        "coverageMode": coverage_mode,
        "minimumCoveragePercent": round(minimum_coverage, 2),
        "message": message,
        "truncated": truncated
    }

    set_cached_response(cache_key, result)

    return JSONResponse(content=result)


@router.get("/dem")
async def search_dem(
    north: float = Query(..., description="North latitude"),
    south: float = Query(..., description="South latitude"),
    east: float = Query(..., description="East longitude"),
    west: float = Query(..., description="West longitude"),
    limit: int = Query(50, ge=1, le=500, description="Maximum results"),
):
    """
    Search for Copernicus DEM GLO-30 tiles covering the requested region.
    Returns DEM tile metadata with SAS-signed download URLs.
    """
    if north <= south:
        raise HTTPException(status_code=400, detail="عرض شمالی باید بزرگتر از جنوب باشد")
    if east <= west:
        raise HTTPException(status_code=400, detail="طول شرقی باید بزرگتر از طول غربی باشد")

    bbox = [west, south, east, north]
    region_points = [
        [west, north], [east, north], [east, south], [west, south],
    ]

    cache_params = {
        "source": "cop-dem-glo-30",
        "bbox": bbox,
        "limit": limit,
    }
    cache_key = get_cache_key(cache_params)
    cached = get_cached_response(cache_key)
    if cached:
        return JSONResponse(content=cached)

    try:
        search_body = {
            "collections": ["cop-dem-glo-30"],
            "bbox": bbox,
            "limit": limit,
        }
        items, truncated = fetch_all_stac_items(search_body, limit)
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="درخواست به سرور Planetary Computer با مشکل مواجه شد")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"خطا در ارتباط با Planetary Computer: {str(e)}")

    scored_items = [
        (item, geometry_overlap_percent(item.get("geometry", {}), region_points))
        for item in items
    ]
    selected_items = [
        (item, coverage) for item, coverage in scored_items if coverage > 0
    ]
    selected_items.sort(key=lambda x: x[1], reverse=True)

    tiles = []
    for item, coverage in selected_items:
        assets = item.get("assets", {})
        # COP DEM stores the GeoTIFF in the "data" asset
        geo_tiff = assets.get("data")
        if not geo_tiff:
            # Fallback: look for tiff-like assets
            for key, asset in assets.items():
                if "tiff" in key.lower() or "geotiff" in key.lower():
                    geo_tiff = asset
                    break

        href = geo_tiff.get("href", "") if geo_tiff else ""
        try:
            href = sign_asset_url(href)
        except RuntimeError:
            pass

        tile_id = item.get("id", "")
        bbox_item = item.get("bbox", [0, 0, 0, 0])
        tiles.append({
            "id": tile_id,
            "name": tile_id,
            "bbox": bbox_item,
            "coverage": round(coverage, 1),
            "download_url": href,
            "filename": f"{tile_id}.tif",
        })

    result = {
        "success": True,
        "data": tiles,
        "total": len(tiles),
        "message": f"{len(tiles)} کاشی DEM یافت شد" if tiles else "هیچ کاشی DEMای یافت نشد",
        "truncated": truncated,
    }

    set_cached_response(cache_key, result)
    return JSONResponse(content=result)


@router.post("/download")
async def download_landsat(request: DownloadRequest):
    """
    Download scene assets (band GeoTIFFs, MTL metadata) from
    Microsoft Planetary Computer using anonymous SAS-signed URLs.
    Returns list of downloaded files with local paths.
    """
    item = fetch_stac_item(request.scene_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"صحنه {request.scene_id} یافت نشد")

    family = detect_family(request.scene_id)
    if request.dataset and request.dataset.upper() in DATASET_CONFIGS:
        family = DATASET_CONFIGS[request.dataset.upper()]["family"]

    # Determine output directory
    if request.output_dir:
        try:
            output_dir = safe_path(Path.cwd(), request.output_dir)
        except ValueError:
            raise HTTPException(status_code=400, detail="مسیر خروجی نامعتبر است")
    else:
        output_dir = DOWNLOADS_DIR

    output_dir.mkdir(parents=True, exist_ok=True)

    # Resolve + SAS-sign asset URLs
    try:
        asset_urls = resolve_asset_hrefs(item, request.assets, family)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not asset_urls:
        available = sorted(item.get("assets", {}).keys())
        raise HTTPException(
            status_code=404,
            detail=f"هیچ یک از دارایی‌های درخواستی یافت نشد. موجود: {', '.join(available)}"
        )

    # Download files
    downloaded = []
    errors = []
    scene_id = item.get("id", normalize_scene_id(request.scene_id))

    for asset_key, url in asset_urls.items():
        if not url:
            errors.append({"asset_key": asset_key, "error": "URL یافت نشد"})
            continue

        try:
            mpc_key = map_asset_key(asset_key, family)
            # Build local filename
            lower_key = mpc_key.lower()
            if lower_key.endswith((".txt", ".xml", ".json", ".tif", ".tiff")):
                filename = f"{scene_id}_{mpc_key}"
            else:
                filename = f"{scene_id}_{mpc_key}.tif"

            dest_path = safe_path(output_dir, filename)

            # Download
            bytes_downloaded = download_file_streaming(url, dest_path)

            downloaded.append({
                "asset_key": asset_key,
                "mpc_asset_key": mpc_key,
                "path": str(dest_path),
                "bytes": bytes_downloaded
            })
        except Exception as e:
            errors.append({"asset_key": asset_key, "error": str(e)})

    result = {
        "success": len(downloaded) > 0,
        "scene_id": scene_id,
        "downloaded": downloaded,
        "errors": errors,
        "output_dir": str(output_dir)
    }

    return JSONResponse(content=result)


@router.get("/download-image")
async def download_scene_image(
    scene_id: str = Query(..., description="Scene ID"),
):
    """
    Download a single scene as a rendered preview image (PNG).
    Uses the Planetary Computer rendered_preview asset; falls back to thumbnail.
    """
    item = fetch_stac_item(scene_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"صحنه {scene_id} یافت نشد")

    href = get_preview_url(item)
    if not href:
        raise HTTPException(status_code=404, detail="پیش‌نمایشی برای این صحنه یافت نشد")

    try:
        href = sign_asset_url(href)
    except RuntimeError:
        pass

    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    safe_scene = os.path.basename(normalize_scene_id(item.get("id", scene_id)))
    filename = f"{safe_scene}_preview.png"
    dest = safe_path(DOWNLOADS_DIR, filename)

    try:
        download_file_streaming(href, dest)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return FileResponse(dest, media_type="image/png", filename=filename)


@router.get("/download-zip")
async def download_scenes_zip(
    scene_ids: str = Query(..., description="Comma-separated scene IDs"),
):
    """
    Download multiple scenes as a ZIP file containing each scene's preview image.
    """
    ids = [s.strip() for s in scene_ids.split(",") if s.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="scene_ids نمی‌تواند خالی باشد")

    buffer = io.BytesIO()
    added = 0

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for scene_id in ids:
            item = fetch_stac_item(scene_id)
            if not item:
                continue

            href = get_preview_url(item)
            if not href:
                continue

            try:
                href = sign_asset_url(href)
                resp = requests.get(href, timeout=120)
                resp.raise_for_status()
                safe_name = f"{os.path.basename(item.get('id', scene_id))}_preview.png"
                zf.writestr(safe_name, resp.content)
                added += 1
            except Exception:
                continue

    if added == 0:
        raise HTTPException(status_code=404, detail="هیچ تصویری برای دانلود یافت نشد")

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="shahrkavi_download.zip"'},
    )


@router.get("/download-links")
async def get_download_links(
    scene_id: str = Query(..., description="Scene ID"),
    bands: Optional[str] = Query(
        None,
        description="Comma-separated band keys. If omitted, all available spectral bands are returned.",
    ),
    dataset: Optional[str] = Query(
        None,
        description="Dataset code (e.g. S2, MOD) used to resolve the band family.",
    ),
):
    """
    Return SAS-signed direct download URLs for each requested band GeoTIFF.
    Used by the frontend band-download modal so users can download each band
    as a separate TIFF file.
    """
    item = fetch_stac_item(scene_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"صحنه {scene_id} یافت نشد")

    family = detect_family(scene_id)
    if dataset and dataset.upper() in DATASET_CONFIGS:
        family = DATASET_CONFIGS[dataset.upper()]["family"]

    assets = item.get("assets", {})
    available_keys = set(assets.keys())

    # Resolve which bands to return
    if bands:
        requested = [b.strip() for b in bands.split(",") if b.strip()]
    else:
        # Prefer the family's spectral bands that actually exist on this item
        requested = [b for b in FAMILY_DOWNLOAD_ASSETS.get(family, []) if b in available_keys]

    if not requested:
        # Fall back to every GeoTIFF-like asset
        requested = [
            k for k, a in assets.items()
            if (a.get("type", "") or "").startswith("image/")
        ]

    try:
        signed = resolve_asset_hrefs(item, requested, family)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not signed:
        raise HTTPException(
            status_code=404,
            detail=f"هیچ باندی برای دانلود یافت نشد. موجود: {', '.join(sorted(available_keys))}",
        )

    links = []
    for key, url in signed.items():
        # Guess filename extension
        ext = ".tif"
        lower = key.lower()
        if lower.endswith((".txt", ".xml", ".json", ".tif", ".tiff")):
            ext = ""
        mpc_key = map_asset_key(key, family)
        filename = f"{normalize_scene_id(item.get('id', scene_id))}_{mpc_key}{ext}"
        links.append({
            "band": key,
            "label": BAND_LABELS.get(key) or BAND_LABELS.get(mpc_key, key),
            "url": url,
            "filename": filename,
        })

    return JSONResponse(content={
        "success": True,
        "scene_id": item.get("id", scene_id),
        "links": links,
        "total": len(links),
    })


# === Process Models ===

class ProcessRequest(BaseModel):
    scene_id: Optional[str] = None  # Backward-compatible single-scene input
    scene_ids: List[str] = Field(default_factory=list)
    dataset: str
    process_type: str  # crop, ndvi, ndwi, evi, truecolor, falsecolor, custom_band
    bounds: Optional[Dict[str, float]] = None  # north, south, east, west
    bands: List[str] = []

    @field_validator('scene_id')
    @classmethod
    def validate_scene_id(cls, v):
        return v.strip() if v else v

    def model_post_init(self, __context):
        if not self.scene_ids and self.scene_id:
            self.scene_ids = [self.scene_id]
        self.scene_ids = [scene_id.strip() for scene_id in self.scene_ids if scene_id and scene_id.strip()]
        if not self.scene_ids:
            raise ValueError('At least one scene_id is required')

    @field_validator('process_type')
    @classmethod
    def validate_process_type(cls, v):
        valid_types = ['crop', 'ndvi', 'ndwi', 'evi', 'truecolor', 'falsecolor', 'custom_band', 'hillshade', 'elevation']
        if v not in valid_types:
            raise ValueError(f'Invalid process type. Must be one of: {valid_types}')
        return v


DEFAULT_PROCESS_BANDS = {
    'ndvi': ['nir', 'red'],
    'ndwi': ['green', 'nir'],
    'evi': ['blue', 'red', 'nir'],
    'truecolor': ['red', 'green', 'blue'],
    'falsecolor': ['nir', 'red', 'green'],
    'custom_band': ['red', 'green', 'blue'],
    'crop': ['red', 'green', 'blue', 'nir', 'swir16', 'swir22'],
    'hillshade': ['dem'],
    'elevation': ['dem'],
}


# === Process Endpoint (queue-based) ===

def _update_job(job_id: str, **fields) -> None:
    """Thread-safe partial update of a job record."""
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)


@router.post("/process")
async def enqueue_process(request: ProcessRequest):
    """
    Enqueue a processing request. The job runs in the background and its
    progress can be followed via GET /jobs/{job_id}. Returns HTTP 202.
    """
    dataset_code = request.dataset.upper()
    if dataset_code not in DATASET_CONFIGS:
        raise HTTPException(status_code=400, detail=f"دیتاست نامعتبر: {request.dataset}")

    job_id = uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat()
    with JOBS_LOCK:
        JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0,
            "message": "در صف پردازش قرار گرفت",
            "dataset": dataset_code,
            "process_type": request.process_type,
            "scene_ids": request.scene_ids,
            "scene_id": None,
            "created_at": now,
            "started_at": None,
            "finished_at": None,
            "download_url": None,
            "preview_url": None,
            "output_path": None,
            "error": None,
        }
    JOB_QUEUE.put((job_id, request))

    return JSONResponse(
        status_code=202,
        content={
            "success": True,
            "job_id": job_id,
            "status": "queued",
            "job_url": f"/landsat/jobs/{job_id}",
        },
    )


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Return the current status of a processing job."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="کار پردازش یافت نشد")
    return job


@router.get("/jobs")
async def list_jobs():
    """List recent processing jobs (newest first)."""
    with JOBS_LOCK:
        jobs = sorted(JOBS.values(), key=lambda j: j.get("created_at") or "", reverse=True)
    return {"jobs": jobs, "total": len(jobs)}


def _run_job(job_id: str, request: ProcessRequest) -> None:
    """Execute a queued processing job in the background worker thread."""
    try:
        dataset_code = request.dataset.upper()
        family = DATASET_CONFIGS[dataset_code]["family"]

        _update_job(job_id, status="running", started_at=datetime.utcnow().isoformat(),
                    progress=5, message="در حال دریافت اطلاعات صحنه‌ها...")

        # Fetch all selected STAC items. Matching bands are mosaicked before
        # cropping or calculating indices.
        items = []
        for requested_scene_id in request.scene_ids:
            item = fetch_stac_item(requested_scene_id)
            if not item:
                raise RuntimeError(f"صحنه {requested_scene_id} یافت نشد")
            items.append(item)

        scene_ids = [item.get("id", normalize_scene_id(requested_id))
                     for item, requested_id in zip(items, request.scene_ids)]
        scene_id = scene_ids[0] if len(scene_ids) == 1 else (
            f"merged_{hashlib.md5('|'.join(scene_ids).encode()).hexdigest()[:12]}"
        )

        # Determine required canonical bands based on process type
        required_bands = request.bands or DEFAULT_PROCESS_BANDS.get(
            request.process_type, ['red', 'green', 'blue']
        )
        # Sentinel-1 has only SAR polarizations; limit crop output to VV
        if family == "sentinel1":
            required_bands = ['vv']
        # DEM has a single elevation band
        if family == "dem":
            required_bands = ['dem']

        _update_job(job_id, scene_id=scene_id,
                    message=f"در حال دانلود باندهای مورد نیاز برای {len(scene_ids)} صحنه...")

        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            band_paths = {}

            scene_band_paths: Dict[str, List[Path]] = {band: [] for band in required_bands}
            band_calibration: Dict[str, tuple[float, float]] = {}
            download_tasks: List[tuple[Path, str, str]] = []

            for item, item_scene_id in zip(items, scene_ids):
                try:
                    asset_urls = resolve_asset_hrefs(item, required_bands, family)
                except RuntimeError as e:
                    raise RuntimeError(str(e))

                if not asset_urls:
                    available = sorted(item.get("assets", {}).keys())
                    raise RuntimeError(
                        f"هیچ یک از باندهای مورد نیاز برای {item_scene_id} یافت نشد. "
                        f"موجود: {', '.join(available)}"
                    )

                scene_dir = tmpdir_path / normalize_scene_id(item_scene_id)
                scene_dir.mkdir(parents=True, exist_ok=True)
                for band_key, url in asset_urls.items():
                    if not url:
                        continue
                    if band_key not in band_calibration:
                        band_calibration[band_key] = get_asset_calibration(item, band_key, family)
                    mpc_key = map_asset_key(band_key, family)
                    dest_path = scene_dir / f"{normalize_scene_id(item_scene_id)}_{mpc_key}.tif"
                    download_tasks.append((dest_path, band_key, url))

            total_downloads = len(download_tasks)
            for i, (dest_path, band_key, url) in enumerate(download_tasks, start=1):
                try:
                    download_file_streaming(url, dest_path)
                    scene_band_paths[band_key].append(dest_path)
                except Exception as e:
                    raise RuntimeError(f"دانلود باند {band_key} ناموفق بود: {str(e)}")
                _update_job(
                    job_id,
                    progress=10 + int(45 * i / max(total_downloads, 1)),
                    message=f"در حال دانلود باند {i}/{total_downloads}...",
                )

            missing_bands = [band for band, paths in scene_band_paths.items() if not paths]
            if missing_bands:
                raise RuntimeError(f"باندهای مورد نیاز یافت نشدند: {', '.join(missing_bands)}")

            # Mosaic each matching band. A single input is kept as-is.
            for band_key, paths in scene_band_paths.items():
                if len(paths) == 1:
                    band_paths[band_key] = paths[0]
                    continue

                mosaic, mosaic_transform = merge_rasters(paths)
                with rasterio.open(paths[0]) as source:
                    mosaic_profile = source.profile.copy()
                mosaic_profile.update(
                    height=mosaic.shape[1],
                    width=mosaic.shape[2],
                    transform=mosaic_transform,
                    count=1,
                )
                mosaic_path = tmpdir_path / f"merged_{band_key}.tif"
                with rasterio.open(mosaic_path, "w", **mosaic_profile) as destination:
                    destination.write(mosaic[0], 1)
                band_paths[band_key] = mosaic_path

            _update_job(job_id, progress=60, message=f"در حال پردازش ({request.process_type})...")

            # Process based on type. process_bands/generate_preview are async
            # in signature but synchronous in body; run them via asyncio.run.
            output_path = asyncio.run(process_bands(
                band_paths=band_paths,
                process_type=request.process_type,
                bounds=request.bounds,
                scene_id=scene_id,
                output_dir=tmpdir_path,
                calibration=band_calibration,
            ))

            # Move final result to downloads dir
            final_dir = DOWNLOADS_DIR
            final_dir.mkdir(parents=True, exist_ok=True)
            final_filename = f"{scene_id}_{request.process_type}.tif"
            final_path = final_dir / final_filename
            shutil.copy2(output_path, final_path)

            _update_job(job_id, progress=90, message="در حال ساخت پیش‌نمایش...")

            preview_url = None
            try:
                preview_url = asyncio.run(generate_preview(
                    output_path, final_dir, scene_id, request.process_type
                ))
            except Exception:
                pass

        _update_job(
            job_id,
            status="success",
            progress=100,
            finished_at=datetime.utcnow().isoformat(),
            output_path=str(final_path),
            download_url=f"/landsat/download-processed?path={final_filename}",
            preview_url=preview_url,
            message="پردازش با موفقیت انجام شد",
        )
    except HTTPException as e:
        _update_job(job_id, status="failed", error=str(e.detail),
                    finished_at=datetime.utcnow().isoformat())
    except Exception as e:
        _update_job(job_id, status="failed", error=f"خطا در پردازش: {str(e)}",
                    finished_at=datetime.utcnow().isoformat())
        print(f"Job {job_id} failed:\n{traceback.format_exc()}")


def _job_worker() -> None:
    """Consume queued jobs one at a time and execute them."""
    while True:
        job_id, request = JOB_QUEUE.get()
        try:
            _run_job(job_id, request)
        finally:
            JOB_QUEUE.task_done()


# Start the background processing worker on import.
threading.Thread(target=_job_worker, daemon=True, name="process-worker").start()


async def process_bands(band_paths: Dict[str, Path], process_type: str,
                         bounds: Optional[Dict[str, float]], scene_id: str,
                         output_dir: Path,
                         calibration: Optional[Dict[str, tuple[float, float]]] = None) -> Path:
    """Process bands based on process type using rasterio."""
    import numpy as np

    ref_key = next(iter(band_paths))
    with rasterio.open(band_paths[ref_key]) as ref_src:
        ref_crs = ref_src.crs
        if bounds:
            if not ref_crs:
                raise ValueError("Raster CRS is missing; crop bounds cannot be transformed")

            # The UI supplies WGS84 longitude/latitude, while assets use a
            # projected CRS. Transform the requested region before creating
            # the raster window.
            projected_bounds = transform_bounds(
                "EPSG:4326",
                ref_crs,
                bounds['west'], bounds['south'],
                bounds['east'], bounds['north'],
                densify_pts=21,
            )
            ref_window = from_bounds(*projected_bounds, transform=ref_src.transform)
            ref_window = ref_window.round_offsets().round_lengths()
            ref_window = ref_window.intersection(
                rasterio.windows.Window(0, 0, ref_src.width, ref_src.height)
            )
            if ref_window.width <= 0 or ref_window.height <= 0:
                raise ValueError("The crop region does not overlap the selected scene")

            ref_transform = ref_src.window_transform(ref_window)
            ref_shape = (ref_window.height, ref_window.width)
        else:
            projected_bounds = None
            ref_transform = ref_src.transform
            ref_shape = (ref_src.height, ref_src.width)

    # Read required bands. Every band is read on its own pixel grid (native
    # resolution) and then resampled to the reference grid so that mixed
    # resolution datasets (e.g. Sentinel-2) produce aligned, stackable arrays.
    band_data = {}
    profile = None
    for band_key, path in band_paths.items():
        with rasterio.open(path) as src:
            if profile is None:
                profile = src.profile.copy()

            if projected_bounds is not None:
                window = from_bounds(*projected_bounds, transform=src.transform)
                window = window.round_offsets().round_lengths()
                window = window.intersection(
                    rasterio.windows.Window(0, 0, src.width, src.height)
                )
                if window.width <= 0 or window.height <= 0:
                    raise ValueError("The crop region does not overlap the selected scene")
                arr = src.read(1, window=window)
                out_transform = src.window_transform(window)
            else:
                arr = src.read(1)
                out_transform = src.transform

            # Crop-only output keeps the original pixel dtype and values.
            # Analytical/composite operations use float32 for calculations.
            if process_type == "crop":
                data = arr
            else:
                scale, offset = (calibration or {}).get(
                    band_key,
                    (src.scales[0] if src.scales else 1.0,
                     src.offsets[0] if src.offsets else 0.0),
                )
                data = arr.astype(np.float32) * scale + offset

            # Align to the reference grid if the native resolution differs
            if (ref_shape[0], ref_shape[1]) != data.shape:
                target_dtype = np.float32 if process_type != "crop" else data.dtype
                aligned = np.zeros(ref_shape, dtype=target_dtype)
                resampling = RioResampling.nearest if process_type == "crop" else RioResampling.bilinear
                reproject(
                    data, aligned,
                    src_transform=out_transform,
                    src_crs=src.crs,
                    dst_transform=ref_transform,
                    dst_crs=ref_crs,
                    resampling=resampling,
                )
                data = aligned

            band_data[band_key] = data
            profile.update({
                'height': data.shape[0],
                'width': data.shape[1],
                'transform': ref_transform,
            })

    # Process
    if process_type == 'ndvi':
        # NDVI = (NIR - Red) / (NIR + Red)
        nir = band_data.get('nir')
        red = band_data.get('red')
        if nir is None or red is None:
            raise ValueError("NDVI requires nir and red bands")
        result = np.where((nir + red) != 0, (nir - red) / (nir + red), 0)
        result = np.clip(result, -1, 1)
        result = np.where(np.isfinite(result), result, -9999).astype(np.float32)
        profile.update(dtype=rasterio.float32, count=1, nodata=-9999)

    elif process_type == 'ndwi':
        # NDWI = (Green - NIR) / (Green + NIR)
        green = band_data.get('green')
        nir = band_data.get('nir')
        if green is None or nir is None:
            raise ValueError("NDWI requires green and nir bands")
        result = np.where((green + nir) != 0, (green - nir) / (green + nir), 0)
        result = np.clip(result, -1, 1)
        result = np.where(np.isfinite(result), result, -9999).astype(np.float32)
        profile.update(dtype=rasterio.float32, count=1, nodata=-9999)

    elif process_type == 'evi':
        # EVI = 2.5 * (NIR - Red) / (NIR + 6*Red - 7.5*Blue + 1)
        nir = band_data.get('nir')
        red = band_data.get('red')
        blue = band_data.get('blue')
        if nir is None or red is None or blue is None:
            raise ValueError("EVI requires nir, red, and blue bands")
        denominator = nir + 6 * red - 7.5 * blue + 1
        result = np.where(denominator != 0, 2.5 * (nir - red) / denominator, 0)
        result = np.clip(result, -1, 1)
        result = np.where(np.isfinite(result), result, -9999).astype(np.float32)
        profile.update(dtype=rasterio.float32, count=1, nodata=-9999)

    elif process_type == 'truecolor':
        # RGB composite
        red = band_data.get('red')
        green = band_data.get('green')
        blue = band_data.get('blue')
        if red is None or green is None or blue is None:
            raise ValueError("True color requires red, green, and blue bands")
        result = np.stack([
            stretch_band(red),
            stretch_band(green),
            stretch_band(blue)
        ], axis=0)
        profile.update(dtype=rasterio.uint8, count=3)

    elif process_type == 'falsecolor':
        # False color: NIR, Red, Green
        nir = band_data.get('nir')
        red = band_data.get('red')
        green = band_data.get('green')
        if nir is None or red is None or green is None:
            raise ValueError("False color requires nir, red, and green bands")
        result = np.stack([
            stretch_band(nir),
            stretch_band(red),
            stretch_band(green)
        ], axis=0)
        profile.update(dtype=rasterio.uint8, count=3)

    elif process_type == 'custom_band':
        # Custom band combination (first 3 bands as RGB)
        bands_list = list(band_data.values())[:3]
        if len(bands_list) < 3:
            raise ValueError("Custom band requires at least 3 bands")
        result = np.stack([stretch_band(b) for b in bands_list], axis=0)
        profile.update(dtype=rasterio.uint8, count=3)

    elif process_type == 'hillshade':
        # Hillshade from the single elevation band
        dem = band_data.get(next(iter(band_data)))
        if dem is None:
            raise ValueError("hillshade requires an elevation band")
        dem = dem.astype(np.float32)
        dx, dy = np.gradient(dem, 30.0)
        slope = np.arctan(np.sqrt(dx * dx + dy * dy))
        aspect = np.arctan2(-dx, dy)
        azimuth = np.deg2rad(315.0)
        zenith = np.deg2rad(45.0)
        hs = 255 * (
            np.sin(slope) * np.cos(zenith)
            + np.cos(slope) * np.sin(zenith) * np.cos(azimuth - aspect)
        )
        hs = np.clip(hs, 0, 255).astype(np.uint8)
        result = np.stack([hs] * 3, axis=0)
        profile.update(dtype=rasterio.uint8, count=3)

    elif process_type == 'elevation':
        # Elevation with a color ramp (single band, but stored as RGB for display)
        dem = band_data.get(next(iter(band_data)))
        if dem is None:
            raise ValueError("elevation requires an elevation band")
        dem = dem.astype(np.float32)
        nodata = -9999
        mask = dem != nodata
        # Normalize to 0-1 for color ramp
        min_val = dem[mask].min() if np.any(mask) else 0.0
        max_val = dem[mask].max() if np.any(mask) else 1.0
        if max_val > min_val:
            norm = (dem - min_val) / (max_val - min_val)
        else:
            norm = np.zeros_like(dem)
        norm = np.where(np.isfinite(norm), norm, 0.0)
        # Simple terrain color ramp: brown/green for low, white for high
        r = np.where(norm < 0.3, norm / 0.3 * 0.5,
                   np.where(norm < 0.6, 0.5 + (norm - 0.3) / 0.3 * 0.3,
                            0.8 + (norm - 0.6) / 0.4 * 0.2))
        g = np.where(norm < 0.3, norm / 0.3 * 0.7,
                   np.where(norm < 0.6, 0.7 + (norm - 0.3) / 0.3 * 0.2,
                            0.9 + (norm - 0.6) / 0.4 * 0.1))
        b = np.where(norm < 0.5, norm / 0.5 * 0.3,
                   np.where(norm < 0.8, 0.3 + (norm - 0.5) / 0.3 * 0.4,
                            0.7 + (norm - 0.8) / 0.2 * 0.3))
        r = np.clip(r * 255, 0, 255).astype(np.uint8)
        g = np.clip(g * 255, 0, 255).astype(np.uint8)
        b = np.clip(b * 255, 0, 255).astype(np.uint8)
        result = np.stack([r, g, b], axis=0)
        profile.update(dtype=rasterio.uint8, count=3)

    else:  # crop
        # Just crop and stack all bands without rescaling or changing dtype.
        bands_list = list(band_data.values())
        result = np.stack(bands_list, axis=0)
        profile.update(dtype=band_data[next(iter(band_data))].dtype, count=len(bands_list))

    # Write output
    output_path = output_dir / f"{scene_id}_{process_type}.tif"
    with rasterio.open(output_path, 'w', **profile) as dst:
        if result.ndim == 2:
            dst.write(result, 1)
        else:
            for i in range(result.shape[0]):
                dst.write(result[i], i + 1)

    return output_path


def stretch_band(arr: np.ndarray, lower: float = 2, upper: float = 98) -> np.ndarray:
    """Apply percentile stretch for visualization."""
    p_low, p_high = np.percentile(arr, (lower, upper))
    if p_high > p_low:
        stretched = np.clip((arr - p_low) / (p_high - p_low) * 255, 0, 255)
    else:
        stretched = np.zeros_like(arr)
    return stretched.astype(np.uint8)


async def generate_preview(tif_path: Path, output_dir: Path, scene_id: str, process_type: str) -> Optional[str]:
    """Generate a small JPEG preview from the processed TIFF."""
    try:
        preview_path = output_dir / f"{scene_id}_{process_type}_preview.jpg"
        with rasterio.open(tif_path) as src:
            # Read first 3 bands or just first band
            count = min(3, src.count)
            data = src.read(list(range(1, count + 1)))

            if count >= 3:
                # RGB preview
                rgb = np.stack([stretch_band(data[i]) for i in range(3)], axis=-1)
            else:
                # Single band grayscale
                rgb = np.stack([stretch_band(data[0])] * 3, axis=-1)

            # Downsample if too large
            h, w = rgb.shape[:2]
            max_dim = 512
            if max(h, w) > max_dim:
                scale = max_dim / max(h, w)
                new_h, new_w = int(h * scale), int(w * scale)
                from PIL import Image
                img = Image.fromarray(rgb)
                img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
            else:
                from PIL import Image
                img = Image.fromarray(rgb)

            img.save(preview_path, 'JPEG', quality=85)

        return f"/landsat/preview?path={preview_path.name}"
    except Exception as e:
        print(f"Preview generation failed: {e}")
        return None


@router.get("/download-processed")
async def download_processed(path: str = Query(..., description="Filename in downloads directory")):
    """Download a processed file."""
    try:
        file_path = safe_path(DOWNLOADS_DIR, path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="فایل یافت نشد")
        return FileResponse(file_path, media_type="application/octet-stream", filename=path)
    except ValueError:
        raise HTTPException(status_code=400, detail="مسیر نامعتبر")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/preview")
async def get_preview(path: str = Query(..., description="Preview filename")):
    """Serve preview image."""
    try:
        file_path = safe_path(DOWNLOADS_DIR, path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="پیش‌نمایش یافت نشد")
        return FileResponse(file_path, media_type="image/jpeg")
    except ValueError:
        raise HTTPException(status_code=400, detail="مسیر نامعتبر")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
