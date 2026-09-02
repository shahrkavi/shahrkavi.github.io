"""
Shahrkavi - Dataset Documentation Router

Serves Persian (Farsi) documentation pages for each dataset
at /docs/{dataset_id}/. Markdown files are rendered server-side
with Bootstrap 5.3 RTL styling.
"""

from pathlib import Path

import markdown
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from jinja2 import Template

router = APIRouter()

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"
TEMPLATE_PATH = Path(__file__).resolve().parent / "templates" / "docs.html"

# Map URL slugs to markdown filenames and display metadata
DATASET_PAGES = {
    "landsat9": {"file": "landsat9.md", "title": "Landsat 9 OLI-2/TIRS-2", "badges": ["۲۰۲۱-اکنون", "۳۰ متر", "ماهواره‌ای"]},
    "landsat8": {"file": "landsat8.md", "title": "Landsat 8 OLI/TIRS", "badges": ["۲۰۱۳-اکنون", "۳۰ متر", "ماهواره‌ای"]},
    "landsat7": {"file": "landsat7.md", "title": "Landsat 7 ETM+", "badges": ["۱۹۹۹-اکنون", "۳۰ متر", "ماهواره‌ای"]},
    "landsat5": {"file": "landsat5.md", "title": "Landsat 5 TM", "badges": ["۱۹۸۴-۲۰۱۳", "۳۰ متر", "ماهواره‌ای"]},
    "landsat4": {"file": "landsat4.md", "title": "Landsat 4 TM", "badges": ["۱۹۸۲-۱۹۹۳", "۳۰ متر", "ماهواره‌ای"]},
    "sentinel2": {"file": "sentinel2.md", "title": "Sentinel-2 MSI L2A", "badges": ["۲۰۱۵-اکنون", "۱۰ متر", "ماهواره‌ای"]},
    "sentinel1": {"file": "sentinel1.md", "title": "Sentinel-1 SAR GRD", "badges": ["۲۰۱۴-اکنون", "۱۰ متر", "SAR"]},
    "modis-terra": {"file": "modis_terra.md", "title": "MODIS Terra Surface Reflectance", "badges": ["۲۰۰۰-اکنون", "۵۰۰ متر", "ماهواره‌ای"]},
    "modis-aqua": {"file": "modis_aqua.md", "title": "MODIS Aqua Surface Reflectance", "badges": ["۲۰۰۲-اکنون", "۵۰۰ متر", "ماهواره‌ای"]},
    "modis-lst": {"file": "modis_lst.md", "title": "MODIS Land Surface Temperature", "badges": ["۲۰۰۰-اکنون", "۱ کیلومتر", "روزانه"]},
    "modis-vegetation": {"file": "modis_vegetation.md", "title": "MODIS Vegetation Indices", "badges": ["۲۰۰۰-اکنون", "۲۵۰ متر", "۱۶ روزه"]},
    "modis-snow": {"file": "modis_snow.md", "title": "MODIS Snow Cover", "badges": ["۲۰۰۰-اکنون", "۵۰۰ متر", "روزانه"]},
    "modis-lai": {"file": "modis_lai.md", "title": "MODIS Leaf Area Index / FPAR", "badges": ["۲۰۰۲-اکنون", "۵۰۰ متر", "۸ روزه"]},
    "dem": {"file": "dem.md", "title": "Copernicus DEM GLO-30", "badges": ["مدل ارتفاعی", "۳۰ متر", "کل جهان"]},
    "google-earth-historical": {"file": "google_earth_historical.md", "title": "تصاویر تاریخی Google Earth", "badges": ["۱۹۳۰-اکنون", "تصویر تاریخی"]},
    "esri-wayback": {"file": "esri_wayback.md", "title": "Esri World Atlas Wayback", "badges": ["۱۹۳۰-اکنون", "تصویر تاریخی"]},
    "ghs-pop": {"file": "ghs_pop.md", "title": "GHS - جمعیت (Population)", "badges": ["۱۰۰ متر", "۱۹۷۵-۲۰۳۰", "لایه سکونت"]},
    "ghs-built": {"file": "ghs_built.md", "title": "GHS - سطح ساخته‌شده (Built Surface)", "badges": ["۱۰۰ متر", "۱۹۷۵-۲۰۳۰", "لایه سکونت"]},
    "ghs-built-v": {"file": "ghs_built_v.md", "title": "GHS - حجم ساخته‌شده (Built Volume)", "badges": ["۱۰۰ متر", "۱۹۷۵-۲۰۳۰", "لایه سکونت"]},
    "osm": {"file": "osm.md", "title": "OpenStreetMap", "badges": ["داده برداری", "رایگان"]},
    "overture": {"file": "overture.md", "title": "Overture Maps - ساختمان‌ها", "badges": ["فوتپرینت ساختمان", "کل جهان"]},
    "weather": {"file": "weather.md", "title": "ایستگاه‌های هواشناسی", "badges": ["سری زمانی", "روزانه"]},
    "earthquakes": {"file": "earthquakes.md", "title": "زمین‌لرزه‌های USGS", "badges": ["سری زمانی", "کاتالوگ زلزله"]},
}

