"""
Shahrkavi - OpenStreetMap (OSM) router.

Provides:
  GET /osm/tag-values?key=highway  -> available values for a tag key (Taginfo)
  GET /osm/search                  -> matching OSM features in a region (Overpass)
  GET /osm/download                -> matching OSM features as a GeoJSON file
"""

import concurrent.futures
import io
import json
import os
import tempfile
import time
import zipfile
from datetime import datetime
from typing import Dict, List, Optional

import geopandas as gpd
import pandas as pd
import requests
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from shapely.geometry import shape

router = APIRouter()

# overpass-api.de is the fastest/most reliable mirror and is used as the
# primary endpoint; the rest (including the project's own instance) are
# queried in parallel as fallbacks when the primary fails.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]
OVERPASS_PROJECT_URL = "https://overpass.shahrkavi.ir/api/interpreter"
TAGINFO_VALUES_URL = "https://taginfo.openstreetmap.org/api/4/key/values"

OVERPASS_PRIMARY_URL = OVERPASS_URLS[0]

# Runtime budget advertised to the Overpass API inside the query itself.
OVERPASS_TIMEOUT = 180
OVERPASS_CONNECT_TIMEOUT = 10
# HTTP budgets per request - bounded so a slow/offline mirror can't stall the
# whole search for minutes.
OVERPASS_PRIMARY_TIMEOUT = 60
OVERPASS_FALLBACK_TIMEOUT = 45
OVERPASS_USER_AGENT = "Shahrkavi-App/1.0"

# Direct GeoJSON downloads are only offered while the number of matching
# features stays below this limit; larger layers require the processing
# pipeline instead (the UI disables the download link in that case).
OSM_DOWNLOAD_LIMIT = 1000

# Cached tag values: key -> (fetched_at, [(value, count), ...])
_TAG_VALUES_CACHE: Dict[str, tuple[float, List[dict]]] = {}
_TAG_VALUES_TTL = 6 * 3600  # 6 hours

# === Taginfo values ===


@router.get("/tag-values")
def get_tag_values(key: str = Query(..., description="OSM tag key, e.g. highway")):
    """Return the most common values used with a given OSM key."""
    key = key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="کلید نمی‌تواند خالی باشد")

    now = time.time()
    cached = _TAG_VALUES_CACHE.get(key)
    if cached and now - cached[0] < _TAG_VALUES_TTL:
        return {"success": True, "key": key, "values": cached[1]}

    values: List[dict] = []
    try:
        resp = requests.get(
            TAGINFO_VALUES_URL,
            params={"key": key, "filter": "all", "sortname": "count",
                    "sortorder": "desc", "page": 1, "rp": 100},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])
        values = [
            {"value": item.get("value"), "count": item.get("count", 0)}
            for item in data
            if item.get("value") not in (None, "")
        ][:100]
    except Exception as e:
        print(f"Taginfo lookup failed for '{key}': {e}")

    _TAG_VALUES_CACHE[key] = (now, values)
    return {"success": True, "key": key, "values": values}


# === Overpass query builder ===


def _build_overpass_query(filters: List[dict], bbox: List[float],
                          mode: str, limit: Optional[int] = None) -> str:
    """
    Build an Overpass QL query. Each key/value pair is a separate sub-query
    and the sub-queries are UNION-ed, so multiple pairs are OR-ed together
    (an element is returned if it matches ANY of the pairs).

    bbox is [south, west, north, east]. mode is one of:
      - "count"          -> out count
      - "center"         -> out tags center
      - "geom"           -> out tags center geom
      - "geom_light"     -> out geom (no tags - just geometry for classification)
    """
    south, west, north, east = bbox
    sub_queries = []
    for f in filters:
        key = (f.get("key") or "").strip()
        if not key:
            continue
        if f.get("any") or not (f.get("value") or "").strip():
            tag = f'["{key}"]'
        else:
            value = (f.get("value") or "").strip()
            tag = f'["{key}"="{value}"]'
        sub_queries.append(f"nwr{tag}({south},{west},{north},{east});")

    if not sub_queries:
        raise ValueError("حداقل یک فیلتر کلید-مقدار الزامی است")

    union_str = "(\n" + "\n".join(sub_queries) + "\n);"

    if mode == "count":
        return f"[out:json][timeout:180];\n{union_str}\nout count;\n"

    if mode == "geom_light":
        out_mode = "geom"
    else:
        out_mode = "tags center" if mode == "center" else "tags center geom"
    limit_str = f" {limit}" if limit else ""
    return (
        f"[out:json][timeout:180];\n"
        f"{union_str}\n"
        f"out {out_mode}{limit_str};\n"
    )


