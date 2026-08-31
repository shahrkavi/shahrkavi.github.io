# زمین‌لرزه‌های USGS

## معرفی

کاتالوگ زمین‌لرزه‌های USGS شامل اطلاعات تمام زمین‌لرزه‌های ثبت‌شده توسط سازمان زمین‌شناسی آمریکا است. این داده‌ها برای مطالعات لرزه‌شناسی و خطر طبیعی بسیار مفید هستند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | USGS Earthquake Catalog |
| **پوشش** | جهانی |
| **فرمت** | GeoJSON، Shapefile، CSV |
| **سال شروع** | ۱۹۰۰ |
| **هزینه** | رایگان |

## نصب پیش‌نیازها

```bash
pip install requests pandas geopandas
```

## دسترسی مستقیم با پایتون

### جستجوی زمین‌لرزه‌ها

```python
import requests

# جستجوی زمین‌لرزه‌ها در یک محدوده
url = "https://earthquake.usgs.gov/fdsnws/event/1/query"

params = {
    "format": "geojson",
    "starttime": "2023-01-01",
    "endtime": "2023-12-31",
    "minlatitude": 35.5,
    "maxlatitude": 36.0,
    "minlongitude": 51.0,
    "maxlongitude": 51.8,
    "minmagnitude": 3.0,
    "orderby": "time",
}

response = requests.get(url, params=params)
data = response.json()

print(f"تعداد زمین‌لرزه‌ها: {data['metadata']['count']}")
for eq in data["features"][:5]:
    props = eq["properties"]
    print(f"  - {props['mag']} ریشتر - {props['place']}")
```

### استخراج مختصات

```python
import requests
import pandas as pd

response = requests.get(url, params=params)
data = response.json()

# تبدیل به DataFrame
earthquakes = []
for eq in data["features"]:
    props = eq["properties"]
    coords = eq["geometry"]["coordinates"]
    earthquakes.append({
        "magnitude": props["mag"],
        "place": props["place"],
        "time": props["time"],
        "longitude": coords[0],
        "latitude": coords[1],
        "depth": coords[2],
    })

df = pd.DataFrame(earthquakes)
print(df.head())
```

### محاسبه آمار

```python
import pandas as pd

# محاسبه آمار
print(f"تعداد کل: {len(df)}")
print(f"میانگین بزرگی: {df['magnitude'].mean():.2f}")
print(f"حداکثر بزرگی: {df['magnitude'].max():.2f}")
print(f"عمق میانگین: {df['depth'].mean():.1f} km")
```

### تجسم روی نقشه

```python
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point

# تبدیل به GeoDataFrame
geometry = [Point(xy) for xy in zip(df["longitude"], df["latitude"])]
gdf = gpd.GeoDataFrame(df, geometry=geometry)

# رسم نقشه
import matplotlib.pyplot as plt

fig, ax = plt.subplots(1, 1, figsize=(12, 8))
gdf.plot(
    ax=ax,
    column="magnitude",
    markersize=df["magnitude"] * 20,
    alpha=0.6,
    legend=True,
    cmap="YlOrRd",
)
ax.set_title("زمین‌لرزه‌های تهران در سال ۲۰۲۳")
ax.set_xlabel("طول جغرافیایی")
ax.set_ylabel("عرض جغرافیایی")
plt.savefig("earthquakes_tehran.png")
plt.show()
```

### ذخیره به صورت GeoJSON

```python
import geopandas as gpd
from shapely.geometry import Point

geometry = [Point(xy) for xy in zip(df["longitude"], df["latitude"])]
gdf = gpd.GeoDataFrame(df, geometry=geometry)

gdf.to_file("earthquakes.geojson", driver="GeoJSON")
print("فایل ذخیره شد: earthquakes.geojson")
```

## پارامترهای جستجو

| پارامتر | توضیح |
|---------|-------|
| starttime | تاریخ شروع (YYYY-MM-DD) |
| endtime | تاریخ پایان (YYYY-MM-DD) |
| minlatitude | حداقل عرض جغرافیایی |
| maxlatitude | حداکثر عرض جغرافیایی |
| minlongitude | حداقل طول جغرافیایی |
| maxlongitude | حداکثر طول جغرافیایی |
| minmagnitude | حداقل بزرگی |
| maxmagnitude | حداکثر بزرگی |
| mindepth | حداقل عمق |
| maxdepth | حداکثر عمق |

## لینک‌های مفید

- [USGS Earthquake Hazards](https://earthquake.usgs.gov/)
- [FDSN Event Web Service](https://earthquake.usgs.gov/fdsnws/event/1/)
