import csv
import io
import json
import os
import uuid
import queue
import threading
import traceback
import zipfile
import tempfile
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

import geopandas as gpd
from sqlalchemy import create_engine

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    psycopg = None
    dict_row = None

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field, field_validator


router = APIRouter()

# In-memory job store for traffic exports
TRAFFIC_JOBS = {}
TRAFFIC_JOB_QUEUE = queue.Queue()


class TrafficSearchRequest(BaseModel):
    geometry: dict[str, Any]
    date_from: date | None = None
    date_to: date | None = None
    resolution: str = "daily"

    @field_validator('resolution')
    @classmethod
    def validate_resolution(cls, v: str) -> str:
        if v not in {"daily", "hourly"}:
            raise ValueError('resolution must be daily or hourly')
        return v


class TrafficExportRequest(BaseModel):
    route_codes: list[int] = Field(min_length=1, max_length=5000)
    date_from: date | None = None
    date_to: date | None = None
    format: str = "geojson"
    resolution: str = "daily"

    @field_validator('format')
    @classmethod
    def validate_format(cls, v: str) -> str:
        if v not in {"geojson", "csv", "shp"}:
            raise ValueError('format must be geojson, csv, or shp')
        return v

    @field_validator('resolution')
    @classmethod
    def validate_resolution(cls, v: str) -> str:
        if v not in {"daily", "hourly"}:
            raise ValueError('resolution must be daily or hourly')
        return v


def _update_traffic_job(job_id: str, **fields) -> None:
    if job_id in TRAFFIC_JOBS:
        TRAFFIC_JOBS[job_id].update(fields)