def _query_overpass(url: str, query: str, read_timeout: float) -> dict:
    """POST one Overpass query to a single endpoint.

    Raises on network errors and non-retryable HTTP errors. Overpass reports
    runtime errors (e.g. query timeout) with a `remark` field even on HTTP 200
    - those are raised as RuntimeError so the caller can fail over.
    """
    resp = requests.post(
        url,
        data=query,
        timeout=(OVERPASS_CONNECT_TIMEOUT, read_timeout),
        headers={
            "Content-Type": "text/plain",
            "Accept": "application/json",
            "User-Agent": OVERPASS_USER_AGENT,
        },
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("remark"):
        raise RuntimeError(f"Overpass runtime error from {url}: {data['remark']}")
    return data


def _is_retryable_overpass_http(exc: requests.exceptions.HTTPError) -> bool:
    """True for rate-limits (429) and gateway errors (5xx); others are fatal."""
    status = exc.response.status_code if exc.response is not None else 0
    return status in (0, 429, 500, 502, 503, 504)


def _overpass_post(query: str) -> dict:
    """POST an Overpass query and return the first valid (non-empty) result.

    The primary public endpoint is queried first with a short budget - most
    queries finish there in a couple of seconds. If it fails (slow, rate
    limited or offline), all remaining endpoints are queried in parallel and
    the first valid result wins, so one slow or broken mirror can no longer
    stall the whole search.

    Overpass mirrors can return HTTP 200 with a `remark` (runtime error) or
    with an empty `elements` list while the query actually has matches. Such
    responses are treated as unreliable: an empty result is only accepted as a
    last resort once every endpoint also returned empty.
    """
    last_exc: Optional[Exception] = None
    weak_result: Optional[dict] = None

    # Primary endpoint first - fast path for the common case.
    try:
        data = _query_overpass(OVERPASS_PRIMARY_URL, query, OVERPASS_PRIMARY_TIMEOUT)
        if data.get("elements"):
            return data
        weak_result = data
    except requests.exceptions.HTTPError as exc:
        if not _is_retryable_overpass_http(exc):
            raise
        last_exc = exc
    except Exception as exc:
        last_exc = exc

    # Fallback wave - all remaining endpoints in parallel, first valid wins.
    fallbacks = [url for url in OVERPASS_URLS + [OVERPASS_PROJECT_URL]
                 if url != OVERPASS_PRIMARY_URL]
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=len(fallbacks))
    futures = [
        executor.submit(_query_overpass, url, query, OVERPASS_FALLBACK_TIMEOUT)
        for url in fallbacks
    ]
    try:
        for fut in concurrent.futures.as_completed(futures):
            try:
                data = fut.result()
            except requests.exceptions.HTTPError as exc:
                if not _is_retryable_overpass_http(exc):
                    raise
                last_exc = exc
                continue
            except Exception as exc:
                last_exc = exc
                continue
            if data.get("elements"):
                return data
            if weak_result is None:
                weak_result = data
    finally:
        # Don't wait for still-running mirrors once a result is found.
        executor.shutdown(wait=False)

    if weak_result is not None:
        return weak_result
    raise last_exc or RuntimeError("همه سرورهای Overpass در دسترس نیستند")


def _parse_filters(filters_json: Optional[str]) -> List[dict]:
    """Parse the frontend filters JSON array into a clean list."""
    if not filters_json:
        return []
    try:
        raw = json.loads(filters_json)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=400, detail="فیلترهای جستجو نامعتبر است")
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="فیلترهای جستجو نامعتبر است")

    cleaned = []
    for f in raw:
        if not isinstance(f, dict):
            continue
        key = (f.get("key") or "").strip()
        if not key:
            continue
        cleaned.append({
            "key": key,
            "value": (f.get("value") or "").strip(),
            "any": bool(f.get("any")),
        })
    return cleaned


