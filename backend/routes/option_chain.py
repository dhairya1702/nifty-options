from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from zerodha import ZerodhaClientError, get_live_option_contracts


router = APIRouter(prefix="/option-chain", tags=["option-chain"])
IST = ZoneInfo("Asia/Kolkata")


@router.get("/live")
def live_option_chain() -> dict:
    try:
        contracts = get_live_option_contracts()
    except ZerodhaClientError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch live option chain: {exc}") from exc

    return {
        "fetched_at": datetime.now(IST).isoformat(),
        "timezone": "Asia/Kolkata",
        "refresh_minutes_default": 5,
        "contracts": contracts,
    }
