from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from math import floor
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

from local_db import latest_snapshot_timestamps, snapshot_rows
from scheduler import option_scheduler
from zerodha import get_spot_ltp


router = APIRouter(prefix="/oi", tags=["oi"])
IST = ZoneInfo("Asia/Kolkata")


def _latest_timestamps() -> tuple[str | None, str | None]:
    timestamps = latest_snapshot_timestamps(option_scheduler.underlying, limit=2)
    latest = timestamps[0] if timestamps else None
    previous = timestamps[1] if len(timestamps) > 1 else None
    return latest, previous


def _group_snapshot(timestamp: str | None) -> dict[float, dict[str, float]]:
    if not timestamp:
        return {}

    grouped: dict[float, dict[str, float]] = defaultdict(
        lambda: {
            "strike_price": 0.0,
            "call_oi": 0.0,
            "put_oi": 0.0,
            "call_ltp": 0.0,
            "put_ltp": 0.0,
        }
    )
    for row in snapshot_rows(option_scheduler.underlying, timestamp):
        strike = float(row["strike_price"])
        item = grouped[strike]
        item["strike_price"] = strike
        if row["option_type"] == "CE":
            item["call_oi"] = float(row["oi"] or 0.0)
            item["call_ltp"] = float(row["ltp"] or 0.0)
        else:
            item["put_oi"] = float(row["oi"] or 0.0)
            item["put_ltp"] = float(row["ltp"] or 0.0)
    return grouped


def get_latest_snapshot_groups() -> tuple[dict[float, dict[str, float]], dict[float, dict[str, float]], float | None]:
    latest, previous = _latest_timestamps()
    latest_grouped = _group_snapshot(latest)
    previous_grouped = _group_snapshot(previous)
    spot = get_spot_ltp(option_scheduler.underlying)
    return latest_grouped, previous_grouped, spot


def get_reference_strike(rows: list[dict[str, float]], spot: float | None) -> float | None:
    if not rows:
        return None
    if spot is not None:
        return min(rows, key=lambda row: abs(row["strike_price"] - spot))["strike_price"]
    return max(rows, key=lambda row: row["call_oi"] + row["put_oi"])["strike_price"]


def get_window_rows(rows: list[dict[str, float]], reference_strike: float | None, strike_window: int = 10) -> list[dict[str, float]]:
    if reference_strike is None:
        return rows
    return [row for row in rows if abs(row["strike_price"] - reference_strike) <= strike_window * 50]


def get_strike_step(rows: list[dict[str, float]]) -> float:
    strikes = sorted({float(row["strike_price"]) for row in rows})
    differences = [current - previous for previous, current in zip(strikes, strikes[1:]) if current > previous]
    return min(differences) if differences else 50.0


def get_atm_strike(rows: list[dict[str, float]], spot: float | None) -> float | None:
    if not rows:
        return None
    if spot is None:
        return get_reference_strike(rows, spot)

    strike_step = get_strike_step(rows)
    if strike_step <= 0:
        strike_step = 50.0
    rounded_spot = round(spot / strike_step) * strike_step
    return min(rows, key=lambda row: abs(row["strike_price"] - rounded_spot))["strike_price"]


def build_grouped_oi_rows(
    rows: list[dict[str, float]],
    spot: float | None,
    bucket_size: int,
) -> list[dict[str, float | str]]:
    if bucket_size <= 0:
        raise ValueError("bucket_size must be positive")
    if not rows:
        return []

    atm = get_atm_strike(rows, spot)
    if atm is None:
        return []

    grouped: dict[int, dict[str, float | str]] = {}
    for row in rows:
        strike_price = float(row["strike_price"])
        bucket_id = floor((strike_price - atm) / bucket_size)
        range_start = atm + bucket_id * bucket_size
        range_end = range_start + bucket_size
        bucket = grouped.setdefault(
            bucket_id,
            {
                "range_start": range_start,
                "range_end": range_end,
                "range": f"{int(range_start)}-{int(range_end)}",
                "call_oi": 0.0,
                "put_oi": 0.0,
            },
        )
        bucket["call_oi"] = float(bucket["call_oi"]) + float(row["call_oi"])
        bucket["put_oi"] = float(bucket["put_oi"]) + float(row["put_oi"])

    grouped_rows = []
    for bucket_id in sorted(grouped.keys()):
        bucket = grouped[bucket_id]
        call_oi = float(bucket["call_oi"])
        put_oi = float(bucket["put_oi"])
        grouped_rows.append(
            {
                "range": str(bucket["range"]),
                "call_oi": round(call_oi, 2),
                "put_oi": round(put_oi, 2),
                "pcr": round(put_oi / call_oi, 4) if call_oi else 0.0,
            }
        )

    return grouped_rows


