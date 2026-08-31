# MODIS Aqua Surface Reflectance

## معرفی

MODIS روی ماهواره Aqua نصب شده و از سال ۲۰۰۲ تصاویر سطح زمین را ثبت می‌کند. Aqua در زمان متفاوتی نسبت به Terra از بالای سر می‌گذرد.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | MODIS Aqua Surface Reflectance (MYD09A1) |
| **سال شروع** | ۲۰۰۲ |
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

### جستجوی تصاویر MODIS Aqua

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# جستجوی MODIS Aqua
search = catalog.search(
    collections=["modis-09A1-061"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-06-01/2023-06-30",
    query={"id": {"starts_with": "MYD09A1"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### مقایسه Terra و Aqua

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# جستجوی همزمان Terra و Aqua
terra_search = catalog.search(
    collections=["modis-09A1-061"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-06-01/2023-06-10",
    query={"id": {"starts_with": "MOD09A1"}},
    max_items=5,
)

aqua_search = catalog.search(
    collections=["modis-09A1-061"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-06-01/2023-06-10",
    query={"id": {"starts_with": "MYD09A1"}},
    max_items=5,
)

print("Terra:")
for item in terra_search.items():
    print(f"  {item.properties['datetime']}")

print("Aqua:")
for item in aqua_search.items():
    print(f"  {item.properties['datetime']}")
```

## تفاوت Terra و Aqua

| ویژگی | Terra | Aqua |
|-------|-------|------|
| **سال شروع** | ۲۰۰۰ | ۲۰۰۲ |
| **زمان گذر** | ۱۰:۳۰ صبح | ۱:۳۰ بعدازظهر |
| **شناسه** | MOD09A1 | MYD09A1 |

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات Aqua](https://aqua.nasa.gov/)
