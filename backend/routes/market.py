from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter

from scheduler import option_scheduler


router = APIRouter(prefix="/market", tags=["market"])
IST = ZoneInfo("Asia/Kolkata")
PREOPEN_START = time(9, 0)
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)


def _next_weekday_open(now: datetime) -> datetime:
    candidate = now
    while True:
        candidate = (candidate + timedelta(days=1)).replace(hour=9, minute=15, second=0, microsecond=0)
        if candidate.weekday() < 5:
            return candidate


@router.get("/status")
def market_status() -> dict:
    now = datetime.now(IST)
    current_time = now.time()
    weekday = now.weekday()
    is_weekend = weekday >= 5

    phase = "closed"
    market_open = False
    next_open = None
    next_close = None

    if is_weekend:
        phase = "weekend"
        next_open_dt = _next_weekday_open(now)
        next_open = next_open_dt.isoformat()
    elif PREOPEN_START <= current_time < MARKET_OPEN:
        phase = "preopen"
        next_open_dt = now.replace(hour=9, minute=15, second=0, microsecond=0)
        next_open = next_open_dt.isoformat()
        next_close = now.replace(hour=15, minute=30, second=0, microsecond=0).isoformat()
    elif MARKET_OPEN <= current_time <= MARKET_CLOSE:
        phase = "live"
        market_open = True
        next_close = now.replace(hour=15, minute=30, second=0, microsecond=0).isoformat()
    else:
        phase = "closed"
        if current_time < PREOPEN_START:
            next_open_dt = now.replace(hour=9, minute=15, second=0, microsecond=0)
        else:
            next_open_dt = _next_weekday_open(now)
        next_open = next_open_dt.isoformat()

    return {
        "underlying": option_scheduler.underlying,
        "timezone": "Asia/Kolkata",
        "timestamp": now.isoformat(),
        "market_open": market_open,
        "phase": phase,
        "next_open": next_open,
        "next_close": next_close,
    }