def _element_geom_type(elem: dict) -> str:
    """Classify an Overpass element into one of point / polyline / polygon."""
    etype = elem.get("type")
    if etype == "node":
        return "point"
    if etype == "way":
        geometry = elem.get("geometry") or []
        if len(geometry) >= 4:
            first, last = geometry[0], geometry[-1]
            if first.get("lat") == last.get("lat") and first.get("lon") == last.get("lon"):
                return "polygon"
        return "polyline"
    # relations are treated as area features
    return "polygon"


def _element_to_feature(elem: dict) -> dict:
    """Convert an Overpass element (geom mode) to a GeoJSON Feature."""
    etype = elem.get("type")
    eid = elem.get("id")
    tags = elem.get("tags", {})
    geometry = elem.get("geometry")

    geom = None
    if etype == "node" and elem.get("lat") is not None:
        geom = {"type": "Point", "coordinates": [elem["lon"], elem["lat"]]}
    elif geometry:
        coords = [[pt["lon"], pt["lat"]] for pt in geometry]
        if etype == "way" and len(coords) >= 3 and coords[0] == coords[-1]:
            geom = {"type": "Polygon", "coordinates": [coords]}
        else:
            geom = {"type": "LineString", "coordinates": coords}
    elif elem.get("center"):
        center = elem["center"]
        geom = {"type": "Point", "coordinates": [center["lon"], center["lat"]]}

    return {
        "type": "Feature",
        "id": f"{etype}/{eid}",
        "properties": {"id": eid, "type": etype, "tags": tags},
        "geometry": geom,
    }


def _run_overpass(filters: List[dict], bbox: List[float],
                  mode: str, limit: Optional[int],
                  types: Optional[set] = None) -> tuple[List[dict], bool]:
    query = _build_overpass_query(filters, bbox, mode, limit)
    data = _overpass_post(query)
    elements = data.get("elements", [])
    if types:
        elements = [el for el in elements if _element_geom_type(el) in types]

    features = [_element_to_feature(el) for el in elements]
    truncated = bool(limit) and len(features) >= limit
    return features, truncated


def _run_overpass_count(filters: List[dict], bbox: List[float]) -> Optional[int]:
    """Run an Overpass count query and return the total matching elements."""
    try:
        query = _build_overpass_query(filters, bbox, "count", None)
        data = _overpass_post(query)
        total = 0
        for el in data.get("elements", []):
            if el.get("type") == "count":
                try:
                    total += int(el.get("tags", {}).get("total", 0))
                except (TypeError, ValueError):
                    pass
        return total
    except Exception as e:
        print(f"Overpass count query failed: {e}")
        return None


def _bbox_param(north: float, south: float, east: float, west: float) -> List[float]:
    if north <= south or east <= west:
        raise HTTPException(status_code=400, detail="محدوده جغرافیایی نامعتبر است")
    return [south, west, north, east]


# === Endpoints ===


@router.get("/search")
def osm_search(
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    filters: str = Query(..., description="JSON array of {key, value, any}"),
    limit: int = Query(3000, ge=1, le=10000),
):
    """Search OSM features matching the tag filters inside the region."""
    filters_list = _parse_filters(filters)
    if not filters_list:
        raise HTTPException(status_code=400, detail="حداقل یک فیلتر کلید-مقدار الزامی است")
    bbox = _bbox_param(north, south, east, west)

    try:
        features, data_truncated = _run_overpass(filters_list, bbox, "center", limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"خطا در ارتباط با سرور Overpass: {str(e)}")

    # Only ask Overpass for an exact total when the result may be truncated -
    # this avoids a second (slow) Overpass query in the common case.
    if data_truncated:
        total = _run_overpass_count(filters_list, bbox)
    else:
        total = len(features)
    count = total if total is not None else len(features)
    truncated = bool(total is not None and total > limit) or data_truncated

    download_params = (
        f"north={north}&south={south}&east={east}&west={west}"
        f"&filters={filters}"
    )

    return {
        "success": True,
        "type": "osm",
        "count": count,
        "truncated": truncated,
        "features": features,
        "download_url": f"/osm/download?{download_params}",
        "message": f"{count} عنصر یافت شد",
    }


