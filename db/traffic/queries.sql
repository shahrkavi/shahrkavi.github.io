-- Replace the polygon and dates with values supplied by the application.
WITH selected_counters AS (
    SELECT m.*
    FROM traffic.manual_match AS m
    WHERE ST_Intersects(
        m.geometry,
        ST_GeomFromText(
            'POLYGON((51.0 35.5, 51.7 35.5, 51.7 36.0, 51.0 36.0, 51.0 35.5))',
            4326
        )
    )
)
SELECT
    m.counter_id,
    m.name,
    m.route_code,
    m.route_name,
    m.latitude,
    m.longitude,
    COUNT(t.traffic_id) AS daily_record_count
FROM selected_counters AS m
LEFT JOIN traffic.iran_daily_traffic AS t
    ON t.route_code = m.route_code
   AND t.start_date >= DATE '2016-03-20'
   AND t.start_date < DATE '2016-04-20' + INTERVAL '1 day'
GROUP BY m.counter_id, m.name, m.route_code, m.route_name, m.latitude, m.longitude
ORDER BY m.route_code;

-- Daily records for selected counters, suitable for a point-layer export.
SELECT
    m.counter_id,
    m.name AS counter_name,
    m.route_code,
    m.route_name,
    m.geometry,
    t.*
FROM traffic.manual_match AS m
JOIN traffic.iran_daily_traffic AS t USING (route_code)
WHERE m.route_code = ANY(ARRAY[113201, 113203])
  AND t.start_date >= DATE '2016-03-20'
  AND t.start_date < DATE '2016-04-20' + INTERVAL '1 day'
ORDER BY m.route_code, t.start_date;
