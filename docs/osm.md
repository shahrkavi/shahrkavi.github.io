# OpenStreetMap

## معرفی

OpenStreetMap (OSM) یک نقشه آزاد و مشارکتی جهانی است که داده‌های برداری شامل جاده‌ها، ساختمان‌ها، مناطق و امکانات را ارائه می‌دهد.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | OpenStreetMap Features |
| **پوشش** | کل جهان |
| **فرمت** | GeoJSON، Shapefile، KML |
| **هزینه** | رایگان |

## نصب پیش‌نیازها

```bash
pip install osmnx geopandas
```

## دسترسی مستقیم با پایتون

### جستجوی ویژگی‌ها با osmnx

```python
import osmnx as ox

# دانلود ویژگی‌های یک منطقه (مثلاً تهران)
tags = {"amenity": True, "building": True, "highway": True}
gdf = ox.features_from_place("Tehran, Iran", tags=tags)

print(f"تعداد ویژگی‌ها: {len(gdf)}")
print(f"ستون‌ها: {gdf.columns.tolist()}")
print(gdf.head())
```

### جستجوی ساختمان‌ها

```python
import osmnx as ox

# دانلود ساختمان‌ها
buildings = ox.features_from_place(
    "Tehran, Iran",
    tags={"building": True}
)

print(f"تعداد ساختمان‌ها: {len(buildings)}")
```

### جستجوی جاده‌ها

```python
import osmnx as ox

# دانلود شبکه جاده‌ای
G = ox.graph_from_place("Tehran, Iran", network_type="drive")

# محاسبه آمار
stats = ox.basic_stats(G)
print(f"تعداد گره‌ها: {stats['n']}")
print(f"تعداد یال‌ها: {stats['m']}")
print(f"طول کل جاده‌ها: {stats['edge_length_total']/1000:.1f} km")
```

### استفاده از Overpass API

```python
import requests
import json

# استفاده مستقیم از Overpass API
overpass_url = "https://overpass-api.de/api/interpreter"

query = """
[out:json];
area["name"="تهران"]->.searchArea;
(
  node["amenity"="restaurant"](area.searchArea);
  way["amenity"="restaurant"](area.searchArea);
);
out body;
"""

response = requests.post(overpass_url, data={"data": query})
data = response.json()

print(f"تعداد رستوران‌ها: {len(data['elements'])}")
for element in data["elements"][:5]:
    name = element.get("tags", {}).get("name", "بدون نام")
    print(f"  - {name}")
```

### ذخیره به صورت GeoJSON

```python
import osmnx as ox

buildings = ox.features_from_place("Tehran, Iran", tags={"building": True})

# ذخیره در فایل GeoJSON
buildings.to_file("tehran_buildings.geojson", driver="GeoJSON")
print("فایل ذخیره شد: tehran_buildings.geojson")
```

## لینک‌های مفید

- [OpenStreetMap](https://www.openstreetmap.org/)
- [OSMnx Documentation](https://osmnx.readthedocs.io/)
- [Overpass API](https://overpass-api.de/)
