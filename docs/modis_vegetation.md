# MODIS Vegetation Indices 16-Day

## معرفی

شاخص‌های پوشش گیاهی MODIS شامل NDVI و EVI هر ۱۶ روز با وضوح ۲۵۰ متر ارائه می‌شوند. این داده‌ها برای پایش پوشش گیاهی، خشکسالی و تغییرات اکوسیستم استفاده می‌شوند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | MODIS Vegetation Indices 16-Day (MOD13Q1) |
| **سال شروع** | ۲۰۰۰ |
| **وضوح مکانی** | ۲۵۰ متر |
| **عرض پوشش** | ۲۳۳۰ کیلومتر |
| **چرخه تکرار** | ۱۶ روز |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باندها

| باند | نام | مقیاس | وضوح (m) |
|------|-----|-------|----------|
| 250m_16_days_NDVI | شاخص پوشش گیاهی | 0.0001 | 250 |
| 250m_16_days_EVI | شاخص پوشش گیاهی بهبودیافته | 0.0001 | 250 |
| 250m_16_days_red_reflectance | بازتاب قرمز | 0.0001 | 250 |
| 250m_16_days_NIR_reflectance | بازتاب مادون قرمز | 0.0001 | 250 |
| 250m_16_days_blue_reflectance | بازتاب آبی | 0.0001 | 250 |
| 250m_16_days_MIR_reflectance | بازتاب مادون قرمز میانی | 0.0001 | 250 |
| 250m_16_days_VI_Quality | کیفیت شاخص پوشش گیاهی | - | 250 |

## نصب پیش‌نیازها

```bash
pip install pystac-client planetary-computer
```

## دسترسی مستقیم با پایتون

### جستجوی تصاویر

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# جستجوی MODIS Vegetation Indices
search = catalog.search(
    collections=["modis-13Q1-061"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-01-01/2023-12-31",
    query={"id": {"starts_with": "MOD13Q1"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### خواندن NDVI

```python
import rasterio
import numpy as np
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # خواندن NDVI
    ndvi_href = planetary_computer.sign(item.assets["250m_16_days_NDVI"].href)
    with rasterio.open(ndvi_href) as src:
        ndvi = src.read(1).astype(float) * 0.0001
        print(f"NDVI میانگین: {np.mean(ndvi):.3f}")
        print(f"NDVI حداکثر: {np.max(ndvi):.3f}")

    # خواندن EVI
    evi_href = planetary_computer.sign(item.assets["250m_16_days_EVI"].href)
    with rasterio.open(evi_href) as src:
        evi = src.read(1).astype(float) * 0.0001
        print(f"EVI میانگین: {np.mean(evi):.3f}")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات MOD13Q1](https://lpdaac.usgs.gov/products/mod13q1v061/)
