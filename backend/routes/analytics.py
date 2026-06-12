from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from math import erf, sqrt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from local_db import pcr_rows_for_analytics
from routes.oi import get_latest_snapshot_groups, get_reference_strike, get_window_rows
from scheduler import option_scheduler
from zerodha import get_nearest_expiry_for_underlying


router = APIRouter(prefix="/analytics", tags=["analytics"])
IST = ZoneInfo("Asia/Kolkata")


def _fetch_pcr_rows(limit: int = 200) -> list[dict]:
    return pcr_rows_for_analytics(option_scheduler.underlying, limit)


def _parse_ist_day(timestamp: str) -> str:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(IST).date().isoformat()


def _latest_by_day(rows: list[dict]) -> dict[str, dict]:
    grouped: dict[str, dict] = {}
    for row in rows:
        grouped[_parse_ist_day(row["timestamp"])] = row
    return grouped


def _build_slab_flow() -> dict:
    latest_grouped, previous_grouped, spot = get_latest_snapshot_groups()
    rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    reference_strike = get_reference_strike(rows, spot)
    window_rows = get_window_rows(rows, reference_strike, strike_window=10)

    call_buildup = []
    put_buildup = []
    for row in window_rows:
        prev = previous_grouped.get(row["strike_price"], {})
        delta_call = row["call_oi"] - float(prev.get("call_oi", 0.0))
        delta_put = row["put_oi"] - float(prev.get("put_oi", 0.0))
        call_buildup.append(
            {
                "strike_price": row["strike_price"],
                "oi": row["call_oi"],
                "delta_oi": delta_call,
                "side": "CE",
            }
        )
        put_buildup.append(
            {
                "strike_price": row["strike_price"],
                "oi": row["put_oi"],
                "delta_oi": delta_put,
                "side": "PE",
            }
        )

    return {
        "reference_strike": reference_strike,
        "call_buildup": sorted(call_buildup, key=lambda row: row["delta_oi"], reverse=True)[:5],
        "put_buildup": sorted(put_buildup, key=lambda row: row["delta_oi"], reverse=True)[:5],
    }


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + erf(value / sqrt(2.0)))


def _estimate_expected_move(snapshot_rows: list[dict[str, float]], reference_strike: float | None) -> float:
    if not snapshot_rows or reference_strike is None:
        return 0.0
    atm_row = min(snapshot_rows, key=lambda row: abs(row["strike_price"] - reference_strike))
    atm_straddle = float(atm_row["call_ltp"]) + float(atm_row["put_ltp"])
    return max(atm_straddle, 1.0)


def _days_to_expiry() -> int | None:
    expiry = get_nearest_expiry_for_underlying(option_scheduler.underlying)
    if expiry is None:
        return None
    today = datetime.now(IST).date()
    return max((expiry - today).days, 1)


def _strike_probability(
    strike: float,
    spot: float,
    expected_move_to_expiry: float,
    days_to_expiry: int | None,
    band: float = 50.0,
) -> dict[str, float]:
    if expected_move_to_expiry <= 0:
        return {"probability_touch": 0.0, "probability_expire_near": 0.0}

    distance = abs(strike - spot)
    sigma = expected_move_to_expiry
    tail_probability = max(0.0, min(1.0, 2.0 * (1.0 - _normal_cdf(distance / sigma))))
    near_probability = max(
        0.0,
        min(
            1.0,
            _normal_cdf((distance + band) / sigma) - _normal_cdf(max(distance - band, 0.0) / sigma),
        ),
    )
    scaled_touch = min(0.995, tail_probability * (1.15 if days_to_expiry and days_to_expiry > 1 else 1.0))
    return {
        "probability_touch": round(scaled_touch, 4),
        "probability_expire_near": round(near_probability, 4),
    }


