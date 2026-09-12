# Local Traffic/PostGIS Setup

This setup runs a dedicated local PostGIS container without changing the main
application container.

## Start PostGIS

```bash
docker compose -f docker-compose.traffic.yml up -d
```

The database is available on `localhost:5433` by default.

## Convert the timestamps

First create a small test file:

```bash
python scripts/convert_traffic_csv.py --output data/traffic/sample.csv --limit 1000
```

The output preserves the original Jalali timestamp columns and adds:

- `start_datetime`
- `source_extra` (when present in the source file)
- `end_datetime`
- `start_date`
- `end_date`

The Gregorian timestamps are local Iran timestamps stored without timezone.

## Import

Use `psql` from a PostgreSQL client installation. From the repository root:

```bash
set DATABASE_URL=postgresql://shahrkavi:shahrkavi-local@localhost:5433/shahrkavi
psql "%DATABASE_URL%" -f db/traffic/002_import.sql
```

The `manual_match.csv` import command in `002_import.sql` uses client-side
`\copy`, so it works from Windows when run from the repository root.

Traffic rows can then be imported with:

```sql
\copy traffic.iran_daily_traffic(year_jalali, month_jalali, province, route_code, route_name, start_time_jalali, end_time_jalali, duration_minutes, total_vehicles, class1_vehicles, class2_vehicles, class3_vehicles, class4_vehicles, class5_vehicles, avg_speed, speed_violations, distance_violations, overtake_violations, source_extra, start_datetime, end_datetime, start_date, end_date) FROM 'data/traffic/sample.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
```

After importing, run:

```sql
ANALYZE traffic.manual_match;
ANALYZE traffic.iran_daily_traffic;
SELECT COUNT(*) FROM traffic.manual_match;
SELECT COUNT(*) FROM traffic.iran_daily_traffic;
```

## Run the traffic API locally

Install the FastAPI environment dependencies, then point the API at the local
PostGIS container:

```powershell
$env:TRAFFIC_DATABASE_URL = 'postgresql://shahrkavi:shahrkavi-local@localhost:5433/shahrkavi'
fastapi\.env\Scripts\python.exe -m uvicorn main:app --app-dir fastapi --reload
```

The traffic endpoints are:

- `POST /traffic-counters/search`
- `POST /traffic-counters/export`

The browser workflow sends the drawn polygon and Gregorian ISO date range to
these endpoints. GeoJSON export creates one point feature per counter-day, so
all daily records remain available as feature properties.

The full converted CSV should only be generated after the sample import and
date/spatial queries succeed.
