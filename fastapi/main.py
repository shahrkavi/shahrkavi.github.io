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

app = FastAPI(title="Shahrkavi API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(landsat_router, prefix="/landsat", tags=["landsat"])
app.include_router(osm_router, prefix="/osm", tags=["osm"])
app.include_router(weather_router, prefix="/weather", tags=["weather"])

# Serve static files from project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(PROJECT_ROOT, "static")
ASSETS_DIR = os.path.join(PROJECT_ROOT, "assets")

# Create static/assets dirs if they don't exist
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)

# Mount static files
app.mount("/js", StaticFiles(directory=os.path.join(PROJECT_ROOT, "js")), name="js")
app.mount("/css", StaticFiles(directory=os.path.join(PROJECT_ROOT, "css")), name="css")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/")
async def root():
    return FileResponse(os.path.join(PROJECT_ROOT, "index.html"))

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
