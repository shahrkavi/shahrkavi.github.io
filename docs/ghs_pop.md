# GHS - جمعیت (Population)

## معرفی

لایه جمعیت GHS (Global Human Settlement Layer) نقشه‌هایی از توزیع جمعیت جهان با وضوح ۱۰۰ متر ارائه می‌دهد. این داده‌ها برای مطالعات شهرنشینی و جمعیت‌شناسی بسیار مفید هستند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | GHS-POP (Population) |
| **وضوح مکانی** | ۱۰۰ متر |
| **سال‌های موجود** | ۱۹۷۵، ۱۹۸۰، ۱۹۸۵، ۱۹۹۰، ۱۹۹۵، ۲۰۰۰، ۲۰۰۵، ۲۰۱۰، ۲۰۱۵، ۲۰۲۰، ۲۰۲۵، ۲۰۳۰ |
| **واحد** | تعداد نفر در هر پیکسل |
| **فرمت** | GeoTIFF |
| **هزینه** | رایگان |

## باند

| باند | نام | توضیح |
|------|-----|-------|
| pop | جمعیت (Population) | تعداد نفر در هر پیکسل |

## نصب پیش‌نیازها

```bash
pip install rasterio numpy requests
```

## دسترسی مستقیم با پایتون

### خواندن فایل GeoTIFF محلی

```python
import rasterio
import numpy as np
from pathlib import Path

# مسیر فایل‌های GHS
GHS_ROOT = Path("data/GHS")
POP_DIR = GHS_ROOT / "POP"

# لیست فایل‌های موجود
tif_files = sorted(POP_DIR.glob("GHS_*_E*_*.tif"))
print(f"تعداد فایل‌ها: {len(tif_files)}")

# خواندن یک فایل
if tif_files:
    with rasterio.open(tif_files[0]) as src:
        pop = src.read(1)
        print(f"ابعاد: {src.width} x {src.height}")
        print(f"جمعیت میانگین: {np.mean(pop):.1f}")
        print(f"حداکثر جمعیت: {np.max(pop):.1f}")
```

### دانلود از GHSL

```python
import requests

# دانلود مستقیم از GHSL (JRC)
year = 2020
url = f"https://jeodpp.jrc.ec.europa.eu/ftp/jrc-ghsl/GHS_POP_GLOBE_R2023A/GHS_POP_E{year}_GLOBE_R2023A_4326_100/V1-0/tiles/GHS_POP_E2020_GLOBE_R2023A_4326_100_V1_0_R6_C22.zip"

response = requests.get(url, stream=True)
if response.status_code == 200:
    with open(f"GHS_POP_E{year}.zip", "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    print(f"فایل دانلود شد: GHS_POP_E{year}.zip")
```

### استخراج داده برای یک محدوده

```python
import rasterio
from rasterio.windows import from_bounds

with rasterio.open(tif_files[0]) as src:
    # تعریف محدوده جغرافیایی (تهران)
    window = from_bounds(
        west=51.0, south=35.5,
        east=51.8, north=36.0,
        transform=src.transform
    )
    pop_crop = src.read(1, window=window)
    print(f"جمعیت میانگین تهران: {np.mean(pop_crop):.1f}")
```

## لینک‌های مفید

- [GHSL Data Portal](https://ghsl.jrc.ec.europa.eu/)
- [European Commission JRC](https://ec.europa.eu/jrc/)
