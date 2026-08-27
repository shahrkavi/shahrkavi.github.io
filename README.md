# شهرکاوی - سامانه جستجوی دادههای مکانی

## Production deployment on Ubuntu

The recommended production setup runs FastAPI behind Nginx and systemd on a
single Ubuntu server. Complete instructions, service configuration, Nginx
configuration, HTTPS setup, and update commands are in
[`deploy/README.md`](deploy/README.md).

The application serves both the frontend and API from the same origin. Run
the API with one worker because processing jobs and their queues are currently
held in process memory.

Bing basemaps require a browser-side key. Set `window.BING_MAPS_KEY` in
`js/config.js` and restrict that key to the production domain.

## استقرار: GitHub Pages + Render

### ۱. آماده‌سازی مخزن GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/shahrkavi.git
git push -u origin main
```

### ۲. استقرار بکند روی Render

1. به https://render.com بروید
2. یک account بسازید و GitHub را connect کنید
3. دکمه **New +** → **Web Service**
4. مخزن `shahrkavi` را انتخاب کنید
5. تنظیمات:
   - **Name:** shahrkavi-api
   - **Environment:** Python
   - **Build Command:** `cd fastapi && pip install -r requirements.txt`
   - **Start Command:** `cd fastapi && uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free
6. دکمه **Create Web Service**
7. صبر کنید تا deploy شود (حدود ۲ دقیقه)
8. URL بکند را کپی کنید (مثال: `https://shahrkavi-api.onrender.com`)

### ۳. فعال‌سازی GitHub Pages

1. به Settings → Pages بروید
2. **Source:** GitHub Actions
3. **Branch:** main
4. Save کنید

### ۴. بهروزرسانی URL بکند

در `js/config.js`، URL Render را جایگزین کنید:

```javascript
window.API_BASE = 'https://shahrkavi-api.onrender.com';
```

### ۵. تست

پروژه روی `https://username.github.io/shahrkavi` در دسترس است.

---

## ساختار پروژه

```
shahrkavi/
├── index.html
├── js/
│   ├── config.js          # تنظیمات URL بکند
│   ├── treeview.js        # کتابخانه درخت
│   ├── api.js             # لایه API
│   ├── app.js             # مدیریت state
│   ├── datasets.js        # انتخاب دیتاست
│   ├── search.js          # اجرای جستجو
│   ├── results.js         # جدول نتایج
│   ├── process.js         # پردازش تصویر
│   └── ...
├── css/
│   └── style.css
├── fastapi/
│   ├── main.py            # نقطه ورود FastAPI
│   ├── landsat.py         # Landsat/DEM
│   ├── osm.py             # OpenStreetMap
│   ├── weather.py         # هواشناسی
│   └── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── deploy/
│   ├── README.md
│   ├── nginx.conf
│   └── shahrkavi.service
└── .github/workflows/
    └── deploy.yml
```

## API Endpoints

| Endpoint | توضیح |
|----------|-------|
| `GET /landsat/search` | جستجوی تصاویر ماهوارهای |
| `GET /landsat/dem` | جستجوی کاشیهای DEM |
| `POST /landsat/process` | اجرای پردازش تصویر |
| `GET /landsat/jobs/{id}` | وضعیت job |
| `GET /osm/search-layers` | جستجوی OSM |
| `GET /weather/search` | جستجوی هواشناسی |

## اجرای محلی

```bash
cd fastapi
pip install -r requirements.txt
uvicorn main:app --reload
```

یا با Docker:

```bash
docker compose up -d --build
```
