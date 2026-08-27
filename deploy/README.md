# Ubuntu production deployment

This project is deployed as one FastAPI service. The API also serves the
frontend files, so the browser uses the same origin for both the UI and API.
Nginx provides the public HTTP/HTTPS endpoint and systemd keeps the service
running.

## Bing Maps key

The frontend basemap selector uses Bing tile endpoints. Create a Bing Maps
key, restrict it to the production hostname in the Bing Maps portal, then set
it in `js/config.js`:

```javascript
window.BING_MAPS_KEY = 'YOUR_BING_MAPS_KEY';
```

The key is visible to browsers by design, so domain restrictions are required.

## 1. Install system packages

Run on Ubuntu 22.04 or newer:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx git build-essential \
  gdal-bin libgdal-dev libgeos-dev libproj-dev proj-bin
```

## 2. Create the application user and transfer the project

Use Git, or transfer the project with `rsync` from the development machine:

```bash
sudo adduser --system --group --home /opt/shahrkavi shahrkavi
sudo mkdir -p /opt/shahrkavi
sudo chown -R shahrkavi:shahrkavi /opt/shahrkavi
sudo -u shahrkavi git clone YOUR_REPOSITORY_URL /opt/shahrkavi
```

Do not transfer `.env`, `.env.*`, `fastapi/.env/`, `fastapi/cache/`, or
`fastapi/downloads/`. The runtime directories are created on the server.

## 3. Install Python dependencies

```bash
sudo -u shahrkavi python3 -m venv /opt/shahrkavi/venv
sudo -u shahrkavi /opt/shahrkavi/venv/bin/pip install --upgrade pip
sudo -u shahrkavi /opt/shahrkavi/venv/bin/pip install -r /opt/shahrkavi/fastapi/requirements.txt
sudo -u shahrkavi mkdir -p /opt/shahrkavi/fastapi/cache /opt/shahrkavi/fastapi/downloads
```

If deployment is from an archive instead of Git, copy the project into
`/opt/shahrkavi` and set ownership afterward:

```bash
sudo chown -R shahrkavi:shahrkavi /opt/shahrkavi
```

## 4. Configure environment values

```bash
sudo -u shahrkavi cp /opt/shahrkavi/fastapi/.env.example /opt/shahrkavi/fastapi/.env
sudo nano /opt/shahrkavi/fastapi/.env
```

Keep this file readable only by the service user:

```bash
sudo chmod 600 /opt/shahrkavi/fastapi/.env
```

## 5. Install and start systemd service

The service intentionally runs one worker because job queues and job state are
currently in process memory. Do not add `--workers 2` or more until the queue
is moved to a shared broker/database.

```bash
sudo cp /opt/shahrkavi/deploy/shahrkavi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shahrkavi
sudo systemctl status shahrkavi
curl http://127.0.0.1:8000/healthz
```

View logs with:

```bash
sudo journalctl -u shahrkavi -f
```

## 6. Configure Nginx

Replace `example.com` in `deploy/nginx.conf`, then install it:

```bash
sudo cp /opt/shahrkavi/deploy/nginx.conf /etc/nginx/sites-available/shahrkavi
sudo ln -s /etc/nginx/sites-available/shahrkavi /etc/nginx/sites-enabled/shahrkavi
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Enable HTTPS

After DNS points to the server:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

## Updating the application

```bash
sudo -u shahrkavi git -C /opt/shahrkavi pull --ff-only
sudo -u shahrkavi /opt/shahrkavi/venv/bin/pip install -r /opt/shahrkavi/fastapi/requirements.txt
sudo systemctl restart shahrkavi
curl http://127.0.0.1:8000/healthz
```

The `fastapi/cache/` and `fastapi/downloads/` directories are runtime data and
should not be removed during updates. Downloadable files are automatically
expired after four hours.
