# ایستگاه‌های هواشناسی

## معرفی

داده‌های هواشناسی شامل اطلاعات روزانه از ایستگاه‌های هواشناسی سراسر جهان است. این داده‌ها شامل دما، بارش، سرعت باد و سایر متغیرها می‌شوند.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Weather Station Data |
| **پوشش** | ایستگاه‌های جهانی |
| **فرمت** | CSV |
| **سال شروع** | ۱۹۵۰ (بسته به ایستگاه) |
| **هزینه** | رایگان |

## نصب پیش‌نیازها

```bash
pip install meteostat pandas
```

## دسترسی مستقیم با پایتون

### جستجوی ایستگاه‌ها

```python
from meteostat import stations
from datetime import datetime

# جستجوی ایستگاه‌ها در یک محدوده
station_list = stations.Meteostat(
    lat=35.75,  # عرض جغرافیایی
    lon=51.42,  # طول جغرافیایی
)

# دریافت نزدیک‌ترین ایستگاه‌ها
nearby = station_list.nearby(100)  # ۱۰۰ کیلومتر

print(f"تعداد ایستگاه‌ها: {len(nearby)}")
for station in nearby:
    print(f"  - {station['name']} ({station['id']})")
```

### دریافت داده‌های روزانه

```python
from meteostat import daily
from datetime import datetime

# دریافت داده‌های روزانه یک ایستگاه
data = daily(
    "40754",  # شناسه ایستگاه (مثلاً تهران)
    start=datetime(2023, 1, 1),
    end=datetime(2023, 12, 31),
)

print(data.head())
```

### محاسبه آمار ماهانه

```python
import pandas as pd
from meteostat import daily
from datetime import datetime

data = daily(
    "40754",
    start=datetime(2023, 1, 1),
    end=datetime(2023, 12, 31),
)

# تبدیل به DataFrame
df = data.fetch()

# محاسبه آمار ماهانه
monthly = df.resample("M").agg({
    "tavg": "mean",  # دمای میانگین
    "prcp": "sum",   # بارش کل
    "wspd": "mean",  # سرعت باد میانگین
})

print(monthly)
```

### تجسم داده‌ها

```python
import pandas as pd
from meteostat import daily
from datetime import datetime
import matplotlib.pyplot as plt

data = daily(
    "40754",
    start=datetime(2023, 1, 1),
    end=datetime(2023, 12, 31),
)

df = data.fetch()

# رسم نمودار دما
plt.figure(figsize=(12, 6))
plt.plot(df.index, df["tavg"], label="دمای میانگین")
plt.plot(df.index, df["tmax"], label="حداکثر دما", alpha=0.5)
plt.plot(df.index, df["tmin"], label="حداقل دما", alpha=0.5)
plt.xlabel("تاریخ")
plt.ylabel("دما (°C)")
plt.title("دمای تهران در سال ۲۰۲۳")
plt.legend()
plt.grid(True)
plt.savefig("temperature_tehran.png")
plt.show()
```

## متغیرهای موجود

| متغیر | نام | واحد |
|-------|-----|------|
| tavg | دمای میانگین | °C |
| tmin | دمای حداقل | °C |
| tmax | دمای حداکثر | °C |
| prcp | بارش | mm |
| wspd | سرعت باد | km/h |
| wdir | جهت باد | درجه |
| humd | رطوبت | % |

## لینک‌های مفید

- [Meteostat](https://meteostat.net/)
- [Open-Meteo](https://open-meteo.com/)