# Sidebar navigation groups
SIDEBAR_NAV = [
    {
        "title": "تصاویر ماهواره‌ای",
        "icon": "bi-grid-3x3",
        "links": [
            {"slug": "landsat9", "label": "Landsat 9"},
            {"slug": "landsat8", "label": "Landsat 8"},
            {"slug": "landsat7", "label": "Landsat 7"},
            {"slug": "landsat5", "label": "Landsat 5"},
            {"slug": "landsat4", "label": "Landsat 4"},
            {"slug": "sentinel2", "label": "Sentinel-2"},
            {"slug": "sentinel1", "label": "Sentinel-1"},
            {"slug": "modis-terra", "label": "MODIS Terra"},
            {"slug": "modis-aqua", "label": "MODIS Aqua"},
            {"slug": "modis-lst", "label": "MODIS LST"},
            {"slug": "modis-vegetation", "label": "MODIS Vegetation"},
            {"slug": "modis-snow", "label": "MODIS Snow"},
            {"slug": "modis-lai", "label": "MODIS LAI"},
        ],
    },
    {
        "title": "مدل ارتفاعی",
        "icon": "bi-layers",
        "links": [
            {"slug": "dem", "label": "Copernicus DEM"},
        ],
    },
    {
        "title": "تصاویر تاریخی",
        "icon": "bi-clock-history",
        "links": [
            {"slug": "google-earth-historical", "label": "Google Earth"},
            {"slug": "esri-wayback", "label": "Esri Wayback"},
        ],
    },
    {
        "title": "لایه‌های سکونت",
        "icon": "bi-buildings",
        "links": [
            {"slug": "ghs-pop", "label": "GHS - جمعیت"},
            {"slug": "ghs-built", "label": "GHS - سطح ساخته‌شده"},
            {"slug": "ghs-built-v", "label": "GHS - حجم ساخته‌شده"},
        ],
    },
    {
        "title": "داده‌های برداری",
        "icon": "bi-bezier2",
        "links": [
            {"slug": "osm", "label": "OpenStreetMap"},
            {"slug": "overture", "label": "Overture Maps"},
        ],
    },
    {
        "title": "سری زمانی",
        "icon": "bi-graph-up-arrow",
        "links": [
            {"slug": "weather", "label": "هواشناسی"},
            {"slug": "earthquakes", "label": "زمین‌لرزه‌ها"},
        ],
    },
]


def _read_template() -> Template:
    with open(TEMPLATE_PATH, encoding="utf-8") as f:
        return Template(f.read())


def _read_markdown(filename: str) -> str:
    filepath = DOCS_DIR / filename
    if not filepath.exists():
        return ""
    with open(filepath, encoding="utf-8") as f:
        return f.read()


def _render_markdown(md_text: str) -> str:
    extensions = [
        "markdown.extensions.tables",
        "markdown.extensions.fenced_code",
        "markdown.extensions.codehilite",
        "markdown.extensions.toc",
        "markdown.extensions.nl2br",
    ]
    return markdown.markdown(md_text, extensions=extensions)


@router.get("/", response_class=HTMLResponse)
async def docs_index():
    """List all available documentation pages."""
    template = _read_template()

    index_md = "# مستندات دیتاست‌های شهرکاوی\n\n"
    index_md += "برای مشاهده مستندات هر دیتاست، روی لینک زیر کلیک کنید:\n\n"
    index_md += "| دیتاست | لینک |\n"
    index_md += "|--------|------|\n"
    for slug, meta in DATASET_PAGES.items():
        index_md += f"| {meta['title']} | [مشاهده مستندات](/{slug}/) |\n"

    content = _render_markdown(index_md)
    html = template.render(
        title="مستندات دیتاست‌ها",
        content=content,
        badges=["فهرست مستندات"],
        sidebar_nav=SIDEBAR_NAV,
        current_slug=None,
    )
    return HTMLResponse(content=html)


@router.get("/{dataset_id}/", response_class=HTMLResponse)
async def docs_page(dataset_id: str):
    """Render a single dataset documentation page."""
    if dataset_id not in DATASET_PAGES:
        raise HTTPException(status_code=404, detail=f"مستندات دیتاست '{dataset_id}' یافت نشد")

    meta = DATASET_PAGES[dataset_id]
    md_text = _read_markdown(meta["file"])
    if not md_text:
        raise HTTPException(status_code=404, detail=f"فایل مستندات '{meta['file']}' یافت نشد")

    content = _render_markdown(md_text)
    template = _read_template()
    html = template.render(
        title=meta["title"],
        content=content,
        badges=meta["badges"],
        sidebar_nav=SIDEBAR_NAV,
        current_slug=dataset_id,
    )
    return HTMLResponse(content=html)
