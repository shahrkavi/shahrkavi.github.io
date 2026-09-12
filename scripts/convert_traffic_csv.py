#!/usr/bin/env python3
"""Stream the Jalali traffic CSV into a PostgreSQL-ready CSV.

The source timestamps are local Iranian calendar timestamps without timezone
information. The generated standard columns are Gregorian local timestamps.
"""

import argparse
import csv
import re
from datetime import date, datetime, time
from pathlib import Path


SOURCE_FIELDS = [
    "year", "month", "province", "route_code", "route_name", "start_time",
    "end_time", "duration_minutes", "total_vehicles", "class1_vehicles",
    "class2_vehicles", "class3_vehicles", "class4_vehicles", "class5_vehicles",
    "avg_speed", "speed_violations", "distance_violations", "overtake_violations",
]
OUTPUT_FIELDS = SOURCE_FIELDS + [
    "source_extra", "start_datetime", "end_datetime", "start_date", "end_date",
]


def jalali_to_gregorian(year: int, month: int, day: int) -> date:
    """Convert a Persian/Jalali date using the 33-year calendar cycle."""
    jy, jm, jd = year - 979, month - 1, day - 1
    day_number = 365 * jy + (jy // 33) * 8 + ((jy % 33) + 3) // 4
    day_number += sum(31 if month_index < 6 else 30 for month_index in range(jm)) + jd

    day_number += 79
    gy = 1600 + 400 * (day_number // 146097)
    day_number %= 146097
    leap = True
    if day_number >= 36525:
        day_number -= 1
        gy += 100 * (day_number // 36524)
        day_number %= 36524
        if day_number >= 365:
            day_number += 1
    gy += 4 * (day_number // 1461)
    day_number %= 1461
    if day_number >= 366:
        leap = False
        day_number -= 1
        gy += day_number // 365
        day_number %= 365

    month_lengths = [31, 29 if leap else 28, 31, 30, 31, 30,
                     31, 31, 30, 31, 30, 31]
    gm = 1
    while day_number >= month_lengths[gm - 1]:
        day_number -= month_lengths[gm - 1]
        gm += 1
    return date(gy, gm, day_number + 1)


def convert_timestamp(value: str) -> tuple[datetime, date]:
    match = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2}) (\d{2}):(\d{2}):(\d{2})", value.strip())
    if not match:
        raise ValueError(f"Invalid Jalali timestamp: {value!r}")
    year, month, day, hour, minute, second = map(int, match.groups())
    max_day = 31 if month <= 6 else 30 if month <= 11 else 30
    if not 1 <= month <= 12 or not 1 <= day <= max_day:
        raise ValueError(f"Invalid Jalali date: {value!r}")
    clock = time(hour, minute, second)
    converted_date = jalali_to_gregorian(year, month, day)
    converted = datetime.combine(converted_date, clock)
    return converted, converted_date


def convert(input_path: Path, output_path: Path, limit: int | None = None) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with input_path.open("r", encoding="utf-8-sig", newline="") as source, \
            output_path.open("w", encoding="utf-8", newline="") as target:
        reader = csv.reader(source)
        if next(reader, None) != SOURCE_FIELDS:
            raise ValueError("Unexpected source columns")
        writer = csv.DictWriter(target, fieldnames=OUTPUT_FIELDS, lineterminator="\n")
        writer.writeheader()
        timestamp_pattern = re.compile(r"^\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}$")
        for row_number, values in enumerate(reader, start=2):
            while len(values) > len(SOURCE_FIELDS) and values[-1] == "":
                values.pop()
            timestamp_index = next(
                (index for index in range(4, len(values)) if timestamp_pattern.fullmatch(values[index])),
                None,
            )
            if timestamp_index is None:
                raise ValueError(
                    f"Source CSV row {row_number} has no recognizable start timestamp"
                )
            route_name = ",".join(values[4:timestamp_index])
            suffix = values[timestamp_index:]
            if len(suffix) < len(SOURCE_FIELDS) - 5:
                raise ValueError(f"Source CSV row {row_number} has incomplete traffic fields")
            source_extra = suffix[len(SOURCE_FIELDS) - 5:]
            normalized = values[:4] + [route_name] + suffix[:len(SOURCE_FIELDS) - 5]
            row = dict(zip(SOURCE_FIELDS, normalized))
            row["source_extra"] = source_extra[0] if source_extra else ""
            try:
                start_datetime, start_date = convert_timestamp(row["start_time"])
                end_datetime, end_date = convert_timestamp(row["end_time"])
            except ValueError as error:
                raise ValueError(f"Source CSV row {row_number}: {error}") from error
            row.update({
                "start_datetime": start_datetime.isoformat(sep=" "),
                "end_datetime": end_datetime.isoformat(sep=" "),
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
            })
            writer.writerow(row)
            count += 1
            if limit is not None and count >= limit:
                break
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("iran_daily_traffic.csv"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    count = convert(args.input, args.output, args.limit)
    print(f"Converted {count} rows to {args.output}")


if __name__ == "__main__":
    main()
