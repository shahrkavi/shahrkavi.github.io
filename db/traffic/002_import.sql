\set ON_ERROR_STOP on

CREATE TEMP TABLE manual_match_stage (
    source_id BIGINT,
    name TEXT,
    route_code INTEGER,
    route_name TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION
);

\copy manual_match_stage(source_id, name, route_code, route_name, latitude, longitude) FROM 'manual_match.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8', NULL '')

INSERT INTO traffic.manual_match(
    source_id, name, route_code, route_name, latitude, longitude, geometry
)
SELECT
    source_id,
    NULLIF(name, ''),
    route_code,
    route_name,
    latitude,
    longitude,
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
FROM manual_match_stage
ON CONFLICT (route_code) DO UPDATE SET
    source_id = EXCLUDED.source_id,
    name = EXCLUDED.name,
    route_name = EXCLUDED.route_name,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    geometry = EXCLUDED.geometry;

-- Import the converted traffic CSV from the client machine with \copy.
-- The explicit column list prevents accidental dependence on CSV column order.
-- Example:
-- \copy traffic.iran_daily_traffic(year_jalali, month_jalali, province, route_code, route_name, start_time_jalali, end_time_jalali, duration_minutes, total_vehicles, class1_vehicles, class2_vehicles, class3_vehicles, class4_vehicles, class5_vehicles, avg_speed, speed_violations, distance_violations, overtake_violations, source_extra, start_datetime, end_datetime, start_date, end_date) FROM 'data/traffic/iran_daily_traffic_gregorian.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
