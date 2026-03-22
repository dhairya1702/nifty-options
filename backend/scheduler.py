from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from supabase_client import get_supabase
from zerodha import SUPPORTED_UNDERLYINGS, get_option_chain


logger = logging.getLogger(__name__)
JOB_ID = "nifty-option-snapshot-job"
IST = ZoneInfo("Asia/Kolkata")
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)


class OptionDataScheduler:
    def __init__(self) -> None:
        self.scheduler = BackgroundScheduler(timezone=timezone.utc)
        self.running = False
        self.interval_minutes = 15
        self.underlying = "NIFTY"
        self.last_run: datetime | None = None
        self.next_run: datetime | None = None
        self.last_catch_up: dict[str, Any] | None = None

    def start_engine(self) -> None:
        if not self.scheduler.running:
            self.scheduler.start()

    def shutdown(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
        self.running = False
        self.next_run = None

    def _market_is_open(self) -> bool:
        now = datetime.now(IST)
        return now.weekday() < 5 and MARKET_OPEN <= now.time() <= MARKET_CLOSE

    def run_collection_job(self) -> None:
        try:
            if not self._market_is_open():
                logger.info("Skipping live snapshot insert because market is closed")
                return

            option_chain = get_option_chain(self.underlying)
            if not option_chain:
                logger.warning("Skipping snapshot insert because Zerodha returned no option data")
                return

            timestamp = datetime.now(timezone.utc).isoformat()
            snapshot_rows = [
                {
                    "timestamp": timestamp,
                    "underlying": self.underlying,
                    "expiry": row.get("expiry"),
                    "tradingsymbol": row.get("tradingsymbol"),
                    "instrument_token": row.get("instrument_token"),
                    "strike_price": row["strike_price"],
                    "option_type": row["option_type"],
                    "oi": row["oi"],
                    "ltp": row["ltp"],
                }
                for row in option_chain
            ]
            total_call_oi = sum(float(row["oi"]) for row in option_chain if row["option_type"] == "CE")
            total_put_oi = sum(float(row["oi"]) for row in option_chain if row["option_type"] == "PE")
            pcr = round(total_put_oi / total_call_oi, 4) if total_call_oi else 0.0
            expiry = next((row.get("expiry") for row in option_chain if row.get("expiry")), None)

            supabase = get_supabase()
            supabase.table("option_snapshots").upsert(
                snapshot_rows,
                on_conflict="underlying,timestamp,expiry,strike_price,option_type",
            ).execute()
            supabase.table("pcr_timeseries").upsert(
                {
                    "timestamp": timestamp,
                    "underlying": self.underlying,
                    "expiry": expiry,
                    "total_call_oi": total_call_oi,
                    "total_put_oi": total_put_oi,
                    "pcr": pcr,
                },
                on_conflict="underlying,timestamp",
            ).execute()

            self.last_run = datetime.now(timezone.utc)
            self._sync_next_run()
        except Exception:
            logger.exception("Scheduled option collection failed")

    def _sync_next_run(self) -> None:
        job = self.scheduler.get_job(JOB_ID)
        if job and job.next_run_time:
            self.next_run = job.next_run_time
        elif self.running:
            self.next_run = datetime.now(timezone.utc) + timedelta(minutes=self.interval_minutes)
        else:
            self.next_run = None

    def start(self) -> dict[str, Any]:
        from backfill import DEFAULT_LOOKBACK_DAYS, catch_up_missing_history

        self.start_engine()
        self.last_catch_up = catch_up_missing_history(DEFAULT_LOOKBACK_DAYS)
        existing = self.scheduler.get_job(JOB_ID)
        if existing:
            self.scheduler.remove_job(JOB_ID)
        trigger = IntervalTrigger(minutes=self.interval_minutes, timezone=timezone.utc)
        self.scheduler.add_job(self.run_collection_job, trigger=trigger, id=JOB_ID, replace_existing=True)
        self.running = True
        self.run_collection_job()
        self._sync_next_run()
        return self.status()

    def stop(self) -> dict[str, Any]:
        if self.scheduler.get_job(JOB_ID):
            self.scheduler.remove_job(JOB_ID)
        self.running = False
        self.next_run = None
        return self.status()

    def update_config(self, interval_minutes: int, underlying: str | None = None) -> dict[str, Any]:
        self.interval_minutes = interval_minutes
        if underlying:
            normalized = underlying.upper()
            if normalized not in SUPPORTED_UNDERLYINGS:
                raise ValueError(f"Unsupported underlying: {underlying}")
            self.underlying = normalized
        if self.running:
            self.start()
        return self.status()

    def status(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "interval_minutes": self.interval_minutes,
            "underlying": self.underlying,
            "supported_underlyings": list(SUPPORTED_UNDERLYINGS.keys()),
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "next_run": self.next_run.isoformat() if self.next_run else None,
            "last_catch_up": self.last_catch_up,
        }


option_scheduler = OptionDataScheduler()
