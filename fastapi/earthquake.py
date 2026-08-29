"""USGS Earthquake Catalog search and vector export endpoints."""

import io
import json
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import geopandas as gpd
import pandas as pd
import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from shapely.geometry import Point

router = APIRouter()
USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
ALLOWED_FORMATS = {"shp", "geojson", "gpkg", "csv"}


def _usgs_params(
    north: float, south: float, east: float, west: float,
    starttime: str, endtime: str, minmagnitude: Optional[float],
    maxmagnitude: Optional[float], mindepth: Optional[float],
    maxdepth: Optional[float], alertlevel: Optional[str],
    eventtype: Optional[str], orderby: str, limit: int, offset: int,
    catalog: Optional[str], contributor: Optional[str], query_pairs: Optional[str],
) -> Dict[str, Any]:
    if north <= south or east <= west:
        raise HTTPException(status_code=400, detail="محدوده جغرافیایی نامعتبر است")
    if minmagnitude is not None and maxmagnitude is not None and minmagnitude > maxmagnitude:
        raise HTTPException(status_code=400, detail="حداقل بزرگی باید کمتر از حداکثر بزرگی باشد")
    if mindepth is not None and maxdepth is not None and mindepth > maxdepth:
        raise HTTPException(status_code=400, detail="حداقل عمق باید کمتر از حداکثر عمق باشد")
    allowed_extra = {"format", "starttime", "endtime", "minlatitude", "maxlatitude", "minlongitude", "maxlongitude",
                     "minmagnitude", "maxmagnitude", "mindepth", "maxdepth", "includeallorigins",
                     "includeallmagnitudes", "includearrivals", "includedeleted", "includesuperseded", "reviewstatus",
                     "eventtype", "producttype", "idlist", "eventid", "limit", "offset", "orderby", "alertlevel",
                     "catalog", "contributor"}
    extras = {}
    if query_pairs:
        try:
            pairs = json.loads(query_pairs)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="پارامترهای اضافی USGS معتبر نیستند")
        if not isinstance(pairs, list):
            raise HTTPException(status_code=400, detail="پارامترهای اضافی USGS باید به صورت فهرست باشند")
        for pair in pairs:
            key = str(pair.get("key", "")).strip().lower() if isinstance(pair, dict) else ""
            value = str(pair.get("value", "")).strip() if isinstance(pair, dict) else ""
            if key and value:
                if key not in allowed_extra:
                    raise HTTPException(status_code=400, detail=f"پارامتر USGS پشتیبانی نمی‌شود: {key}")
                extras[key] = value
    params = {
        **extras,
        # Keep the required UI values authoritative if duplicated as extras.
        "format": "geojson", "starttime": starttime, "endtime": endtime,
        "minlatitude": south, "maxlatitude": north,
        "minlongitude": west, "maxlongitude": east,
        "orderby": orderby or extras.get("orderby", "time"),
        "limit": limit or extras.get("limit", 20000), "offset": offset or extras.get("offset", 1),
    }
    for key, value in {
        "minmagnitude": minmagnitude, "maxmagnitude": maxmagnitude,
        "mindepth": mindepth, "maxdepth": maxdepth, "alertlevel": alertlevel,
        "eventtype": eventtype, "catalog": catalog, "contributor": contributor,
    }.items():
        if value not in (None, ""):
            params[key] = value
    return params


def _fetch(params: Dict[str, Any]) -> Dict[str, Any]:
    try:
        response = requests.get(USGS_QUERY_URL, params=params, timeout=120)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"خطا در دریافت داده از USGS: {exc}")
    except ValueError:
        raise HTTPException(status_code=502, detail="پاسخ USGS معتبر نیست")
    if payload.get("type") != "FeatureCollection":
        raise HTTPException(status_code=502, detail="ساختار پاسخ USGS معتبر نیست")
    return payload


def _properties(feature: Dict[str, Any]) -> Dict[str, Any]:
    props = dict(feature.get("properties") or {})
    if props.get("time") is not None:
        props["time"] = datetime.fromtimestamp(props["time"] / 1000, tz=timezone.utc).isoformat()
    if props.get("updated") is not None:
        props["updated"] = datetime.fromtimestamp(props["updated"] / 1000, tz=timezone.utc).isoformat()
    # USGS includes nested ``products`` metadata; flatten it for GIS drivers.
    return {key: (json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value)
            for key, value in props.items()}


def _gdf(features: list) -> gpd.GeoDataFrame:
    rows = []
    for feature in features:
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        row = _properties(feature)
        row["event_id"] = feature.get("id")
        row["longitude"] = coords[0]
        row["latitude"] = coords[1]
        row["depth_km"] = coords[2] if len(coords) > 2 else None
        rows.append({**row, "geometry": Point(coords[0], coords[1])})
    if not rows:
        return gpd.GeoDataFrame({"geometry": gpd.GeoSeries([], dtype="geometry")}, crs="EPSG:4326")
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def _payload_gdf(payload: Dict[str, Any]) -> gpd.GeoDataFrame:
    """Load the actual USGS GeoJSON response through GeoPandas."""
    features = payload.get("features", [])
    if not features:
        return _gdf([])
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    frame = gpd.read_file(io.BytesIO(raw))
    if "id" in frame.columns:
        frame = frame.rename(columns={"id": "event_id"})
    if "geometry" in frame.columns:
        frame["longitude"] = frame.geometry.x
        frame["latitude"] = frame.geometry.y
        frame["depth_km"] = frame.geometry.apply(lambda geometry: geometry.z if geometry.has_z else None)
    for column in ("time", "updated"):
        if column in frame.columns:
            frame[column] = pd.to_datetime(frame[column], errors="coerce", utc=True).astype("string")
    return frame


