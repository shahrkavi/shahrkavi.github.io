# Landsat 5 TM

## معرفی

Landsat 5 در مارس ۱۹۸۴ پرتاب شد و تا سال ۲۰۱۳ فعال بود. این ماهواره طولانی‌ترین مأموریت موفق ماهواره‌ای در تاریخ بود و بیش از ۲۹ سال تصاویر ماهواره‌ای ثبت کرد.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Landsat 5 TM |
| **سال شروع** | ۱۹۸۴ |
| **سال پایان** | ۲۰۱۳ |
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

# جستجوی تصاویر Landsat 5
search = catalog.search(
    collections=["landsat-c2-l2"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="1990-01-01/1999-12-31",
    query={"platform": {"eq": "landsat-5"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### مطالعه تغییرات طولانی‌مدت

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# مقایسه تصاویر از دهه‌های مختلف
decades = [
    ("1990-01-01/1990-12-31", "دهه ۱۹۹۰"),
    ("2000-01-01/2000-12-31", "دهه ۲۰۰۰"),
    ("2010-01-01/2010-12-31", "دهه ۲۰۱۰"),
]

for dt, label in decades:
    search = catalog.search(
        collections=["landsat-c2-l2"],
        bbox=[51.0, 35.5, 51.8, 36.0],
        datetime=dt,
        query={"platform": {"eq": "landsat-5"}},
        max_items=1,
    )
    items = list(search.items())
    if items:
        print(f"{label}: {items[0].properties['datetime']}")
    else:
        print(f"{label}: تصویری یافت نشد")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات Landsat 5](https://www.usgs.gov/centers/eros/science/usgs-landsat-5-mission)