@router.get("/search-layers")
def osm_search_layers(
    request: Request,
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    filters: str = Query(..., description="JSON array of {key, value, any}"),
    limit: int = Query(10000, ge=1, le=20000),
):
    """Return per-filter OSM layers with counts by geometry type.

    Each key/value pair becomes its own layer (highway_primary, highway_secondary,
    ...). Every layer is queried separately and its elements are classified into
    point (nodes), polyline (open ways) and polygon (closed ways / areas).
    """
    filters_list = _parse_filters(filters)
    if not filters_list:
        raise HTTPException(status_code=400, detail="حداقل یک فیلتر کلید-مقدار الزامی است")
    bbox = _bbox_param(north, south, east, west)

    layers = []
    truncated_any = False
    total = 0
    for f in filters_list:
        name_parts = [f["key"]]
        if f["value"] and not f["any"]:
            name_parts.append(f["value"])
        name = "_".join(name_parts)

        try:
            query = _build_overpass_query([f], bbox, "geom_light", limit)
            data = _overpass_post(query)
            elements = data.get("elements", [])
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"خطا در ارتباط با سرور Overpass: {str(e)}")

        counts = {"point": 0, "polyline": 0, "polygon": 0}
        for el in elements:
            counts[_element_geom_type(el)] += 1
        layer_total = counts["point"] + counts["polyline"] + counts["polygon"]
        total += layer_total
        if layer_total >= limit:
            truncated_any = True

        single_filters = json.dumps([f], ensure_ascii=False)
        base_dl = (
            f"north={north}&south={south}&east={east}&west={west}"
            f"&filters={single_filters}&limit=5000"
        )
        base_url = str(request.base_url)
        layers.append({
            "key": f["key"],
            "value": f["value"],
            "any": f["any"],
            "name": name,
            "total": layer_total,
            "counts": counts,
            "downloadable": layer_total <= OSM_DOWNLOAD_LIMIT,
            "download_url": f"{base_url}osm/download?{base_dl}",
            "download_urls": {
                t: f"{base_url}osm/download?{base_dl}&type={t}" for t in ("point", "polyline", "polygon")
            },
        })

    # Combined download covering every filter at once (not just one layer).
    all_filters = json.dumps(filters_list, ensure_ascii=False)
    combined_dl = (
        f"north={north}&south={south}&east={east}&west={west}"
        f"&filters={all_filters}&limit=5000"
    )
    base_url = str(request.base_url)

    return {
        "success": True,
        "type": "osm",
        "count": total,
        "total": total,
        "truncated": truncated_any,
        "downloadable": total <= OSM_DOWNLOAD_LIMIT,
        "download_url": f"{base_url}osm/download?{combined_dl}",
        "layers": layers,
        "message": f"{total} عنصر یافت شد",
    }


@router.get("/download")
def osm_download(
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    filters: str = Query(..., description="JSON array of {key, value, any}"),
    limit: int = Query(5000, ge=1, le=20000),
    type: Optional[str] = Query(None, description="Only download features of this geometry type: point, polyline or polygon"),
):
    """Download matching OSM features as a GeoJSON file."""
    filters_list = _parse_filters(filters)
    if not filters_list:
        raise HTTPException(status_code=400, detail="حداقل یک فیلتر کلید-مقدار الزامی است")
    bbox = _bbox_param(north, south, east, west)

    types = None
    if type:
        if type not in ("point", "polyline", "polygon"):
            raise HTTPException(status_code=400, detail="نوع هندسه نامعتبر است")
        types = {type}

    try:
        features, _ = _run_overpass(filters_list, bbox, "geom", limit, types=types)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"خطا در ارتباط با سرور Overpass: {str(e)}")

    fc = {
        "type": "FeatureCollection",
        "name": "shahrkavi_osm",
        "generated": datetime.utcnow().isoformat() + "Z",
        "filters": filters_list,
        "features": features,
    }

    key_parts = [
        f["key"] + (f"={f['value']}" if f["value"] and not f["any"] else "")
        for f in filters_list
    ]
    filename = "_".join(key_parts).replace("/", "_") or "osm"
    if type:
        filename += f"_{type}"
    content = json.dumps(fc, ensure_ascii=False, indent=2)

    return Response(
        content=content,
        media_type="application/geo+json",
        headers={
            "Content-Disposition": f'attachment; filename="osm_{filename}.geojson"'
        },
    )