def _parse_input_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=IST)
    return parsed.astimezone(IST)


def _trading_day_window(trading_day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(trading_day, time.min, tzinfo=IST)
    end = datetime.combine(trading_day, time.max, tzinfo=IST)
    return start, end


def _previous_trading_days(count: int) -> list[date]:
    days: list[date] = []
    current = datetime.now(IST).date()
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current -= timedelta(days=1)
    return list(reversed(days))


def _resolve_time_window(
    time_mode: str,
    custom_date: str | None,
    from_timestamp: str | None,
    to_timestamp: str | None,
) -> tuple[str | None, str | None]:
    normalized_time_mode = time_mode.lower()
    now = datetime.now(IST)

    if normalized_time_mode == "today":
        start, end = _trading_day_window(now.date())
        return start.isoformat(), end.isoformat()

    if normalized_time_mode == "previous_day":
        previous_days = _previous_trading_days(2)
        target_day = previous_days[0] if len(previous_days) > 1 else previous_days[-1]
        start, end = _trading_day_window(target_day)
        return start.isoformat(), end.isoformat()

    if normalized_time_mode == "last_30_minutes":
        return (now - timedelta(minutes=30)).isoformat(), now.isoformat()

    if normalized_time_mode == "last_1_hour":
        return (now - timedelta(hours=1)).isoformat(), now.isoformat()

    if normalized_time_mode == "last_2_hours":
        return (now - timedelta(hours=2)).isoformat(), now.isoformat()

    if normalized_time_mode == "custom_date":
        if not custom_date:
            raise HTTPException(status_code=400, detail="custom_date is required for custom_date mode")
        target_day = date.fromisoformat(custom_date)
        start, end = _trading_day_window(target_day)
        return start.isoformat(), end.isoformat()

    if normalized_time_mode == "custom_range":
        if not from_timestamp or not to_timestamp:
            raise HTTPException(status_code=400, detail="from_timestamp and to_timestamp are required for custom_range mode")
        start = _parse_input_timestamp(from_timestamp)
        end = _parse_input_timestamp(to_timestamp)
        if start > end:
            start, end = end, start
        return start.isoformat(), end.isoformat()

    raise HTTPException(
        status_code=400,
        detail="time_mode must be 'today', 'previous_day', 'last_30_minutes', 'last_1_hour', 'last_2_hours', 'custom_date', or 'custom_range'",
    )


def _resolve_strike_scope(
    strike_mode: str,
    width_points: int,
    custom_atm: float | None,
    strike_min: float | None,
    strike_max: float | None,
    rows: list[dict[str, float]],
    spot: float | None,
) -> tuple[float | None, float | None, float | None, float | None]:
    reference_strike = get_reference_strike(rows, spot)
    atm_strike = get_atm_strike(rows, spot)

    if not rows:
        raise HTTPException(status_code=404, detail="No option snapshot data found")

    if strike_mode == "atm":
        if atm_strike is None:
            raise HTTPException(status_code=404, detail="Could not determine ATM strike")
        anchor = float(atm_strike)
        return anchor - width_points, anchor + width_points, anchor, atm_strike

    if strike_mode == "custom_atm":
        if custom_atm is None:
            raise HTTPException(status_code=400, detail="custom_atm is required for custom_atm mode")
        anchor = float(custom_atm)
        return anchor - width_points, anchor + width_points, anchor, atm_strike

    if strike_mode == "custom":
        if strike_min is None or strike_max is None:
            raise HTTPException(status_code=400, detail="strike_min and strike_max are required for custom mode")
        return float(min(strike_min, strike_max)), float(max(strike_min, strike_max)), reference_strike, atm_strike

    raise HTTPException(status_code=400, detail="strike_mode must be 'atm', 'custom_atm', or 'custom'")


def _group_snapshot_rows(rows: list[dict[str, float]]) -> dict[float, dict[str, float]]:
    grouped: dict[float, dict[str, float]] = defaultdict(
        lambda: {
            "strike_price": 0.0,
            "call_oi": 0.0,
            "put_oi": 0.0,
        }
    )

    for row in rows:
        strike = float(row["strike_price"])
        item = grouped[strike]
        item["strike_price"] = strike
        if row["option_type"] == "CE":
            item["call_oi"] = float(row["oi"] or 0.0)
        else:
            item["put_oi"] = float(row["oi"] or 0.0)

    return grouped


@router.get("/strikes")
def get_oi_strikes() -> dict:
    latest_grouped, _, spot = get_latest_snapshot_groups()
    rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    return {"spot_ltp": spot, "rows": rows}


@router.get("/change")
def get_oi_change() -> dict:
    latest_grouped, previous_grouped, spot = get_latest_snapshot_groups()

    rows = []
    for strike in sorted(latest_grouped.keys()):
        current = latest_grouped[strike]
        prev = previous_grouped.get(strike, {})
        rows.append(
            {
                "strike_price": strike,
                "call_oi": current["call_oi"],
                "put_oi": current["put_oi"],
                "delta_call_oi": current["call_oi"] - float(prev.get("call_oi", 0.0)),
                "delta_put_oi": current["put_oi"] - float(prev.get("put_oi", 0.0)),
            }
        )
    return {"spot_ltp": spot, "rows": rows}


@router.get("/grouped")
def get_oi_grouped(bucket_size: int = Query(150, ge=1, le=5000)) -> list[dict[str, float | str]]:
    latest_grouped, _, spot = get_latest_snapshot_groups()
    rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    if not rows:
        raise HTTPException(status_code=404, detail="No option snapshot data found")

    try:
        return build_grouped_oi_rows(rows, spot, bucket_size)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/intraday-change")
def get_intraday_oi_change(
    time_mode: str = Query("today"),
    strike_mode: str = Query("atm"),
    width_points: int = Query(500, ge=50, le=5000),
    custom_atm: float | None = Query(default=None),
    strike_min: float | None = Query(default=None),
    strike_max: float | None = Query(default=None),
    custom_date: str | None = Query(default=None),
    from_timestamp: str | None = Query(default=None),
    to_timestamp: str | None = Query(default=None),
) -> dict:
    from_ts, to_ts = _resolve_time_window(time_mode, custom_date, from_timestamp, to_timestamp)
    timestamps = latest_snapshot_timestamps(option_scheduler.underlying, limit=1)
    if not timestamps:
        raise HTTPException(status_code=404, detail="No option snapshot data found")

    from local_db import snapshot_timestamps_filtered

    filtered_timestamps = snapshot_timestamps_filtered(option_scheduler.underlying, from_timestamp=from_ts, to_timestamp=to_ts)
    if len(filtered_timestamps) < 2:
        raise HTTPException(status_code=404, detail="Not enough snapshot data found for the selected time range")

    baseline_timestamp = filtered_timestamps[0]
    latest_timestamp = filtered_timestamps[-1]
    baseline_grouped = _group_snapshot_rows(snapshot_rows(option_scheduler.underlying, baseline_timestamp))
    latest_grouped = _group_snapshot_rows(snapshot_rows(option_scheduler.underlying, latest_timestamp))
    latest_rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    spot = get_spot_ltp(option_scheduler.underlying)

    effective_min, effective_max, reference_strike, atm_strike = _resolve_strike_scope(
        strike_mode,
        width_points,
        custom_atm,
        strike_min,
        strike_max,
        latest_rows,
        spot,
    )

    rows: list[dict[str, float]] = []
    for strike in sorted(latest_grouped.keys()):
        if effective_min is not None and strike < effective_min:
            continue
        if effective_max is not None and strike > effective_max:
            continue

        current = latest_grouped[strike]
        baseline = baseline_grouped.get(strike, {})
        rows.append(
            {
                "strike_price": strike,
                "baseline_call_oi": round(float(baseline.get("call_oi", 0.0)), 2),
                "baseline_put_oi": round(float(baseline.get("put_oi", 0.0)), 2),
                "current_call_oi": round(float(current["call_oi"]), 2),
                "current_put_oi": round(float(current["put_oi"]), 2),
                "delta_call_oi": round(float(current["call_oi"]) - float(baseline.get("call_oi", 0.0)), 2),
                "delta_put_oi": round(float(current["put_oi"]) - float(baseline.get("put_oi", 0.0)), 2),
            }
        )

    return {
        "underlying": option_scheduler.underlying,
        "time_mode": time_mode,
        "strike_mode": strike_mode,
        "spot_ltp": spot,
        "reference_strike": reference_strike,
        "atm_strike": atm_strike,
        "custom_atm": custom_atm,
        "strike_min": effective_min,
        "strike_max": effective_max,
        "baseline_timestamp": baseline_timestamp,
        "latest_timestamp": latest_timestamp,
        "rows": rows,
    }
