# Landsat 9 OLI-2/TIRS-2

## معرفی

Landsat 9 ماهواره‌ای است که در سپتامبر ۲۰۲۱ پرتاب شد و جدیدترین ماهواره در مجموعه Landsat است. این ماهواره تصاویر با کیفیت بالا از سطح زمین با وضوح مکانی ۳۰ متر ارائه می‌دهد.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Landsat 9 OLI-2/TIRS-2 |
| **سال شروع** | ۲۰۲۱ |
| **وضوح مکانی** | ۳۰ متر |
| **عرض پوشش** | ۱۸۵ کیلومتر |
| **چرخه تکرار** | ۱۶ روز |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان (بدون نیاز به احراز هویت) |

## باندها

| باند | نام | طول موج (μm) | کاربرد |
|------|-----|--------------|--------|
| coastal | ساحلی | 0.43-0.45 | مطالعات آبی کم‌عمق |
| blue | آبی | 0.45-0.51 | تجزیه و تحلیل آب |
| green | سبز | 0.53-0.59 | پوشش گیاهی |
| red | قرمز | 0.64-0.67 | تشخیص پوشش گیاهی |
| nir08 | مادون قرمز نزدیک | 0.85-0.88 | NDVI، پوشش گیاهی |
| swir16 | مادون قرمز کوتاه 1 | 1.57-1.65 | رطوبت خاک |
| swir22 | مادون قرمز کوتاه 2 | 2.11-2.29 | ترکیبات زمین |
| lwir11 | حرارتی | 10.6-11.19 | دمای سطح |

## نصب پیش‌نیازها

```bash
pip install pystac-client planetary-computer
```

## دسترسی مستقیم با پایتون

### جستجوی تصاویر

```python
from pystac_client import Client
import planetary_computer

# اتصال به Planetary Computer STAC
catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# تعریف محدوده جغرافیایی (مثلاً تهران)
bbox = [51.0, 35.5, 51.8, 36.0]  # [west, south, east, north]

# جستجوی تصاویر Landsat 9
search = catalog.search(
    collections=["landsat-c2-l2"],
    bbox=bbox,
    datetime="2023-01-01/2023-12-31",
    query={"platform": {"eq": "landsat-9"}},
    max_items=10,
)

# نتایج
for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"ابرپوشانی: {item.properties.get('eo:cloud_cover', 'نامشخص')}%")
    print(f"شناسه: {item.id}")
    print("---")
```

### دانلود یک تصویر

```python
import rasterio
import planetary_computer

# دریافت یک آیتم خاص
items = list(search.items())
if items:
    item = items[0]

    # دسترسی به باند قرمز
    red_band = item.assets["red"]

    # امضای لینک دانلود
    signed_url = planetary_computer.sign(red_band.href)

    # خواندن تصویر
    with rasterio.open(signed_url) as src:
        print(f"ابعاد: {src.width} x {src.height}")
        print(f" CRS: {src.crs}")
        data = src.read()  # خواندن کل باند
```

### خواندن چند باند همزمان

```python
import rasterio
from rasterio.merge import merge
import planetary_computer

item = list(search.items())[0]

# باندهای مورد نیاز
bands = ["red", "green", "blue", "nir08"]
band_arrays = []

for band_name in bands:
    href = planetary_computer.sign(item.assets[band_name].href)
    with rasterio.open(href) as src:
        band_arrays.append(src.read(1))

# ترکیب باندها به صورت RGBA
import numpy as np
rgb = np.stack(band_arrays[:3])  # RGB
print(f"شکل آرایه: {rgb.shape}")
```

## پارامترهای جستجو

| پارامتر | توضیح |
|---------|-------|
| `bbox` | محدوده جغرافیایی [west, south, east, north] |
| `datetime` | بازه زمانی "YYYY-MM-DD/YYYY-MM-DD" |
| `query` | فیلتر پلتفرم: `{"platform": {"eq": "landsat-9"}}` |
| `max_items` | حداکثر تعداد نتایج |

## لینک‌های مفید

- [Planetary Computer STAC Browser](https://planetarycomputer.microsoft.com/)
- [بازنمایی Landsat 9](https://planetarycomputer.microsoft.com/collection/datasets/landsat-c2-l2)
- [مستندات Landsat](https://www.usgs.gov/centers/eros/science/usgs-landsat-mission)
