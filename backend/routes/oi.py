from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter

from scheduler import option_scheduler
from supabase_client import get_supabase
from zerodha import get_spot_ltp


router = APIRouter(prefix="/oi", tags=["oi"])


def _latest_timestamps() -> tuple[str | None, str | None]:
    response = (
        get_supabase()
        .table("option_snapshots")
        .select("timestamp")
        .eq("underlying", option_scheduler.underlying)
        .order("timestamp", desc=True)
        .limit(500)
        .execute()
    )
    timestamps = []
    seen: set[str] = set()
    for row in response.data or []:
        timestamp = row["timestamp"]
        if timestamp not in seen:
            seen.add(timestamp)
            timestamps.append(timestamp)
        if len(timestamps) == 2:
            break
    latest = timestamps[0] if timestamps else None
    previous = timestamps[1] if len(timestamps) > 1 else None
    return latest, previous


def _group_snapshot(timestamp: str | None) -> dict[float, dict[str, float]]:
    if not timestamp:
        return {}

    response = (
        get_supabase()
        .table("option_snapshots")
        .select("strike_price,option_type,oi,ltp")
        .eq("underlying", option_scheduler.underlying)
        .eq("timestamp", timestamp)
        .order("strike_price")
        .execute()
    )
    grouped: dict[float, dict[str, float]] = defaultdict(
        lambda: {
            "strike_price": 0.0,
            "call_oi": 0.0,
            "put_oi": 0.0,
            "call_ltp": 0.0,
            "put_ltp": 0.0,
        }
    )
    for row in response.data or []:
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