# === Vector export (processing) ===


EXPORT_FORMATS = {
    "shp": ("Shapefile (ZIP)", "application/zip", "zip"),
    "geojson": ("GeoJSON", "application/geo+json", "geojson"),
    "kml": ("KML", "application/vnd.google-earth.kml+xml", "kml"),
    "gpkg": ("GeoPackage", "application/geopackage+sqlite3", "gpkg"),
    "csv": ("CSV", "text/csv", "csv"),
}


def _layer_name(f: dict) -> str:
    """Build the layer name for a filter, e.g. highway_primary."""
    parts = [f["key"]]
    if f["value"] and not f["any"]:
        parts.append(f["value"])
    return "_".join(parts).replace("/", "_")


def _geom_to_shapely(geom: Optional[dict]):
    if not geom:
        return None
    try:
        return shape(geom)
    except Exception:
        return None


def _features_to_gdf(features: List[dict]) -> gpd.GeoDataFrame:
    """Convert Overpass GeoJSON features to a GeoDataFrame (EPSG:4326).

    OSM tags become DataFrame columns; geometry is kept as shapely objects.
    Features without usable geometry are dropped.
    """
    rows = []
    geoms = []
    for f in features:
        props = f.get("properties", {})
        tags = props.get("tags", {}) or {}
        row = {
            "osm_id": props.get("id"),
            "osm_type": props.get("type"),
            "layer": props.get("layer", ""),
        }
        for k, v in tags.items():
            row[k] = v
        rows.append(row)
        geoms.append(_geom_to_shapely(f.get("geometry")))
    gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:4326")
    return gdf[gdf.geometry.notna()]


def _gdf_type_mask(gdf: gpd.GeoDataFrame, gtype: str):
    if gtype == "point":
        return gdf.geometry.geom_type == "Point"
    if gtype == "polyline":
        return gdf.geometry.geom_type == "LineString"
    return gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])


