import os
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import osmnx as ox
import pandas as pd
from typing import Dict, List, Any

from landsat import router as landsat_router
from osm import router as osm_router
from weather import router as weather_router
from overture import router as overture_router
from earthquake import router as earthquake_router
from ghs import router as ghs_router
from geh import router as geh_router
from docs_router import router as docs_router

app = FastAPI(title="Shahrkavi API")

# CORS for frontend (including file:// pages which send Origin: null).
# CORSMiddleware answers OPTIONS preflights itself; a custom middleware that
# only decorates responses would let them hit the routers and return 405.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(landsat_router, prefix="/landsat", tags=["landsat"])
app.include_router(osm_router, prefix="/osm", tags=["osm"])
app.include_router(weather_router, prefix="/weather", tags=["weather"])
app.include_router(overture_router, prefix="/overture", tags=["overture"])
app.include_router(earthquake_router, prefix="/earthquakes", tags=["earthquakes"])
app.include_router(ghs_router, prefix="/ghs", tags=["ghs"])
app.include_router(geh_router, prefix="/geh", tags=["geh"])
app.include_router(docs_router, prefix="/docs", tags=["docs"])

# Serve static files from project root
_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_PROJECT_DIR)  # parent of fastapi/

STATIC_DIR = os.path.join(_PROJECT_ROOT, "static")
ASSETS_DIR = os.path.join(_PROJECT_ROOT, "assets")
JS_DIR = os.path.join(_PROJECT_ROOT, "js")
CSS_DIR = os.path.join(_PROJECT_ROOT, "css")
INDEX_FILE = os.path.join(_PROJECT_ROOT, "index.html")
PROCESSING_FILE = os.path.join(_PROJECT_ROOT, "processing.html")

# Create static/assets dirs if they don't exist
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)

# Mount static files (with fallback if directory doesn't exist)
if os.path.isdir(JS_DIR):
    app.mount("/js", StaticFiles(directory=JS_DIR), name="js")
if os.path.isdir(CSS_DIR):
    app.mount("/css", StaticFiles(directory=CSS_DIR), name="css")
if os.path.isdir(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# === Downloads retention ===
# Files the server produces for the user to download (processed results,
# previews, single-scene images, Overture exports) are stored under
# fastapi/downloads/. Keep them for a limited time (default 4 hours) so the
# server disk doesn't fill up, then delete them automatically.
# Override with DOWNLOAD_TTL_SECONDS in the environment, for example 3600 for
# one hour. The cleanup worker removes every generated file after this period.
DOWNLOAD_TTL_SECONDS = int(os.getenv("DOWNLOAD_TTL_SECONDS", str(4 * 3600)))
DOWNLOADS_DIR = Path(_PROJECT_DIR) / "downloads"
DOWNLOAD_CLEANUP_INTERVAL = int(os.getenv("DOWNLOAD_CLEANUP_INTERVAL", "300"))


def _cleanup_downloads() -> None:
    """Delete downloadable files older than the retention window."""
    if not DOWNLOADS_DIR.is_dir():
        return
    now = time.time()
    for item in DOWNLOADS_DIR.iterdir():
        if not item.is_file():
            continue
        try:
            if now - item.stat().st_mtime > DOWNLOAD_TTL_SECONDS:
                item.unlink()
        except OSError:
            # File may be locked/in use or already gone — never break the loop
            pass


def _downloads_cleanup_worker() -> None:
    """Background worker that periodically expires old download files."""
    while True:
        try:
            _cleanup_downloads()
        except Exception as e:
            print(f"Downloads cleanup error: {e}")
        time.sleep(DOWNLOAD_CLEANUP_INTERVAL)


# Start the retention worker on app startup.
threading.Thread(target=_downloads_cleanup_worker, daemon=True, name="downloads-cleanup").start()


@app.get("/")
async def root():
    return FileResponse(INDEX_FILE)


@app.get("/processing.html")
async def processing_page():
    return FileResponse(PROCESSING_FILE)


@app.get("/healthz")
async def healthz():
    """Lightweight health check for systemd, Nginx, and monitoring."""
    return {"status": "ok"}

# تنظیم پیکربندی OSMnx برای کش کردن درخواستها جهت افزایش سرعت در درخواستهای تکراری
ox.settings.use_cache = True
ox.settings.log_console = False
ox.settings.overpass_url = "https://overpass.shahrkavi.ir/api/interpreter"

@app.get("/region-tags")
def get_region_tags(region_name: str) -> Dict[str, Any]:
    """
    دریافت نام یک منطقه (مثلاً "Tehran, Iran" یا "Manhattan, New York")
    و بازگرداندن تمام کلیدها و مقادیر OSM موجود در آن منطقه.
    """
    try:
        # ۱. دریافت هندسه (Geometry) منطقه مورد نظر
        gdf_boundary = ox.geocode_to_gdf(region_name)
        if gdf_boundary.empty:
            raise HTTPException(status_code=404, detail="Region not found")

        # ۲. دانلود تمام ویژگیها (features) درون مرز این منطقه
        tags = {"amenity": True, "building": True, "highway": True, "landuse": True, "natural": True, "leisure": True, "shop": True, "tourism": True}
        gdf_features = ox.features_from_place(region_name, tags=tags)

        if gdf_features.empty:
            return {"region": region_name, "message": "No features found with specified tags", "tags": {}}

        # ۳. استخراج تمام ستونها (تگهای OSM) به جز ستونهای سیستمی و هندسی
        exclude_cols = {'geometry', 'nodes', 'ways', 'element_type'}
        tag_columns = [col for col in gdf_features.columns if col not in exclude_cols]

        # ۴. گروهبندی کلیدها و مقادیر یکتا
        osm_tags_summary = {}
        for col in tag_columns:
            unique_values = gdf_features[col].dropna().unique().tolist()
            unique_values = [str(val) for val in unique_values if val != '']

            if unique_values:
                osm_tags_summary[col] = unique_values

        return {
            "region": region_name,
            "total_features": len(gdf_features),
            "osm_tags": osm_tags_summary
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
