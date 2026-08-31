# GHS - سطح ساخته‌شده (Built Surface)

## معرفی

لایه سطح ساخته‌شده GHS نقشه‌هایی از سطح زمین که توسط ساختمان‌ها و زیرساخت‌ها پوشیده شده ارائه می‌دهد. این داده‌ها برای مطالعات شهرنشینی و تغییرات ارضی بسیار مفید هستند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | GHS-BUILT (Built Surface) |
| **وضوح مکانی** | ۱۰۰ متر |
| **سال‌های موجود** | ۱۹۷۵، ۱۹۸۰، ۱۹۸۵، ۱۹۹۰، ۱۹۹۵، ۲۰۰۰، ۲۰۰۵، ۲۰۱۰، ۲۰۱۵، ۲۰۲۰، ۲۰۲۵، ۲۰۳۰ |
| **واحد** | درصد پوشش ساخته‌شده |
| **فرمت** | GeoTIFF |
| **هزینه** | رایگان |

## باند

| باند | نام | توضیح |
|------|-----|-------|
| built | سطح ساخته‌شده (Built Surface) | درصد پوشش در هر پیکسل |

## نصب پیش‌نیازها

```bash
pip install rasterio numpy
```

## دسترسی مستقیم با پایتون

### خواندن فایل GeoTIFF محلی

```python
import rasterio
import numpy as np
from pathlib import Path

GHS_ROOT = Path("data/GHS")
BUILT_DIR = GHS_ROOT / "BUILT"

# لیست فایل‌ها
tif_files = sorted(BUILT_DIR.glob("GHS_*_E*_*.tif"))
print(f"تعداد فایل‌ها: {len(tif_files)}")

# خواندن یک فایل
if tif_files:
    with rasterio.open(tif_files[0]) as src:
        built = src.read(1)
        print(f"ابعاد: {src.width} x {src.height}")
        print(f"درصد میانگین سطح ساخته‌شده: {np.mean(built):.1f}%")
```

### مقایسه تغییرات ساخت‌وساز

```python
import rasterio
import numpy as np
from pathlib import Path

GHS_ROOT = Path("data/GHS")
BUILT_DIR = GHS_ROOT / "BUILT"

# مقایسه ۱۹۹۰ و ۲۰۲۰
files_1990 = list(BUILT_DIR.glob("GHS_*_E1990_*.tif"))
files_2020 = list(BUILT_DIR.glob("GHS_*_E2020_*.tif"))

if files_1990 and files_2020:
    with rasterio.open(files_1990[0]) as src:
        built_1990 = src.read(1)

    with rasterio.open(files_2020[0]) as src:
        built_2020 = src.read(1)

    # تغییرات
    change = built_2020 - built_1990
    print(f"تغییرات میانگین: {np.mean(change):.1f}%")
    print(f"مناطق جدید ساخته‌شده: {np.sum(change > 0)} پیکسل")
```

### استخراج برای یک محدوده

```python
import rasterio
from rasterio.windows import from_bounds

with rasterio.open(tif_files[0]) as src:
    window = from_bounds(
        west=51.0, south=35.5,
        east=51.8, north=36.0,
        transform=src.transform
    )
    built_crop = src.read(1, window=window)
    print(f"سطح ساخته‌شده تهران: {np.mean(built_crop):.1f}%")
```

## لینک‌های مفید

- [GHSL Data Portal](https://ghsl.jrc.ec.europa.eu/)
