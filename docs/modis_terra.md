# MODIS Terra Surface Reflectance

## معرفی

MODIS (Moderate Resolution Imaging Spectroradiometer) روی ماهواره Terra نصب شده و از سال ۲۰۰۰ تصاویر سطح زمین را ثبت می‌کند. این داده‌ها برای مطالعات تغییرات جهانی بسیار مفید هستند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | MODIS Terra Surface Reflectance (MOD09A1) |
| **سال شروع** | ۲۰۰۰ |
| **وضوح مکانی** | ۵۰۰ متر |
| **عرض پوشش** | ۲۳۳۰ کیلومتر |
| **چرخه تکرار** | ۸ روز |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باندها

| باند | نام | طول موج (nm) | وضوح (m) |
|------|-----|--------------|----------|
| red | قرمز | 620-670 | 500 |
| green | سبز | 841-876 | 500 |
| blue | آبی | 459-479 | 500 |
| nir | مادون قرمز نزدیک | 841-876 | 500 |
| swir16 | مادون قرمز کوتاه 1 | 1230-1250 | 500 |
| swir22 | مادون قرمز کوتاه 2 | 1628-1652 | 500 |

## نصب پیش‌نیازها

```bash
pip install pystac-client planetary-computer
```

## دسترسی مستقیم با پایتون

### جستجوی تصاویر MODIS

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# جستجوی MODIS Terra
search = catalog.search(
    collections=["modis-09A1-061"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-01-01/2023-12-31",
    query={"id": {"starts_with": "MOD09A1"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### خواندن تصویر

```python
import rasterio
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # خواندن باند قرمز
    red_href = planetary_computer.sign(item.assets["red"].href)
    with rasterio.open(red_href) as src:
        print(f"ابعاد: {src.width} x {src.height}")
        print(f"وضوح: {src.res[0]} متر")
        data = src.read(1)
```

### محاسبه NDVI

```python
import rasterio
import numpy as np
import planetary_computer

item = list(search.items())[0]

red_href = planetary_computer.sign(item.assets["red"].href)
nir_href = planetary_computer.sign(item.assets["nir"].href)

with rasterio.open(red_href) as src:
    red = src.read(1).astype(float)
with rasterio.open(nir_href) as src:
    nir = src.read(1).astype(float)

# محاسبه NDVI
ndvi = (nir - red) / (nir + red + 1e-10)
print(f"NDVI میانگین: {np.mean(ndvi):.3f}")
print(f"NDVI حداکثر: {np.max(ndvi):.3f}")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات MODIS](https://modis.gsfc.nasa.gov/)
