from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

from local_db import (
    latest_pcr_row,
    pcr_history,
    pcr_history_filtered,
    pcr_range_history,
    pcr_range_history_filtered,
    snapshot_rows,
    snapshot_timestamps_filtered,
)
from routes.oi import get_atm_strike, get_latest_snapshot_groups, get_reference_strike, get_window_rows
from scheduler import option_scheduler


router = APIRouter(prefix="/pcr", tags=["pcr"])
IST = ZoneInfo("Asia/Kolkata")


@router.get("/current")
def get_current_pcr() -> dict:
    latest = latest_pcr_row(option_scheduler.underlying)
    if not latest:
        raise HTTPException(status_code=404, detail="No PCR data found")
    latest_grouped, _, spot = get_latest_snapshot_groups()
    snapshot_rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    reference_strike = get_reference_strike(snapshot_rows, spot)
    window_rows = get_window_rows(snapshot_rows, reference_strike, strike_window=10)
    window_call_oi = sum(float(row["call_oi"]) for row in window_rows)
    window_put_oi = sum(float(row["put_oi"]) for row in window_rows)
    window_pcr = round(window_put_oi / window_call_oi, 4) if window_call_oi else 0.0
    return {
        **latest,
        "window_pcr": window_pcr,
        "window_call_oi": window_call_oi,
        "window_put_oi": window_put_oi,
        "reference_strike": reference_strike,
        "window_strike_count": len(window_rows),
    }


@router.get("/history")
def get_pcr_history(limit: int = Query(50, ge=1, le=500)) -> list[dict]:
    return pcr_history(option_scheduler.underlying, limit)


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

    if normalized_time_mode == "all":
        return None, None

    if normalized_time_mode == "today":
        start, end = _trading_day_window(datetime.now(IST).date())
        return start.isoformat(), end.isoformat()

    if normalized_time_mode == "previous_day":
        previous_days = _previous_trading_days(2)
        target_day = previous_days[0] if len(previous_days) > 1 else previous_days[-1]
        start, end = _trading_day_window(target_day)
        return start.isoformat(), end.isoformat()

    if normalized_time_mode == "last_2_days":
        trading_days = _previous_trading_days(2)
        start, _ = _trading_day_window(trading_days[0])
        _, end = _trading_day_window(trading_days[-1])
        return start.isoformat(), end.isoformat()

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
        detail="time_mode must be 'all', 'today', 'previous_day', 'last_2_days', 'custom_date', or 'custom_range'",
    )


def _resolve_strike_scope(
    strike_mode: str,
    width_points: int,
    custom_atm: float | None,
    strike_min: float | None,
    strike_max: float | None,
    snapshot_rows_data: list[dict[str, float]],
    spot: float | None,
) -> tuple[float | None, float | None, float | None, float | None]:
    reference_strike = get_reference_strike(snapshot_rows_data, spot)
    atm_strike = get_atm_strike(snapshot_rows_data, spot)

    if strike_mode == "full":
        return None, None, None, atm_strike

    if not snapshot_rows_data:
        raise HTTPException(status_code=404, detail="No option snapshot data found")

    if strike_mode == "atm":
        if atm_strike is None:
            raise HTTPException(status_code=404, detail="Could not determine ATM strike")
        effective_anchor = float(atm_strike)
        return effective_anchor - width_points, effective_anchor + width_points, effective_anchor, atm_strike

    if strike_mode == "custom_atm":
        if custom_atm is None:
            raise HTTPException(status_code=400, detail="custom_atm is required for custom_atm mode")
        effective_anchor = float(custom_atm)
        return effective_anchor - width_points, effective_anchor + width_points, effective_anchor, atm_strike

    if strike_mode == "custom":
        if strike_min is None or strike_max is None:
            raise HTTPException(status_code=400, detail="strike_min and strike_max are required for custom mode")
        return float(min(strike_min, strike_max)), float(max(strike_min, strike_max)), None, atm_strike

    raise HTTPException(status_code=400, detail="strike_mode must be 'full', 'atm', 'custom_atm', or 'custom'")