def _run_traffic_export_job(job_id: str, request: TrafficExportRequest) -> None:
    _update_traffic_job(job_id, status="running", started_at=datetime.utcnow().isoformat(),
                        message="در حال جستجوی داده‌ها...")
    try:
        date_from, date_to = date_bounds(request)
        date_to_exclusive = date_to + timedelta(days=1)
        table = traffic_table(request.resolution)
        sql = f"""
            SELECT
                m.counter_id,
                m.source_id,
                m.name AS counter_name,
                m.route_code,
                m.route_name,
                m.latitude,
                m.longitude,
                t.traffic_id,
                t.province,
                t.route_name AS traffic_route_name,
                t.start_time_jalali,
                t.end_time_jalali,
                t.start_datetime,
                t.end_datetime,
                t.start_date,
                t.end_date,
                t.duration_minutes,
                t.total_vehicles,
                t.class1_vehicles,
                t.class2_vehicles,
                t.class3_vehicles,
                t.class4_vehicles,
                t.class5_vehicles,
                t.avg_speed,
                t.speed_violations,
                t.distance_violations,
                t.overtake_violations,
                t.source_extra,
                ST_AsGeoJSON(m.geometry)::json AS geometry
            FROM traffic.manual_match AS m
            JOIN {table} AS t
              ON t.route_code = m.route_code
             AND t.start_date >= %s
             AND t.start_date < %s
            WHERE m.route_code = ANY(%s)
            ORDER BY m.route_code, t.start_date, t.traffic_id
        """
        with connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, (date_from, date_to_exclusive, request.route_codes))
                rows = cursor.fetchall()
        
        if not rows:
            _update_traffic_job(job_id, status="failed", finished_at=datetime.utcnow().isoformat(),
                              error="هیچ داده‌ای یافت نشد")
            return

        _update_traffic_job(job_id, progress=50, message=f"تعداد {len(rows)} رکورد یافت شد. در حال تبدیل فرمت...")

        # Columns to exclude from clean export
        exclude_columns = {"source_id", "latitude", "longitude", "traffic_id", "traffic_route_name",
                          "start_datetime", "end_datetime", "start_date", "end_date", "geometry"}

        if request.format == "csv":
            fieldnames = [key for key in rows[0] if key not in exclude_columns]
            output = io.StringIO(newline="")
            writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                writer.writerow({key: json_value(value) for key, value in row.items() if key not in exclude_columns})
            csv_content = output.getvalue()
            content = "\ufeff" + csv_content
            ext = "csv"
        elif request.format == "geojson":
            features = []
            for row in rows:
                properties = {key: json_value(value) for key, value in row.items() if key not in exclude_columns}
                features.append({"type": "Feature", "geometry": row["geometry"], "properties": properties})
            payload = {"type": "FeatureCollection", "features": features}
            content = json.dumps(payload, ensure_ascii=False)
            ext = "geojson"
        elif request.format == "shp":
            # Create Shapefile using geopandas.read_postgis with SQLAlchemy engine
            # This avoids the GeoJSON intermediate step
            shp_sql = f"""
                SELECT
                    m.counter_id,
                    m.name AS counter_name,
                    m.route_code,
                    m.route_name,
                    t.province,
                    t.start_time_jalali,
                    t.end_time_jalali,
                    t.duration_minutes,
                    t.total_vehicles,
                    t.class1_vehicles,
                    t.class2_vehicles,
                    t.class3_vehicles,
                    t.class4_vehicles,
                    t.class5_vehicles,
                    t.avg_speed,
                    t.speed_violations,
                    t.distance_violations,
                    t.overtake_violations,
                    t.source_extra,
                    m.geometry
                FROM traffic.manual_match AS m
                JOIN {table} AS t
                  ON t.route_code = m.route_code
                 AND t.start_date >= %s
                 AND t.start_date < %s
                WHERE m.route_code = ANY(%s)
                ORDER BY m.route_code, t.start_date, t.traffic_id
            """
            # Use SQLAlchemy engine for read_postgis (requires SQLAlchemy 2.0+)
            engine = create_engine(database_url())
            gdf = gpd.read_postgis(shp_sql, engine, params=(date_from, date_to_exclusive, request.route_codes), geom_col='geometry')
            
            if gdf.empty:
                _update_traffic_job(job_id, status="failed", finished_at=datetime.utcnow().isoformat(),
                                  error="هیچ داده‌ای یافت نشد")
                return
            
            # Truncate column names to 10 chars for Shapefile compatibility, ensuring uniqueness
            seen = {}
            new_cols = []
            for col in gdf.columns:
                truncated = col[:10]
                if truncated in seen:
                    seen[truncated] += 1
                    truncated = f"{truncated[:8]}{seen[truncated]:02d}"
                else:
                    seen[truncated] = 0
                new_cols.append(truncated)
            gdf.columns = new_cols
            
            # Create a zip file with all shapefile components
            with tempfile.TemporaryDirectory() as tmpdir:
                shp_path = os.path.join(tmpdir, "traffic_counters.shp")
                gdf.to_file(shp_path, driver="ESRI Shapefile", encoding="utf-8")
                
                # Zip all shapefile components
                zip_buffer = io.BytesIO()
                with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for root, dirs, files in os.walk(tmpdir):
                        for file in files:
                            file_path = os.path.join(root, file)
                            arcname = os.path.relpath(file_path, tmpdir)
                            zipf.write(file_path, arcname)
                content = zip_buffer.getvalue()
            
            media_type = "application/zip"
            ext = "zip"
        else:
            _update_traffic_job(job_id, status="failed", finished_at=datetime.utcnow().isoformat(),
                              error=f"فرمت نامعتبر: {request.format}")
            return

        # For Shapefile, content is already a zip (bytes), don't zip again
        if request.format == "shp":
            ext = "zip"
            content = content  # already a zip
        else:
            # Always zip the output for csv and geojson formats
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
                zipf.writestr(f"traffic_counters_{job_id}.{ext}", content)
            content = zip_buffer.getvalue()
            ext = "zip"
        
        out_filename = f"traffic_counters_{job_id}.{ext}"
        out_path = os.path.join(tempfile.gettempdir(), out_filename)
        
        if isinstance(content, bytes):
            with open(out_path, "wb") as f:
                f.write(content)
        else:
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(content)
        
        _update_traffic_job(job_id, progress=100, status="success",
                           finished_at=datetime.utcnow().isoformat(),
                           download_url=f"/traffic-counters/download/{out_filename}",
                           message="فایل خروجی آماده است")
    except Exception as e:
        print(f"Traffic job {job_id} failed:\n{traceback.format_exc()}")
        _update_traffic_job(job_id, status="failed", finished_at=datetime.utcnow().isoformat(),
                           error=f"خطا در پردازش: {str(e)}")


def _traffic_job_worker() -> None:
    while True:
        try:
            job_id, request = TRAFFIC_JOB_QUEUE.get()
            _run_traffic_export_job(job_id, request)
        except Exception as e:
            print(f"Traffic job worker error: {e}")
        finally:
            TRAFFIC_JOB_QUEUE.task_done()


# Start the worker thread
_traffic_worker_thread = threading.Thread(target=_traffic_job_worker, daemon=True, name="traffic-export-worker")
_traffic_worker_thread.start()


def database_url() -> str:
    return os.getenv("TRAFFIC_DATABASE_URL") or os.getenv("DATABASE_URL", "")


