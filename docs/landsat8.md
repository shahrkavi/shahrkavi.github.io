# Landsat 8 OLI/TIRS

## معرفی

Landsat 8 در فوریه ۲۰۱۳ پرتاب شد و تصاویر ماهواره‌ای با کیفیت بالا از سطح زمین ارائه می‌دهد. این ماهواره برای مطالعات تغییرات ارضی، کشاورزی و محیط زیست بسیار محبوب است.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Landsat 8 OLI/TIRS |
| **سال شروع** | ۲۰۱۳ |
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
bbox = [51.0, 35.5, 51.8, 36.0]

# جستجوی تصاویر Landsat 8
search = catalog.search(
    collections=["landsat-c2-l2"],
    bbox=bbox,
    datetime="2023-01-01/2023-12-31",
    query={"platform": {"eq": "landsat-8"}},
    max_items=10,
)

# نتایج
for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"ابرپوشانی: {item.properties.get('eo:cloud_cover', 'نامشخص')}%")
    print(f"شناسه: {item.id}")
    print("---")
```

### دانلود تصویر با فیلتر ابر

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

search = catalog.search(
    collections=["landsat-c2-l2"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-06-01/2023-06-30",
    query={
        "platform": {"eq": "landsat-8"},
        "eo:cloud_cover": {"lt": 20},  # کمتر از ۲۰٪ ابر
    },
    max_items=5,
)

for item in search.items():
    cloud = item.properties.get("eo:cloud_cover", "نامشخص")
    print(f"تاریخ: {item.properties['datetime']}, ابر: {cloud}%")
```

### دانلود و خواندن باند حرارتی

```python
import rasterio
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # باند حرارتی
    thermal = item.assets["lwir11"]
    signed_url = planetary_computer.sign(thermal.href)

    with rasterio.open(signed_url) as src:
        data = src.read(1)
        # تبدیل به دمای کلوین (برای Landsat 8)
        import numpy as np
        kelvin = data * 0.00341802 + 149.0
        celsius = kelvin - 273.15
        print(f"دمای میانگین: {np.mean(celsius):.1f} درجه سانتیگراد")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [بازنمایی Landsat 8](https://planetarycomputer.microsoft.com/collection/datasets/landsat-c2-l2)
