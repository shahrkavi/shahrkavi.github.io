# Overture Maps - ساختمان‌ها

## معرفی

Overture Maps Foundation یک مجموعه داده جهانی از فوتپرینت ساختمان‌ها با اطلاعات ارتفاع ارائه می‌دهد. این داده‌ها برای برنامه‌ریزی شهری و مطالعات سکونت بسیار مفید هستند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Overture Maps Buildings |
| **پوشش** | کل جهان |
| **فرمت** | GeoJSON، Parquet |
| **هزینه** | رایگان |

## نصب پیش‌نیازها

```bash
pip install overturemaps pyarrow requests
```

## دسترسی مستقیم با پایتون

### جستجوی ساختمان‌ها

```python
import overturemaps

# جستجوی ساختمان‌ها در یک محدوده
bbox = (51.0, 35.5, 51.8, 36.0)  # (west, south, east, north)

# دریافت داده‌ها
buildings = overturemaps.download(
    bbox=bbox,
    theme="buildings",
)

print(f"تعداد ساختمان‌ها: {len(buildings)}")
print(buildings.head())
```

### استفاده از Overpass API (روش جایگزین)

```python
import requests
import json

# استفاده از Overpass API برای ساختمان‌ها
overpass_url = "https://overpass-api.de/api/interpreter"

query = """
[out:json];
(
  way["building"](51.0,35.5,51.8,36.0);
  relation["building"](51.0,35.5,51.8,36.0);
);
out body;
"""

response = requests.post(overpass_url, data={"data": query})
data = response.json()

print(f"تعداد ساختمان‌ها: {len(data['elements'])}")
```

### دریافت اطلاعات ارتفاع

```python
import overturemaps

bbox = (51.0, 35.5, 51.8, 36.0)

# دریافت ساختمان‌ها با اطلاعات ارتفاع
buildings = overturemaps.download(
    bbox=bbox,
    theme="buildings",
    extra_fields=["height", "num_floors"],
)

# نمایش اطلاعات
if "height" in buildings.columns:
    print(f"ارتفاع میانگین: {buildings['height'].mean():.1f} متر")
    print(f"حداکثر ارتفاع: {buildings['height'].max():.1f} متر")
```

### ذخیره به صورت GeoJSON

```python
import overturemaps
import geopandas as gpd

bbox = (51.0, 35.5, 51.8, 36.0)

buildings = overturemaps.download(
    bbox=bbox,
    theme="buildings",
)

# تبدیل به GeoDataFrame
gdf = gpd.GeoDataFrame(buildings)

# ذخیره در فایل
gdf.to_file("overture_buildings.geojson", driver="GeoJSON")
print("فایل ذخیره شد: overture_buildings.geojson")
```

## دسترسی از طریق API شهرکاوی

### جستجوی ساختمان‌ها

```python
import requests

response = requests.get("http://localhost:8000/overture/buildings", params={
    "north": 36.0,
    "south": 35.5,
    "east": 51.8,
    "west": 51.0,
    "limit": 5000,
})

data = response.json()
print(f"تعداد ساختمان‌ها: {data['count']}")
print(f"آیا محدود شده: {data.get('truncated', False)}")
```

### خروجی به فرمت‌های مختلف

```python
import requests

response = requests.get("http://localhost:8000/overture/buildings/export", params={
    "north": 36.0,
    "south": 35.5,
    "east": 51.8,
    "west": 51.0,
    "format": "geojson",  # shp, geojson, kml, gpkg, csv
    "limit": 10000,
})

with open("overture_export.geojson", "wb") as f:
    f.write(response.content)
print("فایل خروجی ذخیره شد")
```

## لینک‌های مفید

- [Overture Maps Foundation](https://overturemaps.org/)
- [GitHub overturemaps](https://github.com/OvertureMaps/overture-py)
