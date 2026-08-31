# Sentinel-1 SAR GRD

## معرفی

Sentinel-1 ماهواره‌ای مجهز به رادار(SAR) از آژانس فضایی اروپا است. سنسور SAR در تمام شرایط آب‌وهوایی و در شب و روز کار می‌کند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Sentinel-1 SAR GRD |
| **سال شروع** | ۲۰۱۴ |
| **وضوح مکانی** | ۱۰ متر |
| **عرض پوشش** | ۲۵۰ کیلومتر |
| **چرخه تکرار** | ۶ روز |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باندها

| باند | نام | توضیح |
|------|-----|-------|
| vv | VV (عمودی-عمودی) | پلارایزاسیون عمودی |
| vh | VH (عمودی-افقی) | پلارایزاسیون متقاطع |

## نصب پیش‌نیازها

```bash
pip install pystac-client planetary-computer numpy
```

## دسترسی مستقیم با پایتون

### جستجوی تصاویر SAR

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# جستجوی Sentinel-1
search = catalog.search(
    collections=["sentinel-1-grd"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    datetime="2023-06-01/2023-06-30",
    query={"platform": {"in": ["SENTINEL-1A", "SENTINEL-1B", "SENTINEL-1C"]}},
    max_items=10,
)

for item in search.items():
    print(f"تاریخ: {item.properties['datetime']}")
    print(f"شناسه: {item.id}")
    print(f"پلتفرم: {item.properties.get('platform', 'نامشخص')}")
    print("---")
```

### خواندن تصویر SAR

```python
import rasterio
import numpy as np
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # خواندن باند VV
    vv_href = planetary_computer.sign(item.assets["vv"].href)
    with rasterio.open(vv_href) as src:
        vv = src.read(1)
        print(f"ابعاد: {vv.shape}")
        print(f"مقدار میانگین dB: {np.mean(vv):.2f}")

    # خواندن باند VH
    vh_href = planetary_computer.sign(item.assets["vh"].href)
    with rasterio.open(vh_href) as src:
        vh = src.read(1)
        print(f"مقدار میانگین dB: {np.mean(vh):.2f}")
```

### محاسبه نسبت VH/VV

```python
import rasterio
import numpy as np
import planetary_computer

item = list(search.items())[0]

vv_href = planetary_computer.sign(item.assets["vv"].href)
vh_href = planetary_comcomputer.sign(item.assets["vh"].href)

with rasterio.open(vv_href) as src:
    vv = src.read(1)
with rasterio.open(vh_href) as src:
    vh = src.read(1)

# نسبت VH/VV (dB)
ratio = vh - vv  # در مقیاس dB
print(f"میانگین نسبت VH/VV: {np.mean(ratio):.2f} dB")
```

## کاربردها

- **تشخیص سیل:** آب در تصاویر SAR تاریک است
- **پایش محصولات کشاورزی:** تغییرات بافت
- **نقشه‌برداری یخ:** تشخیص یخ دریایی
- **نظارت بر جنگل‌زدایی:** تغییرات پوشش جنگل

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [مستندات Sentinel-1](https://sentinel.esa.int/web/sentinel/missions/sentinel-1)
