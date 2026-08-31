# Copernicus DEM GLO-30

## معرفی

Copernicus DEM یک مدل ارتفاعی دیجیتال جهانی با وضوح ۳۰ متر است که توسط آژانس فضایی اروپا تولید شده. این مدل برای مطالعات ارتفاعی، شیب و هیدرولوژی بسیار مفید است.

## ویژگی‌ها

| ویژگی | مقدار |
|-------|-------|
| **نام کامل** | Copernicus DEM GLO-30 |
| **وضوح مکانی** | ۳۰ متر |
| **پوشش** | کل جهان |
| **ارتفاع** | -۷۳.۲ تا +۸۲۵۱ متر |
| **دقت عمودی** | < ۴ متر (LE90) |
| **منبع داده** | Microsoft Planetary Computer |
| **هزینه** | رایگان |

## باند

| باند | نام | توضیح |
|------|-----|-------|
| dem | ارتفاع (Elevation) | ارتفاع به متر |

## نصب پیش‌نیازها

```bash
pip install pystac-client planetary-computer rasterio
```

## دسترسی مستقیم با پایتون

### جستجوی کاشی‌های DEM

```python
from pystac_client import Client
import planetary_computer

catalog = Client.open(
    "https://planetarycomputer.microsoft.com/api/stac/v1",
    modifier=planetary_computer.sign_inplace,
)

# جستجوی کاشی‌های DEM
search = catalog.search(
    collections=["cop-dem-glo-30"],
    bbox=[51.0, 35.5, 51.8, 36.0],
    max_items=10,
)

for item in search.items():
    print(f"شناسه: {item.id}")
    print(f"آسیب‌پذیری: {item.properties.get('grid:code', 'نامشخص')}")
    print("---")
```

### دانلود و خواندن DEM

```python
import rasterio
import numpy as np
import planetary_computer

items = list(search.items())
if items:
    item = items[0]

    # دریافت لینک دانلود
    dem_href = planetary_computer.sign(item.assets["dem"].href)

    with rasterio.open(dem_href) as src:
        dem = src.read(1)
        print(f"ابعاد: {src.width} x {src.height}")
        print(f"CRS: {src.crs}")
        print(f"ارتفاع میانگین: {np.mean(dem):.1f} متر")
        print(f"حداقل ارتفاع: {np.min(dem):.1f} متر")
        print(f"حداکثر ارتفاع: {np.max(dem):.1f} متر")
```

### محاسبه شیب

```python
import rasterio
import numpy as np
from rasterio.transform import array_bounds
import planetary_computer

item = list(search.items())[0]
dem_href = planetary_computer.sign(item.assets["dem"].href)

with rasterio.open(dem_href) as src:
    dem = src.read(1).astype(float)
    transform = src.transform

# محاسبه شیب با روش متفاوت
# تغییرات ارتفاع در راستای x و y
dy, dx = np.gradient(dem, src.res[0])
slope = np.degrees(np.arctan(np.sqrt(dx**2 + dy**2)))
print(f"شیب میانگین: {np.mean(slope):.1f} درجه")
print(f"شیب حداکثر: {np.max(slope):.1f} درجه")
```

### ذخیره DEM به صورت GeoTIFF

```python
import rasterio
from rasterio.transform import from_bounds
import planetary_computer

item = list(search.items())[0]
dem_href = planetary_computer.sign(item.assets["dem"].href)

with rasterio.open(dem_href) as src:
    dem = src.read(1)
    profile = src.profile.copy()

# ذخیره در فایل جدید
with rasterio.open("output_dem.tif", "w", **profile) as dst:
    dst.write(dem, 1)
    print("DEM با موفقیت ذخیره شد: output_dem.tif")
```

## لینک‌های مفید

- [Planetary Computer](https://planetarycomputer.microsoft.com/)
- [Copernicus DEM](https://spacedata.copernicus.eu/explore-more/news-archive/cdop3-copernicus-digital-elevation-model-now-available-for-the-world)