def _filter_snapshot_rows_to_scope(
    rows: list[dict[str, float]],
    strike_min: float | None,
    strike_max: float | None,
) -> list[dict[str, float]]:
    if strike_min is None or strike_max is None:
        return rows
    return [row for row in rows if strike_min <= float(row["strike_price"]) <= strike_max]


@router.get("/history/range")
def get_pcr_history_range(
    limit: int = Query(50, ge=1, le=500),
    mode: str = Query("atm"),
    width_points: int = Query(500, ge=50, le=5000),
    custom_atm: float | None = Query(default=None),
    strike_min: float | None = Query(default=None),
    strike_max: float | None = Query(default=None),
) -> dict:
    normalized_mode = mode.lower()
    latest_grouped, _, spot = get_latest_snapshot_groups()
    snapshot_rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])

    if not snapshot_rows:
        raise HTTPException(status_code=404, detail="No option snapshot data found")

    reference_strike = get_reference_strike(snapshot_rows, spot)
    atm_strike = get_atm_strike(snapshot_rows, spot)

    if normalized_mode == "atm":
        if atm_strike is None:
            raise HTTPException(status_code=404, detail="Could not determine ATM strike")
        effective_min = float(atm_strike - width_points)
        effective_max = float(atm_strike + width_points)
        effective_anchor = float(atm_strike)
    elif normalized_mode == "custom_atm":
        if custom_atm is None:
            raise HTTPException(status_code=400, detail="custom_atm is required for custom_atm mode")
        effective_anchor = float(custom_atm)
        effective_min = float(effective_anchor - width_points)
        effective_max = float(effective_anchor + width_points)
    elif normalized_mode == "custom":
        if strike_min is None or strike_max is None:
            raise HTTPException(status_code=400, detail="strike_min and strike_max are required for custom mode")
        effective_min = float(min(strike_min, strike_max))
        effective_max = float(max(strike_min, strike_max))
        effective_anchor = None
    else:
        raise HTTPException(status_code=400, detail="mode must be 'atm', 'custom_atm', or 'custom'")

    points = pcr_range_history(option_scheduler.underlying, limit, effective_min, effective_max)
    return {
        "mode": normalized_mode,
        "underlying": option_scheduler.underlying,
        "reference_strike": reference_strike,
        "atm_strike": atm_strike,
        "custom_atm": effective_anchor,
        "spot_ltp": spot,
        "strike_min": effective_min,
        "strike_max": effective_max,
        "width_points": width_points if normalized_mode in {"atm", "custom_atm"} else None,
        "points": points,
    }


