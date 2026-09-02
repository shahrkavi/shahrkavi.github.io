# MODIS Land Surface Temperature/Emissivity Daily

## معرفی

محصول دمای سطح زمین و امیتنس MODIS به صورت روزانه با وضوح ۱ کیلومتر ارائه می‌شود. این داده‌ها از ماهواره‌های Terra و Aqua جمع‌آوری شده و برای مطالعات اقلیمی، کشاورزی و محیط زیست بسیار مفید هستند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | MODIS Land Surface Temperature/Emissivity Daily (MOD11A1) |
| **سال شروع** | ۲۰۰۰ |
| **وضوح مکانی** | ۱ کیلومتر |
| **عرض پوشش** | ۱۲۰۰×۱۲۰۰ کیلومتر |
| **چرخه تکرار** | روزانه |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باندها

| باند | نام | مقیاس | وضوح (m) |
|------|-----|-------|----------|
| LST_Day_1km | دمای سطح زمین روز | 0.02 Kelvin | 1000 |
| LST_Night_1km | دمای سطح زمین شب | 0.02 Kelvin | 1000 |
| Emis_31 | امیتنس باند 31 (11μm) | 0.002 | 1000 |
| Emis_32 | امیتنس باند 32 (12μm) | 0.002 | 1000 |
| QC_Day | کیفیت داده روز | - | 1000 |
| QC_Night | کیفیت داده شب | - | 1000 |

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

# جستجوی MODIS LST Terra
search = catalog.search(
    collections=["modis-11A1-061"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-01-01/2023-12-31",
    query={"id": {"starts_with": "MOD11A1"}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print("---")
```

### خواندن تصویر دما

```python
import rasterio
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # خواندن باند دمای روز
    lst_href = planetary_computer.sign(item.assets["LST_Day_1km"].href)
    with rasterio.open(lst_href) as src:
        data = src.read(1)
        # تبدیل به درجه سانتیگراد
        lst_celsius = data * 0.02 - 273.15
        print(f"میانگین دما: {lst_celsius.mean():.1f}°C")
        print(f"حداکثر دما: {lst_celsius.max():.1f}°C")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [اطلاعات MOD11A1](https://lpdaac.usgs.gov/products/mod11a1v061/)
