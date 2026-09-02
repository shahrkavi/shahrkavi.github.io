# MODIS Leaf Area Index / FPAR 8-Day

## معرفی

شاخص سطح برگ (LAI) و کسر تابش فتوسنتزی (FPAR) MODIS هر ۸ روز با وضوح ۵۰۰ متر ارائه می‌شوند. این داده‌ها برای مطالعات پوشش گیاهی، مدل‌سازی اکوسیستم و کشاورزی استفاده می‌شوند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | MODIS Leaf Area Index/FPAR 8-Day (MCD15A2H) |
| **سال شروع** | ۲۰۰۲ |
| **وضوح مکانی** | ۵۰۰ متر |
| **عرض پوشش** | ۲۳۳۰ کیلومتر |
| **چرخه تکرار** | ۸ روز |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باندها

| باند | نام | مقیاس | وضوح (m) |
|------|-----|-------|----------|
| Lai_500m | شاخص سطح برگ (LAI) | 0.1 | 500 |
| Fpar_500m | کسر تابش فتوسنتزی (FPAR) | 0.01 | 500 |
| LaiStdDev_500m | انحراف معیار LAI | 0.1 | 500 |
| FparStdDev_500m | انحراف معیار FPAR | 0.01 | 500 |
| FparLai_QC | کیفیت FPAR و LAI | - | 500 |

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

# جستجوی MODIS LAI
search = catalog.search(
    collections=["modis-15A2H-061"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-01-01/2023-12-31",
    query={"id": {"starts_with": "MCD15A2H"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### خواندن LAI

```python
import rasterio
import numpy as np
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # خواندن LAI
    lai_href = planetary_computer.sign(item.assets["Lai_500m"].href)
    with rasterio.open(lai_href) as src:
        lai = src.read(1).astype(float) * 0.1
        print(f"LAI میانگین: {np.mean(lai):.2f}")
        print(f"LAI حداکثر: {np.max(lai):.2f}")

    # خواندن FPAR
    fpar_href = planetary_computer.sign(item.assets["Fpar_500m"].href)
    with rasterio.open(fpar_href) as src:
        fpar = src.read(1).astype(float) * 0.01
        print(f"FPAR میانگین: {np.mean(fpar):.2f}")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات MCD15A2H](https://lpdaac.usgs.gov/products/mcd15a2hv061/)
