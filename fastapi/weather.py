"""
Shahrkavi - Weather Stations Router.

Weather-station data is provided by the Meteostat Python package (meteostat.net),
which bundles a global station database and serves real daily observations
(NOAA / synoptic stations).

Endpoints:
  GET /weather/search   -> stations inside the search region, with per-station
                           daily summary statistics and a per-station download URL
  GET /weather/download -> daily records for one station as a CSV file
"""

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from io import StringIO
from typing import Dict, List, Optional

import requests

# Configure Meteostat's cache / station database *before* importing it, so the
# config service reads these paths at import time.
_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "meteostat")
os.environ.setdefault("MS_CACHE_DIR", _CACHE_DIR)
os.environ.setdefault("MS_STATIONS_DB_FILE", os.path.join(_CACHE_DIR, "stations.db"))
os.environ.setdefault("MS_CACHE_TTL", "2592000")
# Bound how long a single daily-data fetch may take, so stations that are
# slow / unavailable fail quickly instead of stalling the whole search.
os.environ.setdefault("MS_NETWORK_TIMEOUT", "10")

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from meteostat import Parameter, daily, stations as stations_service

router = APIRouter()

# Daily parameters exposed by Meteostat (full set). Wind direction is not
# part of Meteostat's daily dataset, so it is intentionally omitted.
DAILY_PARAMETERS: List[Parameter] = [
    Parameter.TEMP,
    Parameter.TMIN,
    Parameter.TMAX,
    Parameter.RHUM,
    Parameter.PRCP,
    Parameter.SNWD,
    Parameter.WSPD,
    Parameter.WPGT,
    Parameter.PRES,
    Parameter.TSUN,
    Parameter.CLDC,
]

# Columns (lower-cased Meteostat parameter names) in the daily DataFrame.
DAILY_COLUMNS: List[str] = [p.value for p in DAILY_PARAMETERS]

# Open-Meteo fallback provider: free ERA5 reanalysis with no API key, covering
# the full archive (1940 -> ~5 days ago). Used when Meteostat's bulk daily data
# lags behind the requested range (it currently publishes up to ~Jan 2026).
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
_OM_DAILY_VARS = (
    "temperature_2m_mean,temperature_2m_max,temperature_2m_min,"
    "precipitation_sum,snowfall_sum,wind_gusts_10m_max,sunshine_duration"
)
_OM_HOURLY_VARS = "relative_humidity_2m,pressure_msl,cloud_cover,wind_speed_10m"

SOURCE_LABELS = {
    "meteostat": "Meteostat (meteostat.net) — داده‌های روزانه ایستگاه‌های هواشناسی",
    "open-meteo": "Open-Meteo (open-meteo.com) — داده‌های ERA5 «بهترین برازش»",
}

# Persian labels + units used for the CSV header / table tooltips.
VARIABLE_LABELS: Dict[str, str] = {
    "temp": "میانگین دما (°C)",
    "tmin": "حداقل دما (°C)",
    "tmax": "حداکثر دما (°C)",
    "rhum": "رطوبت نسبی (%)",
    "prcp": "بارش (mm)",
    "snwd": "عمق برف (mm)",
    "wspd": "سرعت باد (km/h)",
    "wpgt": "بیشترین تندباد (km/h)",
    "pres": "فشار هوا (hPa)",
    "tsun": "ساعات آفتابی (دقیقه)",
    "cldc": "پوشش ابر (%)",
}

# How many stations (inside the region) get summary statistics computed at
# search time. Larger regions degrade gracefully - remaining stations are
# still listed and downloadable, just without the pre-computed summary.
MAX_SUMMARY_STATIONS = 60
# Hard deadline (seconds) for the whole summary-computation phase. Anything
# that hasn't finished by then is skipped so the /weather/search response is
# always fast (well below the frontend's request timeout).
SUMMARY_DEADLINE = 18
SUMMARY_WORKERS = 8

STATION_SQL = """
    SELECT s.id, n.name, s.country, s.region, s.latitude, s.longitude,
           s.elevation, s.timezone
    FROM stations s
    LEFT JOIN names n ON n.station = s.id AND n.language = 'en'
    WHERE s.latitude BETWEEN :south AND :north
      AND s.longitude BETWEEN :west AND :east
"""


