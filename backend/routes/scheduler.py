from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from scheduler import option_scheduler


router = APIRouter(prefix="/scheduler", tags=["scheduler"])


class SchedulerConfigRequest(BaseModel):
    interval_minutes: int = Field(..., ge=1, le=240)
    underlying: str = Field(default="NIFTY")


@router.post("/start")
def start_scheduler() -> dict:
    return option_scheduler.start()


@router.post("/stop")
def stop_scheduler() -> dict:
    return option_scheduler.stop()


@router.get("/status")
def scheduler_status() -> dict:
    return option_scheduler.status()


@router.post("/config")
def update_scheduler_config(payload: SchedulerConfigRequest) -> dict:
    if payload.interval_minutes <= 0:
        raise HTTPException(status_code=400, detail="interval_minutes must be positive")
    try:
        return option_scheduler.update_config(payload.interval_minutes, payload.underlying)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