@router.get("/history/scoped")
def get_pcr_history_scoped(
    limit: int = Query(64, ge=1, le=500),
    strike_mode: str = Query("full"),
    width_points: int = Query(500, ge=50, le=5000),
    custom_atm: float | None = Query(default=None),
    strike_min: float | None = Query(default=None),
    strike_max: float | None = Query(default=None),
    time_mode: str = Query("all"),
    custom_date: str | None = Query(default=None),
    from_timestamp: str | None = Query(default=None),
    to_timestamp: str | None = Query(default=None),
) -> dict:
    normalized_strike_mode = strike_mode.lower()
    normalized_time_mode = time_mode.lower()

    latest_grouped, _, spot = get_latest_snapshot_groups()
    snapshot_rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    reference_strike = get_reference_strike(snapshot_rows, spot)
    _, _, _, atm_strike = _resolve_strike_scope(
        normalized_strike_mode,
        width_points,
        custom_atm,
        strike_min,
        strike_max,
        snapshot_rows,
        spot,
    )
    effective_from, effective_to = _resolve_time_window(normalized_time_mode, custom_date, from_timestamp, to_timestamp)

    if normalized_strike_mode == "full":
        points = pcr_history_filtered(
            option_scheduler.underlying,
            limit=limit,
            from_timestamp=effective_from,
            to_timestamp=effective_to,
        )
        return {
            "strike_mode": normalized_strike_mode,
            "time_mode": normalized_time_mode,
            "underlying": option_scheduler.underlying,
            "reference_strike": reference_strike,
            "atm_strike": atm_strike,
            "custom_atm": None,
            "spot_ltp": spot,
            "strike_min": None,
            "strike_max": None,
            "width_points": None,
            "from_timestamp": effective_from,
            "to_timestamp": effective_to,
            "points": points,
        }

    if not snapshot_rows:
        raise HTTPException(status_code=404, detail="No option snapshot data found")

    effective_min, effective_max, effective_anchor, _ = _resolve_strike_scope(
        normalized_strike_mode,
        width_points,
        custom_atm,
        strike_min,
        strike_max,
        snapshot_rows,
        spot,
    )

    points = pcr_range_history_filtered(
        option_scheduler.underlying,
        effective_min,
        effective_max,
        limit=limit,
        from_timestamp=effective_from,
        to_timestamp=effective_to,
    )
    return {
        "strike_mode": normalized_strike_mode,
        "time_mode": normalized_time_mode,
        "underlying": option_scheduler.underlying,
        "reference_strike": reference_strike,
        "atm_strike": atm_strike,
        "custom_atm": effective_anchor,
        "spot_ltp": spot,
        "strike_min": effective_min,
        "strike_max": effective_max,
        "width_points": width_points if normalized_strike_mode in {"atm", "custom_atm"} else None,
        "from_timestamp": effective_from,
        "to_timestamp": effective_to,
        "points": points,
    }