def _gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple:
    """Convert a Gregorian date to Jalali (Shamsi). Mirrors the JS version."""
    g_dm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    jy = 0 if gy <= 1600 else 979
    gy = gy - 621 if gy <= 1600 else gy - 1600
    gy2 = gy + 1 if gm > 2 else gy
    days = (
        365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100
        + (gy2 + 399) // 400 - 80 + gd + g_dm[gm - 1]
    )
    jy += 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    jy += (days - 1) // 365
    if days > 365:
        days = (days - 1) % 365
    jm = 1 + days // 31 if days < 186 else 7 + (days - 186) // 30
    jd = 1 + (days % 31 if days < 186 else (days - 186) % 30)
    return jy, jm, jd


def _jalali_str(dt: date) -> str:
    jy, jm, jd = _gregorian_to_jalali(dt.year, dt.month, dt.day)
    return f"{jy}/{jm:02d}/{jd:02d}"


def _parse_date(value: Optional[str], name: str) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{name} نامعتبر است (فرمت YYYY-MM-DD)")


def _bbox_param(north: float, south: float, east: float, west: float) -> Dict[str, float]:
    if north <= south or east <= west:
        raise HTTPException(status_code=400, detail="محدوده جغرافیایی نامعتبر است")
    return {"north": north, "south": south, "east": east, "west": west}


def _fetch_meteostat(station_id: str, start: date, end: date) -> Optional[pd.DataFrame]:
    """Fetch a station's daily records from Meteostat (station observations)."""
    try:
        ts = daily(station_id, start, end, parameters=DAILY_PARAMETERS)
        df = ts.fetch()
    except Exception:
        return None
    if df is None or df.empty:
        return None
    df = df.copy()
    df.columns = [c.value if isinstance(c, Parameter) else str(c) for c in df.columns]
    return df


