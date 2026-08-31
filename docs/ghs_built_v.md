# GHS - حجم ساخته‌شده (Built Volume)

## معرفی

لایه حجم ساخته‌شده GHS برآوردی از حجم ساختمان‌ها و زیرساخت‌ها ارائه می‌دهد. این داده‌ها برای مطالعات تراکم شهری و برنامه‌ریزی شهری بسیار مفید هستند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | GHS-BUILT-V (Built Volume) |
| **وضوح مکانی** | ۱۰۰ متر |
| **سال‌های موجود** | ۱۹۷۵، ۱۹۸۰، ۱۹۸۵، ۱۹۹۰، ۱۹۹۵، ۲۰۰۰، ۲۰۰۵، ۲۰۱۰، ۲۰۱۵، ۲۰۲۰، ۲۰۲۵، ۲۰۳۰ |
| **واحد** | متر مکعب در هر پیکسل |
| **فرمت** | GeoTIFF |
| **هزینه** | رایگان |

## باند

| باند | نام | توضیح |
|------|-----|-------|
| built_v | حجم ساخته‌شده (Built Volume) | حجم ساختمان‌ها در هر پیکسل |

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
BUILT_V_DIR = GHS_ROOT / "BUILT_V"

# لیست فایل‌ها
tif_files = sorted(BUILT_V_DIR.glob("GHS_*_E*_*.tif"))
print(f"تعداد فایل‌ها: {len(tif_files)}")

# خواندن یک فایل
if tif_files:
    with rasterio.open(tif_files[0]) as src:
        built_v = src.read(1)
        print(f"ابعاد: {src.width} x {src.height}")
        print(f"حجم میانگین ساخته‌شده: {np.mean(built_v):.1f} m³")
```

### محاسبه حجم کل ساختمان‌ها

```python
import rasterio
import numpy as np
from pathlib import Path

GHS_ROOT = Path("data/GHS")
BUILT_V_DIR = GHS_ROOT / "BUILT_V"

files_2020 = list(BUILT_V_DIR.glob("GHS_*_E2020_*.tif"))

if files_2020:
    with rasterio.open(files_2020[0]) as src:
        built_v = src.read(1)
        pixel_area = src.res[0] * src.res[1]  # مساحت هر پیکسل (m²)

        # حجم کل ساختمان‌ها
        total_volume = np.sum(built_v) * pixel_area
        print(f"حجم کل ساختمان‌ها: {total_volume:,.0f} m³")
        print(f"حجم میانگین در هر پیکسل: {np.mean(built_v):.1f} m³")
```

### مقایسه تغییرات حجم ساخت‌وساز

```python
import rasterio
import numpy as np
from pathlib import Path

GHS_ROOT = Path("data/GHS")
BUILT_V_DIR = GHS_ROOT / "BUILT_V"

files_1990 = list(BUILT_V_DIR.glob("GHS_*_E1990_*.tif"))
files_2020 = list(BUILT_V_DIR.glob("GHS_*_E2020_*.tif"))

if files_1990 and files_2020:
    with rasterio.open(files_1990[0]) as src:
        built_v_1990 = src.read(1)

    with rasterio.open(files_2020[0]) as src:
        built_v_2020 = src.read(1)

    # تغییرات حجم
    change = built_v_2020 - built_v_1990
    print(f"تغییرات حجم میانگین: {np.mean(change):.1f} m³")
    print(f"مناطق با افزایش حجم: {np.sum(change > 0)} پیکسل")
    print(f"مناطق با کاهش حجم: {np.sum(change < 0)} پیکسل")
```

## لینک‌های مفید

- [GHSL Data Portal](https://ghsl.jrc.ec.europa.eu/)