@router.get("/subgroups/scoped")
def get_pcr_subgroups_scoped(
    strike_mode: str = Query("full"),
    width_points: int = Query(500, ge=50, le=5000),
    custom_atm: float | None = Query(default=None),
    strike_min: float | None = Query(default=None),
    strike_max: float | None = Query(default=None),
    time_mode: str = Query("all"),
    custom_date: str | None = Query(default=None),
    from_timestamp: str | None = Query(default=None),
    to_timestamp: str | None = Query(default=None),
    bucket_size: int = Query(200, ge=50, le=5000),
) -> dict:
    normalized_strike_mode = strike_mode.lower()
    normalized_time_mode = time_mode.lower()
    effective_from, effective_to = _resolve_time_window(normalized_time_mode, custom_date, from_timestamp, to_timestamp)

    latest_grouped, _, spot = get_latest_snapshot_groups()
    latest_rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    reference_strike = get_reference_strike(latest_rows, spot)
    effective_min, effective_max, effective_anchor, atm_strike = _resolve_strike_scope(
        normalized_strike_mode,
        width_points,
        custom_atm,
        strike_min,
        strike_max,
        latest_rows,
        spot,
    )

    timestamps = snapshot_timestamps_filtered(
        option_scheduler.underlying,
        from_timestamp=effective_from,
        to_timestamp=effective_to,
    )
    if not timestamps:
        raise HTTPException(status_code=404, detail="No option snapshot data found for the selected time window")

    baseline_timestamp = timestamps[0]
    latest_timestamp = timestamps[-1]
    baseline_rows = _filter_snapshot_rows_to_scope(snapshot_rows(option_scheduler.underlying, baseline_timestamp), effective_min, effective_max)
    current_rows = _filter_snapshot_rows_to_scope(snapshot_rows(option_scheduler.underlying, latest_timestamp), effective_min, effective_max)
    all_rows = baseline_rows + current_rows
    if not all_rows:
        raise HTTPException(status_code=404, detail="No option snapshot data found for the selected strike scope")

    bucket_start = effective_min if effective_min is not None else min(float(row["strike_price"]) for row in all_rows)

    def bucket_key(strike_price: float) -> int:
        return int((strike_price - bucket_start) // bucket_size)

    grouped: dict[int, dict[str, float | str]] = {}

    for row in baseline_rows:
        key = bucket_key(float(row["strike_price"]))
        range_start = bucket_start + key * bucket_size
        range_end = min(range_start + bucket_size, (effective_max if effective_max is not None else range_start + bucket_size))
        bucket = grouped.setdefault(
            key,
            {
                "range_start": range_start,
                "range_end": range_end,
                "range": f"{int(range_start)}-{int(range_end)}",
                "baseline_call_oi": 0.0,
                "baseline_put_oi": 0.0,
                "current_call_oi": 0.0,
                "current_put_oi": 0.0,
            },
        )
        if row["option_type"] == "CE":
            bucket["baseline_call_oi"] = float(bucket["baseline_call_oi"]) + float(row["oi"] or 0.0)
        else:
            bucket["baseline_put_oi"] = float(bucket["baseline_put_oi"]) + float(row["oi"] or 0.0)

    for row in current_rows:
        key = bucket_key(float(row["strike_price"]))
        range_start = bucket_start + key * bucket_size
        range_end = min(range_start + bucket_size, (effective_max if effective_max is not None else range_start + bucket_size))
        bucket = grouped.setdefault(
            key,
            {
                "range_start": range_start,
                "range_end": range_end,
                "range": f"{int(range_start)}-{int(range_end)}",
                "baseline_call_oi": 0.0,
                "baseline_put_oi": 0.0,
                "current_call_oi": 0.0,
                "current_put_oi": 0.0,
            },
        )
        if row["option_type"] == "CE":
            bucket["current_call_oi"] = float(bucket["current_call_oi"]) + float(row["oi"] or 0.0)
        else:
            bucket["current_put_oi"] = float(bucket["current_put_oi"]) + float(row["oi"] or 0.0)

    subgroup_rows = []
    for key in sorted(grouped.keys()):
        bucket = grouped[key]
        baseline_call_oi = float(bucket["baseline_call_oi"])
        baseline_put_oi = float(bucket["baseline_put_oi"])
        current_call_oi = float(bucket["current_call_oi"])
        current_put_oi = float(bucket["current_put_oi"])
        delta_call_oi = round(current_call_oi - baseline_call_oi, 2)
        delta_put_oi = round(current_put_oi - baseline_put_oi, 2)
        adjusted_call = 1.0 if delta_call_oi <= 0 else delta_call_oi
        adjusted_put = 1.0 if delta_put_oi < 0 else delta_put_oi
        subgroup_rows.append(
            {
                "range": str(bucket["range"]),
                "baseline_call_oi": baseline_call_oi,
                "baseline_put_oi": baseline_put_oi,
                "current_call_oi": current_call_oi,
                "current_put_oi": current_put_oi,
                "delta_call_oi": delta_call_oi,
                "delta_put_oi": delta_put_oi,
                "adjusted_call_oi": adjusted_call,
                "adjusted_put_oi": adjusted_put,
                "baseline_pcr": round(baseline_put_oi / baseline_call_oi, 4) if baseline_call_oi else 0.0,
                "current_pcr": round(current_put_oi / current_call_oi, 4) if current_call_oi else 0.0,
                "delta_pcr": round(abs(adjusted_put / adjusted_call), 4),
            }
        )

    return {
        "underlying": option_scheduler.underlying,
        "strike_mode": normalized_strike_mode,
        "time_mode": normalized_time_mode,
        "reference_strike": reference_strike,
        "atm_strike": atm_strike,
        "custom_atm": effective_anchor,
        "spot_ltp": spot,
        "strike_min": effective_min,
        "strike_max": effective_max,
        "bucket_size": bucket_size,
        "baseline_timestamp": baseline_timestamp,
        "latest_timestamp": latest_timestamp,
        "rows": subgroup_rows,
    }
