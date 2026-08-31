# تصاویر تاریخی Google Earth

## معرفی

ابزار GEHistoricalImagery یک ابزار خط فرمان برای دانلود تصاویر تاریخی هوایی از Google Earth است. این ابزار تصاویر را از سال ۱۹۳۰ تاکنون دریافت و به صورت یک فایل GeoTIFF ذخیره می‌کند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **پوشش** | جهانی |
| **سال شروع** | ۱۹۳۰ |
| **حداکثر زوم** | ۲۱ |
| **فرمت خروجی** | GeoTIFF |
| **هزینه** | رایگان |
| **پلتفرم** | ویندوز، لینوکس، macOS |

## نصب

### ویندوز

1. به [GitHub Releases](https://github.com/Mbucari/GEHistoricalImagery/releases) بروید
2. آخرین نسخه را دانلود کنید
3. فایل زیپ را اکسترact کنید
4. فایل اجرایی `GEHistoricalImagery.exe` را در پوشه دلخواه قرار دهید

### لینوکس / macOS

```bash
wget https://raw.githubusercontent.com/Mbucari/GEHistoricalImagery/refs/heads/master/gehinix.sh
chmod +x gehinix.sh
./gehinix.sh
```

## دستورات اصلی

### `availability` - نمایش تاریخ‌های موجود

این دستور تاریخ‌های موجود تصاویر هوایی را برای یک منطقه نمایش می‌دهد.

```bash
GEHistoricalImagery availability \
  --lower-left 35.5,51.0 \
  --upper-right 36.0,51.8 \
  --zoom 18
```

**پارامترهای اصلی:**

| پارامتر | توضیح |
|---------|-------|
| `--lower-left LAT,LONG` | گوشه پایین-چپ منطقه |
| `--upper-right LAT,LONG` | گوشه بالا-راست منطقه |
| `--zoom N` | سطح زوم (۱-۲۱) |
| `--min-date yyyy/MM/dd` | حداقل تاریخ |
| `--max-date yyyy/MM/dd` | حداکثر تاریخ |
| `--complete` | فقط تاریخ‌هایی که پوشش کامل دارند |
| `--provider tm` | ارائه‌دهنده (tm=Google Earth) |
| `-o output.json` | ذخیره نتایج به صورت GeoJSON |

**خروجی نمونه:**

```
Loading Quad Tree Packets: Done!
[0]  2024/06/05  [1]  2023/09/05  [2]  2023/05/28  [3]  2023/04/29
[4]  2022/09/26  [5]  2021/08/17  [6]  2021/06/15  [7]  2021/06/11
[8]  2020/10/03  [9]  2020/09/30  [a]  2020/06/07  [b]  2019/10/03
```

### `download` - دانلود تصویر

این دستور تصویر تاریخی یک منطقه را در تاریخ مشخص دانلود می‌کند.

```bash
GEHistoricalImagery download \
  --lower-left 35.5,51.0 \
  --upper-right 36.0,51.8 \
  --zoom 18 \
  --date 2023/06/15 \
  --output "./tehran_2023.tif"
```

**پارامترهای اصلی:**

| پارامتر | توضیح |
|---------|-------|
| `--lower-left LAT,LONG` | گوشه پایین-چپ منطقه |
| `--upper-right LAT,LONG` | گوشه بالا-راست منطقه |
| `--zoom N` | سطح زوم (۱-۲۱) |
| `--date yyyy/MM/dd` | تاریخ مورد نظر |
| `--output file.tif` | مسیر فایل خروجی |
| `--date-match` | نحوه تطبیق تاریخ |
| `--target-sr EPSG:code` | سیستم مختصات خروجی |
| `-p N` | تعداد رشته‌های موازی |

**گزینه‌های `--date-match`:**

| گزینه | توضیح |
|-------|-------|
| `Closest` | نزدیک‌ترین تاریخ (پیش‌فرض) |
| `Exact` | فقط تاریخ دقیق |
| `ClosestBefore` | نزدیک‌ترین تاریخ قبلی |
| `ClosestAfter` | نزدیک‌ترین تاریخ بعدی |

### `info` - اطلاعات تصویر

```bash
GEHistoricalImagery info \
  --lat 35.75 \
  --lon 51.42 \
  --zoom 18
```

## تعریف منطقه

### روش مستطیلی (دو گوشه)

```bash
--lower-left 35.5,51.0 --upper-right 36.0,51.8
```

### روش چندضلعی

```bash
--region 35.5,51.0+35.5,51.8+36.0,51.8+36.0,51.0
```

### فایل KML/KMZ

```bash
--region-file ./my_region.kmz
```

## استفاده با پایتون

```python
import subprocess
import json

# تعریف مسیر ابزار
GEH_PATH = "/path/to/GEHistoricalImagery"

# جستجوی تاریخ‌های موجود
cmd = [
    GEH_PATH, "availability",
    "--lower-left", "35.5,51.0",
    "--upper-right", "36.0,51.8",
    "--zoom", "18",
    "-o", "availability.json",
    "-q"
]
subprocess.run(cmd)

# خواندن نتایج
with open("availability.json") as f:
    data = json.load(f)
    print(f"تعداد ویژگی‌ها: {len(data.get('features', []))}")
```

## نکات مهم

- تصاویر Google Earth حداکثر تا زوم ۲۱ در دسترس هستند
- اگر تصویری در تاریخ مورد نظر موجود نباشد، ابزار نزدیک‌ترین تاریخ را استفاده می‌کند
- کش تصاویر در پوشه `GEHI_cache` ذخیره می‌شود
- برای مناطق بزرگ، از زوم کمتر استفاده کنید تا سرعت دانلود افزایش یابد

## لینک‌های مفید

- [GitHub GEHistoricalImagery](https://github.com/Mbucari/GEHistoricalImagery)
- [مستندات دستور availability](https://github.com/Mbucari/GEHistoricalImagery/blob/master/docs/availability.md)
- [مستندات دستور download](https://github.com/Mbucari/GEHistoricalImagery/blob/master/docs/download.md)