def _export_shp(features_by_layer: Dict[str, List[dict]]) -> bytes:
    """Pack one ESRI Shapefile per (layer, geometry type) into a ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for layer_name, features in features_by_layer.items():
            gdf = _features_to_gdf(features)
            if gdf.empty:
                continue
            for gtype in ("point", "polyline", "polygon"):
                subset = gdf[_gdf_type_mask(gdf, gtype)]
                if subset.empty:
                    continue
                with tempfile.TemporaryDirectory() as tmp:
                    base = os.path.join(tmp, f"{layer_name}_{gtype}")
                    subset.to_file(base + ".shp", driver="ESRI Shapefile")
                    for fn in sorted(os.listdir(tmp)):
                        zf.write(os.path.join(tmp, fn), f"{layer_name}_{gtype}/{fn}")
    return buf.getvalue()


def _export_single_file(gdf: gpd.GeoDataFrame, fmt: str) -> bytes:
    """Write a GeoDataFrame to a single GeoJSON / KML / GeoPackage file."""
    drivers = {
        "geojson": ("GeoJSON", "geojson"),
        "kml": ("KML", "kml"),
        "gpkg": ("GPKG", "gpkg"),
    }
    driver, ext = drivers[fmt]
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, f"osm.{ext}")
        gdf.to_file(path, driver=driver)
        with open(path, "rb") as fh:
            return fh.read()


def _export_csv(gdf: gpd.GeoDataFrame) -> bytes:
    """Flatten tags and geometry (as WKT) into a CSV file."""
    df = pd.DataFrame(gdf.drop(columns=["geometry"]))
    df.insert(0, "geometry", gdf.geometry.apply(lambda g: g.wkt if g is not None else ""))
    return df.to_csv(index=False).encode("utf-8")


@router.get("/export")
def osm_export(
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    filters: str = Query(..., description="JSON array of {key, value, any}"),
    limit: int = Query(5000, ge=1, le=20000),
    type: Optional[str] = Query(None, description="Only export features of this geometry type: point, polyline or polygon"),
    format: str = Query("geojson", description="Output format: shp, geojson, kml, gpkg or csv"),
):
    """Convert matching OSM features to a vector format for download.

    Shapefile output is a ZIP containing one shapefile per (layer, geometry
    type). Every other format is a single file that combines all requested
    layers - each feature keeps a ``layer`` attribute to tell them apart.
    """
    fmt = format.strip().lower()
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail="فرمت خروجی نامعتبر است")
    filters_list = _parse_filters(filters)
    if not filters_list:
        raise HTTPException(status_code=400, detail="حداقل یک فیلتر کلید-مقدار الزامی است")
    bbox = _bbox_param(north, south, east, west)

    types = None
    if type:
        if type not in ("point", "polyline", "polygon"):
            raise HTTPException(status_code=400, detail="نوع هندسه نامعتبر است")
        types = {type}

    features_by_layer: Dict[str, List[dict]] = {}
    for f in filters_list:
        try:
            features, _ = _run_overpass([f], bbox, "geom", limit, types=types)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"خطا در ارتباط با سرور Overpass: {str(e)}")
        for feat in features:
            feat.setdefault("properties", {})["layer"] = _layer_name(f)
        features_by_layer[_layer_name(f)] = features

    all_features = [ft for feats in features_by_layer.values() for ft in feats]
    if not all_features:
        raise HTTPException(status_code=404, detail="هیچ عنصری برای خروجی یافت نشد")

    if fmt == "shp":
        content = _export_shp(features_by_layer)
    elif fmt == "csv":
        content = _export_csv(_features_to_gdf(all_features))
    else:
        content = _export_single_file(_features_to_gdf(all_features), fmt)

    _, media, ext = EXPORT_FORMATS[fmt]
    name_parts = [f["key"] + (f"={f['value']}" if f["value"] and not f["any"] else "")
                  for f in filters_list]
    filename = "_".join(name_parts).replace("/", "_") or "osm"
    if type:
        filename += f"_{type}"
    filename = filename[:100]

    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="osm_{filename}.{ext}"'},
    )


# === Elevation points export (client-generated GeoJSON -> vector formats) ===


class PointsExportRequest(BaseModel):
    geojson: dict
    format: str = "shp"


def _plain_features_to_gdf(features: List[dict]) -> gpd.GeoDataFrame:
    """Convert generic GeoJSON point features to a GeoDataFrame (EPSG:4326).

    Every property becomes a column; features without usable geometry are
    dropped.
    """
    rows = []
    geoms = []
    for f in features:
        props = f.get("properties", {}) or {}
        rows.append(dict(props))
        geoms.append(_geom_to_shapely(f.get("geometry")))
    gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:4326")
    return gdf[gdf.geometry.notna()]


@router.post("/export-points")
def export_points(req: PointsExportRequest):
    """Convert a client-generated GeoJSON FeatureCollection (e.g. elevation
    sample points) into shp / geojson / kml / gpkg / csv for download."""
    fmt = (req.format or "").strip().lower()
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail="فرمت خروجی نامعتبر است")

    gj = req.geojson
    if not isinstance(gj, dict) or gj.get("type") != "FeatureCollection":
        raise HTTPException(status_code=400, detail="ورودی باید یک GeoJSON FeatureCollection باشد")
    features = [f for f in (gj.get("features") or []) if isinstance(f, dict)]
    if not features:
        raise HTTPException(status_code=400, detail="هیچ نقطه‌ای برای تبدیل وجود ندارد")

    gdf = _plain_features_to_gdf(features)
    if gdf.empty:
        raise HTTPException(status_code=400, detail="هندسه معتبری در ورودی یافت نشد")
    # Shapefile column names are limited to 10 characters
    if fmt == "shp":
        gdf.columns = [c[:10] for c in gdf.columns]

    if fmt == "shp":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            with tempfile.TemporaryDirectory() as tmp:
                base = os.path.join(tmp, "elevation_points")
                gdf.to_file(base + ".shp", driver="ESRI Shapefile")
                for fn in sorted(os.listdir(tmp)):
                    zf.write(os.path.join(tmp, fn), fn)
        content = buf.getvalue()
    elif fmt == "csv":
        content = _export_csv(gdf)
    else:
        content = _export_single_file(gdf, fmt)

    _, media, ext = EXPORT_FORMATS[fmt]
    return Response(
        content=content,
        media_type=media,
        headers={
            "Content-Disposition": 'attachment; filename="elevation_points.' + ext + '"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )
