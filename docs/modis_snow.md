# MODIS Snow Cover Daily

## معرفی

داده‌های پوشش برف MODIS به صورت روزانه با وضوح ۵۰۰ متر ارائه می‌شوند. این داده‌ها شامل شاخص تفکیک برف (NDSI) و albido برف هستند و برای مطالعات هیدرولوژیکی و اقلیمی استفاده می‌شوند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | MODIS Snow Cover Daily (MOD10A1) |
| **سال شروع** | ۲۰۰۰ |
| **وضوح مکانی** | ۵۰۰ متر |
| **عرض پوشش** | ۱۲۰۰×۱۲۰۰ کیلومتر |
| **چرخه تکرار** | روزانه |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باندها

| باند | نام | مقیاس | وضوح (m) |
|------|-----|-------|----------|
| NDSI_Snow_Cover | پوشش برف | - | 500 |
| Snow_Albedo_Daily_Tile | albido برف | - | 500 |
| NDSI | شاخص تفکیک برف | 0.0001 | 500 |
| NDSI_Snow_Cover_Basic_QA | کیفیت پایه | - | 500 |

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

# جستجوی MODIS Snow Cover
search = catalog.search(
    collections=["modis-10A1-061"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-01-01/2023-12-31",
    query={"id": {"starts_with": "MOD10A1"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### خواندن پوشش برف

```python
import rasterio
import numpy as np
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # خواندن NDSI Snow Cover
    snow_href = planetary_computer.sign(item.assets["NDSI_Snow_Cover"].href)
    with rasterio.open(snow_href) as src:
        snow = src.read(1)
        # مقادیر > 100 پوشش برف دارند
        snow_cover = np.sum(snow > 100) / snow.size * 100
        print(f"درصد پوشش برف: {snow_cover:.1f}%")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات MOD10A1](https://nsidc.org/data/mod10a1)
