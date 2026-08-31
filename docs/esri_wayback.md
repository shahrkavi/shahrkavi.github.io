# Esri World Atlas Wayback

## معرفی

ابزار GEHistoricalImagery علاوه بر Google Earth، از تصاویر تاریخی Esri World Atlas Wayback نیز پشتیبانی می‌کند. تصاویر Wayback مجموعه‌ای از تصاویر ماهواره‌ای تاریخی هستند که توسط Esri جمع‌آوری شده‌اند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **پوشش** | جهانی |
| **سال شروع** | ۱۹۳۰ |
| **حداکثر زوم** | ۲۰ |
| **فرمت خروجی** | GeoTIFF |
| **هزینه** | رایگان |
| **پلتفرم** | ویندوز، لینوکس، macOS |

## تفاوت Google Earth و Wayback

| ویژگی | Google Earth (tm) | Esri Wayback |
|-------|-------------------|--------------|
| **حداکثر زوم** | ۲۱ | ۲۰ |
| **پوشش** | جهانی | جهانی |
| **تعداد تصاویر** | بیشتر | کمتر |
| **سرعت دانلود** | سریع‌تر | کمی کندتر |
| **تاریخ تصویربرداری** | دقیق | تقریبی |

## نصب

مشابه Google Earth Historical - از [GitHub Releases](https://github.com/Mbucari/GEHistoricalImagery/releases) دانلود کنید.

## دستورات اصلی

### `availability` - نمایش تاریخ‌های موجود

```bash
GEHistoricalImagery availability \
  --lower-left 35.5,51.0 \
  --upper-right 36.0,51.8 \
  --zoom 18 \
  --provider wayback
```

**نکته:** درخواست‌های Wayback ممکن است ابتدا ناموفق باشند اما پس از ۱-۲ دقیقه مجدداً تلاش کنید. داده‌ها ممکن است در حافظه سرد باشند.

### `download` - دانلود تصویر

```bash
GEHistoricalImagery download \
  --lower-left 35.5,51.0 \
  --upper-right 36.0,51.8 \
  --zoom 18 \
  --date 2023/06/15 \
  --provider wayback \
  --output "./tehran_wayback_2023.tif"
```

**پارامترهای اضافی برای Wayback:**

| پارامتر | توضیح |
|---------|-------|
| `--layer-date` | تطبیق بر اساس تاریخ لایه (سریع‌تر) |
| `--exact-date` | تطبیق دقیق تاریخ |

## استفاده با پایتون

```python
import subprocess
import json

GEH_PATH = "/path/to/GEHistoricalImagery"

# جستجوی تاریخ‌های موجود در Wayback
cmd = [
    GEH_PATH, "availability",
    "--lower-left", "35.5,51.0",
    "--upper-right", "36.0,51.8",
    "--zoom", "18",
    "--provider", "wayback",
    "-o", "wayback_availability.json",
    "-q"
]
subprocess.run(cmd)

# دانلود تصویر
cmd_download = [
    GEH_PATH, "download",
    "--lower-left", "35.5,51.0",
    "--upper-right", "36.0,51.8",
    "--zoom", "18",
    "--date", "2023/06/15",
    "--provider", "wayback",
    "--output", "./tehran_wayback.tif"
]
subprocess.run(cmd_download)
```

## نکات مهم

- برای Wayback، حداکثر زوم ۲۰ است (نه ۲۱)
- تطبیق تاریخ تصویربرداری کندتر است زیرا نیاز به کوئری اضافی برای هر تایل دارد
- از `--layer-date` برای دانلود سریع‌تر استفاده کنید
- کش تصاویر مشترک با Google Earth است

## لینک‌های مفید

- [GitHub GEHistoricalImagery](https://github.com/Mbucari/GEHistoricalImagery)
- [مستندات Wayback](https://github.com/Mbucari/GEHistoricalImagery/blob/master/docs/download.md)
