from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from scheduler import option_scheduler
from supabase_client import supabase_execute
from zerodha import get_historical_option_instruments, get_kite_client


IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")
DEFAULT_LOOKBACK_DAYS = 5


def _chunked(items: list[dict], size: int = 500):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def get_latest_stored_timestamp(underlying: str) -> str | None:
    pcr_response = supabase_execute(
        "fetch latest stored PCR timestamp",
        lambda supabase: supabase.table("pcr_timeseries")
        .select("timestamp")
        .eq("underlying", underlying)
        .order("timestamp", desc=True)
        .limit(1)
        .execute(),
    )
    snapshot_response = supabase_execute(
        "fetch latest stored option snapshot timestamp",
        lambda supabase: supabase.table("option_snapshots")
        .select("timestamp")
        .eq("underlying", underlying)
        .order("timestamp", desc=True)
        .limit(1)
        .execute(),
    )
    candidates = [
        str(row["timestamp"])
        for row in [
            *((pcr_response.data or [])[:1]),
            *((snapshot_response.data or [])[:1]),
        ]
        if row.get("timestamp")
    ]
    if not candidates:
        return None
    return max(candidates, key=_parse_timestamp)


def _build_history_rows(underlying: str, from_dt: datetime, to_dt: datetime) -> tuple[list[dict], list[dict]]:
    kite = get_kite_client()

    grouped_snapshots: dict[str, list[dict]] = defaultdict(list)
    for active_expiry, segment_from, segment_to, instruments in get_historical_option_instruments(underlying, from_dt, to_dt):
        for instrument in instruments:
            candles = kite.historical_data(
                instrument["instrument_token"],
                segment_from,
                segment_to,
                "15minute",
                oi=True,
            )
            for candle in candles:
                timestamp = candle["date"].astimezone(IST).replace(second=0, microsecond=0).isoformat()
                grouped_snapshots[timestamp].append(
                    {
                        "timestamp": timestamp,
                        "underlying": underlying,
                        "expiry": active_expiry.isoformat(),
                        "tradingsymbol": str(instrument["tradingsymbol"]),
                        "instrument_token": int(instrument["instrument_token"]),
                        "strike_price": float(instrument["strike"]),
                        "option_type": str(instrument["instrument_type"]),
                        "oi": float(candle.get("oi") or 0.0),
                        "ltp": float(candle.get("close") or 0.0),
                    }
                )

    snapshot_rows: list[dict] = []
    pcr_rows: list[dict] = []
    for timestamp in sorted(grouped_snapshots.keys()):
        rows = grouped_snapshots[timestamp]
        snapshot_rows.extend(rows)
        total_call_oi = sum(row["oi"] for row in rows if row["option_type"] == "CE")
        total_put_oi = sum(row["oi"] for row in rows if row["option_type"] == "PE")
        pcr = round(total_put_oi / total_call_oi, 4) if total_call_oi else 0.0
        pcr_rows.append(
            {
                "timestamp": timestamp,
                "underlying": underlying,
                "expiry": rows[0]["expiry"] if rows else None,
                "total_call_oi": total_call_oi,
                "total_put_oi": total_put_oi,
                "pcr": pcr,
            }
        )

    return snapshot_rows, pcr_rows


def _filter_new_rows(rows: list[dict], latest_timestamp: str | None) -> list[dict]:
    if latest_timestamp is None:
        return rows
    latest_dt = _parse_timestamp(latest_timestamp)
    return [row for row in rows if _parse_timestamp(str(row["timestamp"])) > latest_dt]


def _insert_rows(snapshot_rows: list[dict], pcr_rows: list[dict]) -> None:
    if not snapshot_rows and not pcr_rows:
        return

    for chunk in _chunked(snapshot_rows):
        supabase_execute(
            "insert historical option snapshot chunk",
            lambda supabase, chunk=chunk: supabase.table("option_snapshots").upsert(
                chunk,
                on_conflict="underlying,timestamp,expiry,strike_price,option_type",
            ).execute(),
        )
    for chunk in _chunked(pcr_rows):
        supabase_execute(
            "insert historical PCR chunk",
            lambda supabase, chunk=chunk: supabase.table("pcr_timeseries").upsert(
                chunk,
                on_conflict="underlying,timestamp",
            ).execute(),
        )


def backfill_real_history(lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> dict:
    underlying = option_scheduler.underlying
    now_ist = datetime.now(IST)
    from_dt = now_ist - timedelta(days=lookback_days)
    to_dt = now_ist

    snapshot_rows, pcr_rows = _build_history_rows(underlying, from_dt, to_dt)
    supabase_execute(
        "delete historical option snapshots",
        lambda supabase: supabase.table("option_snapshots").delete().eq("underlying", underlying).execute(),
    )
    supabase_execute(
        "delete historical PCR rows",
        lambda supabase: supabase.table("pcr_timeseries").delete().eq("underlying", underlying).execute(),
    )
    _insert_rows(snapshot_rows, pcr_rows)

    return {
        "underlying": underlying,
        "lookback_days": lookback_days,
        "snapshots_inserted": len(snapshot_rows),
        "pcr_points_inserted": len(pcr_rows),
    }


def catch_up_missing_history(lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> dict:
    underlying = option_scheduler.underlying
    latest_timestamp = get_latest_stored_timestamp(underlying)
    now_ist = datetime.now(IST)
    history_start = now_ist - timedelta(days=lookback_days)
    if latest_timestamp:
        from_dt = max(_parse_timestamp(latest_timestamp).astimezone(IST), history_start)
    else:
        from_dt = history_start

    snapshot_rows, pcr_rows = _build_history_rows(underlying, from_dt, now_ist)
    new_snapshot_rows = _filter_new_rows(snapshot_rows, latest_timestamp)
    new_pcr_rows = _filter_new_rows(pcr_rows, latest_timestamp)
    _insert_rows(new_snapshot_rows, new_pcr_rows)

    return {
        "underlying": underlying,
        "lookback_days": lookback_days,
        "from_timestamp": latest_timestamp,
        "to_timestamp": now_ist.astimezone(UTC).isoformat(),
        "snapshots_inserted": len(new_snapshot_rows),
        "pcr_points_inserted": len(new_pcr_rows),
        "catch_up_performed": bool(new_snapshot_rows or new_pcr_rows),
    }
