from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from routes.oi import get_latest_snapshot_groups, get_reference_strike, get_window_rows
from scheduler import option_scheduler
from supabase_client import supabase_execute


router = APIRouter(prefix="/pcr", tags=["pcr"])


@router.get("/current")
def get_current_pcr() -> dict:
    response = supabase_execute(
        "fetch current PCR",
        lambda supabase: supabase.table("pcr_timeseries")
        .select("timestamp,pcr,total_call_oi,total_put_oi")
        .eq("underlying", option_scheduler.underlying)
        .order("timestamp", desc=True)
        .limit(1)
        .execute(),
    )
    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="No PCR data found")
    latest = rows[0]
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
    response = supabase_execute(
        "fetch PCR history",
        lambda supabase: supabase.table("pcr_timeseries")
        .select("timestamp,pcr")
        .eq("underlying", option_scheduler.underlying)
        .order("timestamp", desc=True)
        .limit(limit)
        .execute(),
    )
    rows = list(reversed(response.data or []))
    return rows
