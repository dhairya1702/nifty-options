from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from scheduler import option_scheduler
from supabase_client import get_supabase
from zerodha import get_option_chain


def seed() -> None:
    supabase = get_supabase()
    base_chain = get_option_chain(option_scheduler.underlying)
    if _needs_synthetic_seed(base_chain):
        print("Live option quotes are zero. Generating a synthetic baseline for seed data.")
        base_chain = _generate_synthetic_chain(base_chain)
    print("Fetched live option chain from Zerodha")

    for index in range(10, 0, -1):
        timestamp = datetime.now(timezone.utc) - timedelta(minutes=index * 15)
        snapshot_rows = []
        total_call_oi = 0.0
        total_put_oi = 0.0

        for row in base_chain:
            factor = random.uniform(0.95, 1.05)
            oi = round(float(row["oi"]) * factor, 2)
            snapshot_rows.append(
                {
                    "timestamp": timestamp.isoformat(),
                    "underlying": option_scheduler.underlying,
                    "expiry": row.get("expiry"),
                    "tradingsymbol": row.get("tradingsymbol"),
                    "instrument_token": row.get("instrument_token"),
                    "strike_price": row["strike_price"],
                    "option_type": row["option_type"],
                    "oi": oi,
                    "ltp": row["ltp"],
                }
            )
            if row["option_type"] == "CE":
                total_call_oi += oi
            else:
                total_put_oi += oi

        pcr = round(total_put_oi / total_call_oi, 4) if total_call_oi else 0.0
        expiry = next((row.get("expiry") for row in base_chain if row.get("expiry")), None)
        supabase.table("option_snapshots").upsert(
            snapshot_rows,
            on_conflict="underlying,timestamp,expiry,strike_price,option_type",
        ).execute()
        supabase.table("pcr_timeseries").upsert(
            {
                "timestamp": timestamp.isoformat(),
                "underlying": option_scheduler.underlying,
                "expiry": expiry,
                "total_call_oi": total_call_oi,
                "total_put_oi": total_put_oi,
                "pcr": pcr,
            },
            on_conflict="underlying,timestamp",
        ).execute()
        print(f"Inserted snapshot for {timestamp.isoformat()} with PCR {pcr}")

    print("Historical seed completed")


def _needs_synthetic_seed(option_chain: list[dict]) -> bool:
    if not option_chain:
        return False

    total_oi = sum(float(row["oi"]) for row in option_chain)
    non_zero_ltp = sum(1 for row in option_chain if float(row["ltp"]) > 0.0)
    return total_oi == 0.0 or non_zero_ltp == 0


def _generate_synthetic_chain(option_chain: list[dict]) -> list[dict]:
    strikes = sorted({float(row["strike_price"]) for row in option_chain})
    if not strikes:
        return option_chain

    center = strikes[len(strikes) // 2]
    synthetic_chain = []
    for row in option_chain:
        strike = float(row["strike_price"])
        option_type = str(row["option_type"])
        distance = abs(strike - center)
        distance_steps = max(distance / 50.0, 1.0)

        if option_type == "CE":
            oi = max(25000.0, 240000.0 / distance_steps)
            intrinsic_bias = max(0.0, center - strike)
        else:
            oi = max(25000.0, 240000.0 / distance_steps)
            intrinsic_bias = max(0.0, strike - center)

        time_value = max(8.0, 220.0 - (distance_steps * 7.5))
        ltp = max(5.0, intrinsic_bias * 0.45 + time_value)

        synthetic_chain.append(
            {
                "underlying": row.get("underlying", option_scheduler.underlying),
                "strike_price": strike,
                "option_type": option_type,
                "expiry": row.get("expiry"),
                "tradingsymbol": row.get("tradingsymbol"),
                "instrument_token": row.get("instrument_token"),
                "oi": round(oi, 2),
                "ltp": round(ltp, 2),
            }
        )

    return synthetic_chain


if __name__ == "__main__":
    seed()
