# Landsat 7 ETM+

## معرفی

Landsat 7 در آوریل ۱۹۹۹ پرتاب شد و مجهز به سنسور ETM+ (Enhanced Thematic Mapper Plus) است. این ماهواره برای مطالعات طولانی‌مدت تغییرات ارضی بسیار ارزشمند است.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Landsat 7 ETM+ |
| **سال شروع** | ۱۹۹۹ |
| **وضوح مکانی** | ۳۰ متر (ermal: ۶۰ متر) |
| **عرض پوشش** | ۱۸۵ کیلومتر |
| **چرخه تکرار** | ۱۶ روز |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

> **توجه:** از مه ۲۰۰۳، سنسور ETM+ دچار نقص فنی شده و خط SLC (Scan Line Corrector) از کار افتاده است. تصاویر پس از این تاریخ دارای شکاف‌هایی هستند.

## باندها

| باند | نام | طول موج (μm) | کاربرد |
|------|-----|--------------|--------|
| blue | آبی | 0.45-0.52 | تجزیه و تحلیل آب |
| green | سبز | 0.52-0.60 | پوشش گیاهی |
| red | قرمز | 0.63-0.69 | تشخیص پوشش گیاهی |
| nir08 | مادون قرمز نزدیک | 0.77-0.90 | NDVI |
| swir16 | مادون قرمز کوتاه 1 | 1.55-1.75 | رطوبت خاک |
| swir22 | مادون قرمز کوتاه 2 | 2.08-2.35 | ترکیبات زمین |
| lwir | حرارتی | 10.4-12.5 | دمای سطح |

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

# جستجوی تصاویر Landsat 7
search = catalog.search(
    collections=["landsat-c2-l2"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2000-01-01/2002-12-31",  # قبل از نقص فنی SLC
    query={"platform": {"eq": "landsat-7"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### ملاحظات مهم

1. **تصاویر قبل از ۲۰۰۳:** بدون مشکل شکاف
2. **تصاویر بعد از ۲۰۰۳:** دارای شکاف‌های نواری (SLC-off)
3. **پوشش تاریخی:** از ۱۹۹۹ تا اکنون

### دانلود تصویر سالم (قبل از ۲۰۰۳)

```python
from pystac_client import Client
import planetary_computer
import rasterio

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

search = catalog.search(
    collections=["landsat-c2-l2"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2001-01-01/2001-12-31",
    query={"platform": {"eq": "landsat-7"}},
    max_items=1,
)

items = list(search.items())
if items:
    item = items[0]
    href = planetary_computer.sign(item.assets["red"].href)
    with rasterio.open(href) as src:
        print(f"ابعاد: {src.width} x {src.height}")
        print(f"CRS: {src.crs}")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات نقص SLC Landsat 7](https://www.usgs.gov/centers/eros/science/usgs-landsat-7-etm-slc-off-data)