def _export_frame(frame: gpd.GeoDataFrame, path, driver: str) -> None:
    """Write with a portable schema; DBF field names are especially strict."""
    # Keep binary GIS drivers away from optional/nested USGS metadata whose
    # inferred type can vary between records and fail on different platforms.
    fields = ["event_id", "mag", "magType", "place", "time", "updated", "status",
              "tsunami", "sig", "net", "code", "type", "longitude", "latitude", "depth_km", "geometry"]
    output = frame[[column for column in fields if column in frame.columns]].copy()
    names = {}
    used = set()
    for column in output.columns:
        if column == "geometry":
            continue
        safe = re.sub(r"[^A-Za-z0-9_]", "_", str(column))[:10] or "field"
        base = safe
        index = 1
        while safe.lower() in used:
            suffix = str(index)
            safe = (base[:10 - len(suffix)] + suffix)[:10]
            index += 1
        used.add(safe.lower())
        names[column] = safe
    output = output.rename(columns=names)
    output.to_file(str(path), driver=driver, engine="pyogrio", encoding="UTF-8")


def _export_gdf(frame: gpd.GeoDataFrame, fmt: str) -> tuple[bytes, str, str]:
    if fmt not in ALLOWED_FORMATS:
        raise HTTPException(status_code=400, detail="فرمت خروجی پشتیبانی نمی‌شود")
    if fmt == "geojson":
        return frame.to_json().encode("utf-8"), "application/geo+json", "earthquakes.geojson"
    if fmt == "csv":
        return frame.drop(columns=["geometry"], errors="ignore").to_csv(index=False).encode("utf-8-sig"), "text/csv; charset=utf-8", "earthquakes.csv"
    if fmt == "gpkg":
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "earthquakes.gpkg"
            _export_frame(frame, path, "GPKG")
            return path.read_bytes(), "application/geopackage+sqlite3", "earthquakes.gpkg"

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        # Fiona writes the shapefile components to a temporary directory.
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "earthquakes.shp"
            _export_frame(frame, path, "ESRI Shapefile")
            for item in path.parent.glob("earthquakes.*"):
                archive.write(item, item.name)
    return stream.getvalue(), "application/zip", "earthquakes_shapefile.zip"


def _export(features: list, fmt: str) -> tuple[bytes, str, str]:
    return _export_gdf(_gdf(features), fmt)


@router.get("/search")
def earthquake_search(
    north: float = Query(...), south: float = Query(...), east: float = Query(...), west: float = Query(...),
    starttime: str = Query(...), endtime: str = Query(...), minmagnitude: Optional[float] = Query(None),
    maxmagnitude: Optional[float] = Query(None), mindepth: Optional[float] = Query(None),
    maxdepth: Optional[float] = Query(None), alertlevel: Optional[str] = Query(None),
    eventtype: Optional[str] = Query(None), orderby: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=20000), offset: Optional[int] = Query(None, ge=1),
    catalog: Optional[str] = Query(None), contributor: Optional[str] = Query(None), query_pairs: Optional[str] = Query(None),
):
    params = _usgs_params(north, south, east, west, starttime, endtime, minmagnitude, maxmagnitude,
                          mindepth, maxdepth, alertlevel, eventtype, orderby, limit, offset, catalog, contributor, query_pairs)
    payload = _fetch(params)
    return {
        "success": True, "type": "earthquake", "count": payload.get("metadata", {}).get("count", len(payload.get("features", []))),
        "features": payload.get("features", []), "query": params,
        "message": f"{len(payload.get('features', []))} زمین‌لرزه از USGS یافت شد",
    }


class EarthquakeExportRequest(BaseModel):
    features: list = Field(default_factory=list)
    format: str


@router.post("/export")
def earthquake_export(request: EarthquakeExportRequest):
    try:
        content, media_type, filename = _export(request.features, request.format)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"خطا در تبدیل داده‌های زمین‌لرزه: {exc}")
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/export")
def earthquake_export_from_query(
    format: str = Query(...),
    north: float = Query(...), south: float = Query(...), east: float = Query(...), west: float = Query(...),
    starttime: str = Query(...), endtime: str = Query(...), minmagnitude: Optional[float] = Query(None),
    maxmagnitude: Optional[float] = Query(None), mindepth: Optional[float] = Query(None),
    maxdepth: Optional[float] = Query(None), alertlevel: Optional[str] = Query(None),
    eventtype: Optional[str] = Query(None), orderby: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=20000), offset: Optional[int] = Query(None, ge=1),
    catalog: Optional[str] = Query(None), contributor: Optional[str] = Query(None),
    query_pairs: Optional[str] = Query(None),
):
    """Refetch from USGS and export server-side, avoiding a large browser POST."""
    params = _usgs_params(north, south, east, west, starttime, endtime, minmagnitude, maxmagnitude,
                          mindepth, maxdepth, alertlevel, eventtype, orderby, limit, offset,
                          catalog, contributor, query_pairs)
    payload = _fetch(params)
    try:
        content, media_type, filename = _export_gdf(_payload_gdf(payload), format)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"خطا در تبدیل داده‌های زمین‌لرزه: {exc}")
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
