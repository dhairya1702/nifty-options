from __future__ import annotations

from collections import defaultdict
from math import floor

from fastapi import APIRouter, HTTPException, Query

from local_db import latest_snapshot_timestamps, snapshot_rows
from scheduler import option_scheduler
from zerodha import get_spot_ltp


router = APIRouter(prefix="/oi", tags=["oi"])


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
