from __future__ import annotations

from fastapi import APIRouter

from routes.oi import get_latest_snapshot_groups, get_reference_strike, get_window_rows
from scheduler import option_scheduler
from supabase_client import supabase_execute


router = APIRouter(tags=["sentiment"])


@router.get("/sentiment")
def get_sentiment() -> dict:
    response = supabase_execute(
        "fetch sentiment PCR rows",
        lambda supabase: supabase.table("pcr_timeseries")
        .select("timestamp,pcr")
        .eq("underlying", option_scheduler.underlying)
        .order("timestamp", desc=True)
        .limit(3)
        .execute(),
    )
    rows = list(reversed(response.data or []))
    values = [float(row["pcr"]) for row in rows]
    latest = values[-1] if values else 0.0
    latest_grouped, previous_grouped, spot = get_latest_snapshot_groups()
    snapshot_rows = sorted(latest_grouped.values(), key=lambda row: row["strike_price"])
    reference_strike = get_reference_strike(snapshot_rows, spot)
    window_rows = get_window_rows(snapshot_rows, reference_strike, strike_window=10)
    previous_window_rows = get_window_rows(list(previous_grouped.values()), reference_strike, strike_window=10)
    latest_call_oi = sum(float(row["call_oi"]) for row in window_rows)
    latest_put_oi = sum(float(row["put_oi"]) for row in window_rows)
    previous_call_oi = sum(float(row["call_oi"]) for row in previous_window_rows)
    previous_put_oi = sum(float(row["put_oi"]) for row in previous_window_rows)
    latest_window_pcr = round(latest_put_oi / latest_call_oi, 4) if latest_call_oi else 0.0
    pcr_change = latest_window_pcr - (
        round(previous_put_oi / previous_call_oi, 4) if previous_call_oi else latest_window_pcr
    )
    put_dominance = latest_put_oi - latest_call_oi

    sentiment = "Neutral"
    trend = "mixed"
    confidence = "Low"
    if len(values) >= 3 and values[0] < values[1] < values[2]:
        sentiment = "Bullish"
        trend = "increasing"
    elif len(values) >= 3 and values[0] > values[1] > values[2]:
        sentiment = "Bearish"
        trend = "decreasing"

    if abs(pcr_change) >= 0.03 and abs(put_dominance) >= 500000:
        confidence = "High"
    elif abs(pcr_change) >= 0.01 and abs(put_dominance) >= 150000:
        confidence = "Medium"

    if confidence == "Low":
        sentiment = "Neutral"

    return {
        "sentiment": sentiment,
        "pcr_trend": trend,
        "latest_pcr": latest,
        "window_pcr": latest_window_pcr,
        "confidence": confidence,
        "reference_strike": reference_strike,
    }
