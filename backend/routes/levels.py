from __future__ import annotations

from fastapi import APIRouter

from routes.oi import get_latest_snapshot_groups, get_reference_strike


router = APIRouter(tags=["levels"])


@router.get("/levels")
def get_levels() -> dict:
    latest_grouped, previous_grouped, spot = get_latest_snapshot_groups()
    rows = list(latest_grouped.values())
    reference_strike = get_reference_strike(rows, spot)

    def score_resistance(row: dict[str, float]) -> float:
        prev = previous_grouped.get(row["strike_price"], {})
        call_change = row["call_oi"] - float(prev.get("call_oi", 0.0))
        distance_penalty = abs(row["strike_price"] - reference_strike) / 50 if reference_strike is not None else 0.0
        return row["call_oi"] + max(call_change, 0.0) * 0.6 - distance_penalty * 10000

    def score_support(row: dict[str, float]) -> float:
        prev = previous_grouped.get(row["strike_price"], {})
        put_change = row["put_oi"] - float(prev.get("put_oi", 0.0))
        distance_penalty = abs(row["strike_price"] - reference_strike) / 50 if reference_strike is not None else 0.0
        return row["put_oi"] + max(put_change, 0.0) * 0.6 - distance_penalty * 10000

    resistance = sorted(rows, key=score_resistance, reverse=True)[:3]
    support = sorted(rows, key=score_support, reverse=True)[:3]
    return {
        "resistance": [
            {
                "strike_price": row["strike_price"],
                "call_oi": row["call_oi"],
                "score": round(score_resistance(row), 2),
            }
            for row in resistance
        ],
        "support": [
            {
                "strike_price": row["strike_price"],
                "put_oi": row["put_oi"],
                "score": round(score_support(row), 2),
            }
            for row in support
        ],
        "reference_strike": reference_strike,
    }