def _fetch_openmeteo(
    lat: float, lon: float, tz: Optional[str], start: date, end: date
) -> Optional[pd.DataFrame]:
    """Fetch daily records from Open-Meteo, normalized to the DAILY_COLUMNS schema.

    Open-Meteo's archive API serves the full requested range (including recent
    dates Meteostat has not published yet). Daily aggregates are used for
    temperatures/precipitation/wind-gusts/sunshine; humidity, pressure, cloud
    cover and mean wind speed are derived from the hourly response.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": _OM_DAILY_VARS,
        "hourly": _OM_HOURLY_VARS,
        "timezone": tz or "UTC",
        "temperature_unit": "celsius",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "models": "best_match",
    }
    # The free archive API can occasionally hang or throttle under parallel
    # bursts, so retry with a short backoff instead of failing straight away.
    payload = None
    for attempt in range(3):
        try:
            resp = requests.get(OPEN_METEO_ARCHIVE, params=params, timeout=12)
            if resp.status_code == 429:
                retry_after = resp.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 1.0 * (attempt + 1))
                continue
            resp.raise_for_status()
            payload = resp.json()
            break
        except Exception:
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
    if payload is None:
        return None

    daily_block = payload.get("daily") or {}
    times = daily_block.get("time")
    if not times:
        return None

    idx = pd.DatetimeIndex(pd.to_datetime(times))
    n = len(times)
    rows: Dict[str, pd.Series] = {}
    for col, om_col in (
        ("temp", "temperature_2m_mean"),
        ("tmin", "temperature_2m_min"),
        ("tmax", "temperature_2m_max"),
        ("prcp", "precipitation_sum"),
        ("snwd", "snowfall_sum"),
        ("wpgt", "wind_gusts_10m_max"),
        ("tsun", "sunshine_duration"),
    ):
        values = daily_block.get(om_col) or [None] * n
        rows[col] = pd.Series(pd.to_numeric(values, errors="coerce").astype(float), index=idx)

    # Hourly-derived daily means for humidity, pressure, cloud cover, wind speed.
    hourly_block = payload.get("hourly") or {}
    htimes = hourly_block.get("time")
    if htimes:
        hidx = pd.DatetimeIndex(pd.to_datetime(htimes))
        for col, om_col in (
            ("rhum", "relative_humidity_2m"),
            ("pres", "pressure_msl"),
            ("cldc", "cloud_cover"),
            ("wspd", "wind_speed_10m"),
        ):
            values = hourly_block.get(om_col)
            if not values:
                continue
            series = pd.Series(pd.to_numeric(values, errors="coerce").astype(float), index=hidx)
            daily_means = series.groupby(series.index.normalize()).mean()
            rows[col] = daily_means.reindex(idx)

    df = pd.DataFrame(rows, index=idx)
    for col in DAILY_COLUMNS:
        if col not in df.columns:
            df[col] = float("nan")
    return df[DAILY_COLUMNS]


def _fetch_daily(
    station_id: str,
    lat: Optional[float],
    lon: Optional[float],
    tz: Optional[str],
    start: date,
    end: date,
) -> tuple:
    """Fetch a station's daily records, preferring Meteostat and falling back
    to Open-Meteo when Meteostat lacks (most of) the requested range.

    Returns (df, source) where source is 'meteostat' or 'open-meteo'. The
    fallback keeps recent date ranges useful even though Meteostat's bulk daily
    archive lags behind by several months.
    """
    expected_days = (end - start).days + 1
    df = _fetch_meteostat(station_id, start, end)

    # Meteostat covers >= 90% of the range -> use it (real station observations).
    if df is not None and len(df) >= max(1, int(expected_days * 0.9)):
        return df, "meteostat"

    # Meteostat is missing the range (empty or only a partial early slice) ->
    # fall back to Open-Meteo, which covers the whole requested period.
    om = _fetch_openmeteo(lat, lon, tz, start, end)
    if om is not None and not om.empty:
        return om, "open-meteo"

    # Fallback failed: return whatever Meteostat had (possibly None).
    return df, "meteostat"


def _col(df: pd.DataFrame, name: str) -> pd.Series:
    return df[name] if name in df.columns else pd.Series(dtype="float64")


def _maybe(value) -> Optional[float]:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def _summary(df: Optional[pd.DataFrame]) -> Dict[str, Optional[float]]:
    if df is None or df.empty:
        return {
            "days": 0,
            "tavg_avg": None, "tmin_avg": None, "tmax_avg": None,
            "rhum_avg": None, "prcp_total": None, "snwd_max": None,
            "wspd_avg": None, "wpgt_max": None, "pres_avg": None,
            "tsun_total": None, "cldc_avg": None,
        }
    return {
        "days": int(len(df)),
        "tavg_avg": _maybe(_col(df, "temp").mean()),
        "tmin_avg": _maybe(_col(df, "tmin").mean()),
        "tmax_avg": _maybe(_col(df, "tmax").mean()),
        "rhum_avg": _maybe(_col(df, "rhum").mean()),
        "prcp_total": _maybe(_col(df, "prcp").sum()),
        "snwd_max": _maybe(_col(df, "snwd").max()),
        "wspd_avg": _maybe(_col(df, "wspd").mean()),
        "wpgt_max": _maybe(_col(df, "wpgt").max()),
        "pres_avg": _maybe(_col(df, "pres").mean()),
        "tsun_total": _maybe(_col(df, "tsun").sum()),
        "cldc_avg": _maybe(_col(df, "cldc").mean()),
    }


# === Endpoints ===


@router.get("/search")
def weather_search(
    request: Request,
    north: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    west: float = Query(...),
    dateFrom: str = Query(..., description="Start date YYYY-MM-DD"),
    dateTo: str = Query(..., description="End date YYYY-MM-DD"),
):
    """Return weather stations inside the region plus daily summary stats."""
    bbox = _bbox_param(north, south, east, west)
    start = _parse_date(dateFrom, "تاریخ شروع")
    end = _parse_date(dateTo, "تاریخ پایان")
    if start is None or end is None:
        raise HTTPException(status_code=400, detail="بازه زمانی الزامی است")
    if start > end:
        raise HTTPException(status_code=400, detail="تاریخ شروع باید قبل از تاریخ پایان باشد")

    try:
        stations_df = stations_service.query(
            STATION_SQL,
            index_col="id",
            params=bbox,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطا در بارگذاری پایگاه ایستگاه‌ها: {str(e)}")

    if stations_df.empty:
        return {
            "success": True,
            "type": "weather",
            "count": 0,
            "stations": [],
            "message": "ایستگاه هواشناسی در این محدوده یافت نشد",
        }

    stations_df = stations_df.dropna(subset=["latitude", "longitude"]).sort_values("name")
    station_ids = list(stations_df.index)
    base_url = str(request.base_url)

    def build_url(sid: str) -> str:
        return (
            f"{base_url}weather/download?station_id={sid}"
            f"&dateFrom={dateFrom}&dateTo={dateTo}"
        )

    # Compute summaries for the first batch of stations concurrently, but only
    # wait up to SUMMARY_DEADLINE seconds total. Stations that don't finish in
    # time are listed without a summary rather than stalling the request.
    summaries: Dict[str, Dict] = {}
    sources: Dict[str, str] = {}
    first_batch = station_ids[:MAX_SUMMARY_STATIONS]
    if first_batch:
        loc = {
            sid: (row["latitude"], row["longitude"], row.get("timezone"))
            for sid, row in stations_df.iterrows()
        }
        executor = ThreadPoolExecutor(max_workers=SUMMARY_WORKERS)
        futures = {
            executor.submit(_fetch_daily, sid, *loc[sid], start, end): sid
            for sid in first_batch
        }
        try:
            for future in as_completed(futures, timeout=SUMMARY_DEADLINE):
                sid = futures[future]
                try:
                    df, source = future.result()
                    sources[sid] = source
                    summaries[sid] = _summary(df)
                except Exception:
                    summaries[sid] = _summary(None)
        except TimeoutError:
            # Time budget exhausted - keep whatever finished so far and let the
            # remaining background fetches complete on their own.
            pass
        finally:
            executor.shutdown(wait=False)

    stations_out: List[Dict] = []
    for sid in station_ids:
        row = stations_df.loc[sid]
        summary = summaries.get(sid) or _summary(None)
        stations_out.append({
            "id": sid,
            "name": row.get("name") or sid,
            "country": row.get("country"),
            "region": row.get("region"),
            "latitude": round(float(row["latitude"]), 4),
            "longitude": round(float(row["longitude"]), 4),
            "elevation": _maybe(row.get("elevation")),
            "timezone": row.get("timezone"),
            "source": sources.get(sid),
            **summary,
            "download_url": build_url(sid),
        })

    return {
        "success": True,
        "type": "weather",
        "count": len(stations_out),
        "stations": stations_out,
        "message": f"{len(stations_out)} ایستگاه هواشناسی یافت شد",
    }


@router.get("/download")
def weather_download(
    station_id: str = Query(..., description="Meteostat station ID (e.g. 40754)"),
    dateFrom: str = Query(..., description="Start date YYYY-MM-DD"),
    dateTo: str = Query(..., description="End date YYYY-MM-DD"),
):
    """Download one station's daily records for the date range as CSV."""
    start = _parse_date(dateFrom, "تاریخ شروع")
    end = _parse_date(dateTo, "تاریخ پایان")
    if start is None or end is None:
        raise HTTPException(status_code=400, detail="بازه زمانی الزامی است")
    if start > end:
        raise HTTPException(status_code=400, detail="تاریخ شروع باید قبل از تاریخ پایان باشد")

    # Station metadata (name, coordinates, timezone) for the CSV + Open-Meteo fallback.
    meta = None
    try:
        meta = stations_service.meta(station_id)
    except Exception:
        pass
    name = getattr(meta, "name", None) or station_id
    lat = getattr(meta, "latitude", None)
    lon = getattr(meta, "longitude", None)
    tz = getattr(meta, "timezone", None)

    df, source = _fetch_daily(station_id, lat, lon, tz, start, end)

    # Build the CSV.
    buf = StringIO()
    buf.write("\ufeff")  # UTF-8 BOM so Excel renders Persian correctly
    buf.write("date,jalali_date," + ",".join(DAILY_COLUMNS) + "\n")
    if df is None or df.empty:
        # No data in the requested range (e.g. Meteostat's daily archive lags
        # behind recent dates and the Open-Meteo fallback was unavailable).
        # Return a valid CSV explaining this instead of a confusing error page.
        buf.write("# هیچ داده‌ای برای این ایستگاه در بازه زمانی انتخابی یافت نشد\n")
        buf.write(f"# ایستگاه: {name} ({station_id})\n")
        buf.write(f"# بازه: {dateFrom} تا {dateTo}\n")
        buf.write("# داده‌های روزانه Meteostat معمولاً چند ماه با تأخیر منتشر می‌شوند\n")
    elif not df.empty:
        for idx, values in df.iterrows():
            dt = idx.to_pydatetime().date() if hasattr(idx, "to_pydatetime") else idx.date()
            row = [dt.isoformat(), _jalali_str(dt)]
            for col in DAILY_COLUMNS:
                val = values.get(col)
                if val is None or pd.isna(val):
                    row.append("")
                else:
                    row.append(f"{float(val):.1f}")
            buf.write(",".join(row) + "\n")

    # Append the Persian variable legend as trailing metadata lines.
    buf.write("\n# توضیح متغیرها\n")
    for col in DAILY_COLUMNS:
        buf.write(f"# {col}: {VARIABLE_LABELS.get(col, col)}\n")
    buf.write(f"# منبع: {SOURCE_LABELS.get(source, source)}\n")
    if source == "open-meteo":
        buf.write("# یادآوری: snwd در Open-Meteo مجموع بارش برف (mm) است نه عمق برف\n")

    safe_name = "".join(ch for ch in name if ch.isalnum() or ch in "-_ ").strip().replace(" ", "_")
    filename = f"{safe_name or station_id}_{dateFrom}_{dateTo}.csv"

    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )