# Sentinel-2 MSI L2A

## معرفی

Sentinel-2 ماهواره‌ای از آژانس فضایی اروپا (ESA) است که تصاویر چندطیفی با وضوح بالا از سطح زمین ارائه می‌دهد. داده‌های L2A پردازش‌شده و آماده استفاده هستند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Sentinel-2 MSI L2A |
| **سال شروع** | ۲۰۱۵ |
| **وضوح مکانی** | ۱۰، ۲۰ و ۶۰ متر |
| **عرض پوشش** | ۲۹۰ کیلومتر |
| **چرخه تکرار** | ۵ روز |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باندها

| باند | نام | وضوح (m) | طول موج (nm) | کاربرد |
|------|-----|----------|--------------|--------|
| coastal | ساحلی | 60 | 443 | آب کم‌عمق |
| blue | آبی | 10 | 490 | تجزیه آب |
| green | سبز | 10 | 560 | پوشش گیاهی |
| red | قرمز | 10 | 665 | NDVI |
| rededge1 | رد-لبه 1 | 20 | 705 | پوشش گیاهی |
| rededge2 | رد-لبه 2 | 20 | 740 | پوشش گیاهی |
| rededge3 | رد-لبه 3 | 20 | 783 | پوشش گیاهی |
| nir | مادون قرمز نزدیک | 10 | 842 | NDVI |
| nir08 | مادون قرمز نزدیک | 20 | 865 | NDVI |
| nir09 | مادون قرمز باریک | 20 | 945 | رطوبت |
| swir16 | مادون قرمز کوتاه 1 | 20 | 1610 | رطوبت خاک |
| swir22 | مادون قرمز کوتاه 2 | 20 | 2190 | ترکیبات زمین |
| scl | طبقه‌بندی صحنه | 20 | - | حذف ابر |

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

# جستجوی Sentinel-2
search = catalog.search(
    collections=["sentinel-2-l2a"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-06-01/2023-06-30",
    query={"eo:cloud_cover": {"lt": 10}},
    max_items=10,
)

for item in search.items():
    cloud = item.properties.get("eo:cloud_cover", "نامشخص")
    print(f"تاریخ: {item.properties['datetime']}, ابر: {cloud}%")
```

### خواندن باند ۱۰ متری

```python
import rasterio
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # باند قرمز (۱۰ متر)
    red_href = planetary_computer.sign(item.assets["red"].href)
    with rasterio.open(red_href) as src:
        print(f"ابعاد: {src.width} x {src.height}")
        print(f"وضوح: {src.res[0]} متر")
```

### حذف ابر با استفاده از SCL

```python
import rasterio
import numpy as np
import planetary_computer

item = list(search.items())[0]

# خواندن طبقه‌بندی صحنه (SCL)
scl_href = planetary_computer.sign(item.assets["scl"].href)
red_href = planetary_computer.sign(item.assets["red"].href)

with rasterio.open(scl_href) as scl_src:
    scl = scl_src.read(1)

with rasterio.open(red_href) as red_src:
    red = red_src.read(1)

# SCL: 3=سایه ابر، 8=ابرهای مtówی، 9=ابرهای بالا، 10=ابرهای سیرکوس
cloud_mask = np.isin(scl, [3, 8, 9, 10])

# اعمال ماسک ابر
red_clean = red.copy()
red_clean[cloud_mask] = 0
print(f"پیکسل‌های ابری: {cloud_mask.sum()} از {cloud_mask.size}")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [مستندات Sentinel-2](https://sentinel.esa.int/web/sentinel/missions/sentinel-2)