@router.get("/overview")
def analytics_overview() -> dict:
    rows = _fetch_pcr_rows()
    latest = rows[-1] if rows else None
    previous = rows[-2] if len(rows) > 1 else None
    day_map = _latest_by_day(rows)
    days = sorted(day_map.keys())
    today_row = day_map[days[-1]] if days else None
    yesterday_row = day_map[days[-2]] if len(days) > 1 else None

    latest_grouped, previous_grouped, spot = get_latest_snapshot_groups()
    snapshot_rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    reference_strike = get_reference_strike(snapshot_rows, spot)
    window_rows = get_window_rows(snapshot_rows, reference_strike, strike_window=10)
    previous_window_rows = get_window_rows(list(previous_grouped.values()), reference_strike, strike_window=10)

    window_call_oi = sum(float(row["call_oi"]) for row in window_rows)
    window_put_oi = sum(float(row["put_oi"]) for row in window_rows)
    previous_window_call_oi = sum(float(row["call_oi"]) for row in previous_window_rows)
    previous_window_put_oi = sum(float(row["put_oi"]) for row in previous_window_rows)
    window_pcr = round(window_put_oi / window_call_oi, 4) if window_call_oi else 0.0
    call_change = window_call_oi - previous_window_call_oi
    put_change = window_put_oi - previous_window_put_oi

    if window_pcr >= 1.25 and put_change > 0:
        stretch = "Oversold bounce zone"
    elif window_pcr <= 0.75 and call_change > 0:
        stretch = "Overbought fade zone"
    else:
        stretch = "Balanced"

    if put_change - call_change > 250000:
        directional_bias = "Put writing / bullish support build-up"
    elif call_change - put_change > 250000:
        directional_bias = "Call writing / bearish resistance build-up"
    else:
        directional_bias = "Mixed positioning"

    return {
        "today_pcr": float(today_row["pcr"]) if today_row else None,
        "yesterday_pcr": float(yesterday_row["pcr"]) if yesterday_row else None,
        "latest_pcr": float(latest["pcr"]) if latest else None,
        "window_pcr": window_pcr,
        "pcr_change": round(float(latest["pcr"]) - float(previous["pcr"]), 4) if latest and previous else None,
        "call_oi_change": round(call_change, 2),
        "put_oi_change": round(put_change, 2),
        "reference_strike": reference_strike,
        "spot_ltp": spot,
        "stretch_signal": stretch,
        "directional_bias": directional_bias,
        "underlying": option_scheduler.underlying,
    }


@router.get("/flow")
def analytics_flow(limit: int = Query(32, ge=8, le=200)) -> list[dict]:
    rows = _fetch_pcr_rows(limit=limit)
    flow = []
    prev = None
    for row in rows:
        current = {
            "timestamp": row["timestamp"],
            "pcr": float(row["pcr"]),
            "total_call_oi": float(row["total_call_oi"]),
            "total_put_oi": float(row["total_put_oi"]),
            "delta_call_oi": round(float(row["total_call_oi"]) - float(prev["total_call_oi"]), 2) if prev else 0.0,
            "delta_put_oi": round(float(row["total_put_oi"]) - float(prev["total_put_oi"]), 2) if prev else 0.0,
            "underlying": option_scheduler.underlying,
        }
        flow.append(current)
        prev = row
    return flow


@router.get("/slabs")
def analytics_slabs() -> dict:
    slab_flow = _build_slab_flow()
    return {
        **slab_flow,
        "bullish_target": slab_flow["put_buildup"][0] if slab_flow["put_buildup"] else None,
        "bearish_target": slab_flow["call_buildup"][0] if slab_flow["call_buildup"] else None,
    }


@router.get("/probability")
def analytics_probability() -> dict:
    latest_grouped, _, spot = get_latest_snapshot_groups()
    snapshot_rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    reference_strike = get_reference_strike(snapshot_rows, spot)
    effective_spot = spot or reference_strike
    if effective_spot is None:
        return {
            "underlying": option_scheduler.underlying,
            "reference_strike": None,
            "spot_ltp": None,
            "days_to_expiry": None,
            "expected_move": None,
            "method": "ATM straddle heuristic",
            "estimates": [],
        }

    window_rows = get_window_rows(snapshot_rows, reference_strike, strike_window=8)
    expected_move = _estimate_expected_move(snapshot_rows, reference_strike)
    days_to_expiry = _days_to_expiry()
    estimates = []
    for row in window_rows:
        probabilities = _strike_probability(row["strike_price"], effective_spot, expected_move, days_to_expiry)
        estimates.append(
            {
                "strike_price": row["strike_price"],
                "call_ltp": row["call_ltp"],
                "put_ltp": row["put_ltp"],
                "distance_from_spot": round(abs(row["strike_price"] - effective_spot), 2),
                **probabilities,
            }
        )

    estimates.sort(
        key=lambda row: (
            -row["probability_touch"],
            -row["probability_expire_near"],
            row["distance_from_spot"],
        )
    )

    return {
        "underlying": option_scheduler.underlying,
        "reference_strike": reference_strike,
        "spot_ltp": effective_spot,
        "days_to_expiry": days_to_expiry,
        "expected_move": round(expected_move, 2),
        "method": "ATM straddle heuristic",
        "estimates": estimates[:8],
    }
