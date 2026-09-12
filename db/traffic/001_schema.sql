CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS traffic;

-- Counter locations (3,277 rows)
CREATE TABLE IF NOT EXISTS traffic.manual_match (
    counter_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT,
    name TEXT,
    route_code INTEGER NOT NULL UNIQUE,
    route_name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geometry geometry(Point, 4326) NOT NULL
        CHECK (ST_SRID(geometry) = 4326)
);

-- Daily traffic records
CREATE TABLE IF NOT EXISTS traffic.iran_daily_traffic (
    traffic_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    year_jalali SMALLINT NOT NULL,
    month_jalali SMALLINT NOT NULL,
    province TEXT,
    route_code INTEGER NOT NULL,
    route_name TEXT,
    start_time_jalali TEXT NOT NULL,
    end_time_jalali TEXT NOT NULL,
    start_datetime TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    end_datetime TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    duration_minutes INTEGER,
    total_vehicles BIGINT,
    class1_vehicles BIGINT,
    class2_vehicles BIGINT,
    class3_vehicles BIGINT,
    class4_vehicles BIGINT,
    class5_vehicles BIGINT,
    avg_speed NUMERIC(10, 2),
    speed_violations BIGINT,
    distance_violations BIGINT,
    overtake_violations BIGINT,
    source_extra TEXT,
    CHECK (end_datetime >= start_datetime),
    CHECK (end_date >= start_date)
);

-- Hourly traffic records (NEW)
CREATE TABLE IF NOT EXISTS traffic.iran_hourly_traffic (
    traffic_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    year_jalali SMALLINT NOT NULL,
    month_jalali SMALLINT NOT NULL,
    province TEXT,
    route_code INTEGER NOT NULL,
    route_name TEXT,
    start_time_jalali TEXT NOT NULL,
    end_time_jalali TEXT NOT NULL,
    start_datetime TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    end_datetime TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    duration_minutes INTEGER,
    total_vehicles BIGINT,
    class1_vehicles BIGINT,
    class2_vehicles BIGINT,
    class3_vehicles BIGINT,
    class4_vehicles BIGINT,
    class5_vehicles BIGINT,
    avg_speed NUMERIC(10, 2),
    speed_violations BIGINT,
    distance_violations BIGINT,
    overtake_violations BIGINT,
    source_extra TEXT,
    CHECK (end_datetime >= start_datetime),
    CHECK (end_date >= start_date)
);

-- Indexes for manual_match
CREATE INDEX IF NOT EXISTS manual_match_geometry_gix
    ON traffic.manual_match USING GIST (geometry);

-- Indexes for daily traffic
CREATE INDEX IF NOT EXISTS traffic_route_code_idx
    ON traffic.iran_daily_traffic (route_code);
CREATE INDEX IF NOT EXISTS traffic_start_datetime_idx
    ON traffic.iran_daily_traffic (start_datetime);
CREATE INDEX IF NOT EXISTS traffic_start_date_idx
    ON traffic.iran_daily_traffic (start_date);

-- Indexes for hourly traffic (NEW)
CREATE INDEX IF NOT EXISTS iht_route_code_idx
    ON traffic.iran_hourly_traffic (route_code);
CREATE INDEX IF NOT EXISTS iht_start_datetime_idx
    ON traffic.iran_hourly_traffic (start_datetime);
CREATE INDEX IF NOT EXISTS iht_start_date_idx
    ON traffic.iran_hourly_traffic (start_date);

-- Views (unchanged - daily records view)
CREATE OR REPLACE VIEW traffic.counter_daily_records AS
SELECT
    m.counter_id,
    m.source_id,
    m.name AS counter_name,
    m.route_code,
    m.route_name AS counter_route_name,
    m.latitude,
    m.longitude,
    m.geometry,
    t.traffic_id,
    t.province,
    t.route_name AS traffic_route_name,
    t.start_datetime,
    t.end_datetime,
    t.start_date,
    t.end_date,
    t.duration_minutes,
    t.total_vehicles,
    t.class1_vehicles,
    t.class2_vehicles,
    t.class3_vehicles,
    t.class4_vehicles,
    t.class5_vehicles,
    t.avg_speed,
    t.speed_violations,
    t.distance_violations,
    t.overtake_violations,
    t.source_extra
FROM traffic.manual_match AS m
JOIN traffic.iran_daily_traffic AS t USING (route_code);