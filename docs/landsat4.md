# Landsat 4 TM

## معرفی

Landsat 4 در ژوئیه ۱۹۸۲ پرتاب شد و مجهز به سنسور TM (Thematic Mapper) بود. این ماهواره اولین ماهواره‌ای بود که سنسور TM را به فضا برد.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Landsat 4 TM |
| **سال شروع** | ۱۹۸۲ |
| **سال پایان** | ۱۹۹۳ |
| **وضوح مکانی** | ۳۰ متر |
| **عرض پوشش** | ۱۸۵ کیلومتر |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باندها

| باند | نام | طول موج (μm) | کاربرد |
|------|-----|--------------|--------|
| blue | آبی | 0.45-0.52 | تجزیه و تحلیل آب |
| green | سبز | 0.52-0.60 | پوشش گیاهی |
| red | قرمز | 0.63-0.69 | تشخیص پوشش گیاهی |
| nir08 | مادون قرمز نزدیک | 0.76-0.90 | NDVI |
| swir16 | مادون قرمز کوتاه 1 | 1.55-1.75 | رطوبت خاک |
| swir22 | مادون قرمز کوتاه 2 | 2.08-2.35 | ترکیبات زمین |

## نصب پیش‌نیازها

```bash
pip install pystac-client planetary-computer
```

## دسترسی مستقیم با پایتون

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# جستجوی تصاویر Landsat 4
search = catalog.search(
    collections=["landsat-c2-l2"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="1982-01-01/1993-12-31",
    query={"platform": {"eq": "landsat-4"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### مطالعه تغییرات تاریخی

```python
from pystac_client import Client
import planetary_computer
import rasterio
import numpy as np

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# جستجوی تصویر از دهه ۱۹۸۰
search = catalog.search(
    collections=["landsat-c2-l2"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="1985-01-01/1985-12-31",
    query={"platform": {"eq": "landsat-4"}},
    max_items=1,
)

items = list(search.items())
if items:
    item = items[0]
    # خواندن باند مادون قرمز
    nir_href = planetary_computer.sign(item.assets["nir08"].href)
    with rasterio.open(nir_href) as src:
        nir = src.read(1)
        print(f"ابعاد تصویر: {nir.shape}")
        print(f"مقدار NDVI میانگین: {np.mean(nir):.4f}")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات Landsat 4](https://www.usgs.gov/centers/eros/science/usgs-landsat-4-mission)