def connect():
    if psycopg is None:
        raise HTTPException(status_code=503, detail="psycopg is not installed")
    url = database_url()
    if not url:
        raise HTTPException(status_code=503, detail="Traffic database is not configured")
    try:
        return psycopg.connect(url, row_factory=dict_row)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Traffic database unavailable: {exc}") from exc


def json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def traffic_table(resolution: str) -> str:
    return "traffic.iran_hourly_traffic" if resolution == "hourly" else "traffic.iran_daily_traffic"


def region_geometry(request: TrafficSearchRequest) -> str:
    geometry = request.geometry
    if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise HTTPException(status_code=400, detail="Region geometry must be a Polygon or MultiPolygon")
    try:
        return json.dumps(geometry, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid region geometry") from exc


def date_bounds(request: TrafficSearchRequest) -> tuple[date, date]:
    start = request.date_from or date.min
    end = request.date_to or date(9999, 12, 30)
    if start > end:
        raise HTTPException(status_code=400, detail="date_from must not be after date_to")
    return start, end


@router.post("/search")
def search(request: TrafficSearchRequest):
    geometry = region_geometry(request)
    sql = """
        WITH region AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) AS geometry
        )
        SELECT
            m.counter_id,
            m.source_id,
            m.name,
            m.route_code,
            m.route_name,
            m.latitude,
            m.longitude
        FROM traffic.manual_match AS m
        CROSS JOIN region AS r
        WHERE ST_Intersects(m.geometry, r.geometry)
        ORDER BY m.route_code
    """
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, (geometry,))
            rows = cursor.fetchall()
    return {
        "success": True,
        "data": [{key: json_value(value) for key, value in row.items()} for row in rows],
        "total": len(rows),
        "message": f"{len(rows)} traffic counters found",
    }


class TrafficCsvRequest(BaseModel):
    route_codes: list[int] = Field(min_length=1, max_length=100)
    date_from: date | None = None
    date_to: date | None = None
    resolution: str = "daily"

    @field_validator('resolution')
    @classmethod
    def validate_resolution(cls, v: str) -> str:
        if v not in {"daily", "hourly"}:
            raise ValueError('resolution must be daily or hourly')
        return v


@router.post("/csv")
def download_csv(request: TrafficCsvRequest):
    date_from, date_to = date_bounds(request)
    date_to_exclusive = date_to + timedelta(days=1)
    table = traffic_table(request.resolution)
    sql = f"""
        SELECT
            m.counter_id,
            m.name AS counter_name,
            m.route_code,
            m.route_name,
            t.province,
            t.start_time_jalali,
            t.end_time_jalali,
            t.duration_minutes,
            t.total_vehicles,
            t.class1_vehicles,
            t.class2_vehicles,
            t.class3_vehicles,
            t.class4_vehicles,
            t.class5_vehicles,
            t.avg_speed,
            t.speed_violations,
            t.distance_violations,
            t.overtake_violations,
            t.source_extra
        FROM traffic.manual_match AS m
        JOIN {table} AS t
          ON t.route_code = m.route_code
         AND t.start_date >= %s
         AND t.start_date < %s
        WHERE m.route_code = ANY(%s)
        ORDER BY m.route_code, t.start_date, t.traffic_id
    """
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, (date_from, date_to_exclusive, request.route_codes))
            rows = cursor.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="هیچ داده‌ای یافت نشد")

    fieldnames = list(rows[0].keys())
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: json_value(value) for key, value in row.items()})

    csv_content = "\ufeff" + output.getvalue()
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=traffic_counters.csv"},
    )


@router.post("/export")
def export(request: TrafficExportRequest, background_tasks: BackgroundTasks):
    if request.format not in {"geojson", "csv", "shp"}:
        raise HTTPException(status_code=400, detail="Supported formats are geojson, csv, shp")
    
    job_id = uuid.uuid4().hex[:12]
    TRAFFIC_JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "message": "در صف پردازش",
        "dataset": "TRAFFIC_COUNTER",
        "format": request.format,
        "created_at": datetime.utcnow().isoformat(),
    }
    
    TRAFFIC_JOB_QUEUE.put((job_id, request))
    
    return {
        "success": True,
        "job_id": job_id,
        "status": "queued",
        "message": "درخواست در صف پردازش قرار گرفت",
        "job_url": f"/traffic-counters/jobs/{job_id}",
    }


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = TRAFFIC_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/download/{filename}")
def download_file(filename: str):
    import tempfile
    file_path = os.path.join(tempfile.gettempdir(), filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=filename,
    )