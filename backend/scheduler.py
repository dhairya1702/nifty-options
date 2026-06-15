from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from local_db import (
    get_setting,
    latest_pcr_row,
    latest_snapshot_timestamp,
    set_setting,
    snapshot_count,
    upsert_option_snapshots,
    upsert_pcr_rows,
)
from zerodha import SUPPORTED_UNDERLYINGS, get_option_chain


logger = logging.getLogger(__name__)
JOB_ID = "nifty-option-snapshot-job"
IST = ZoneInfo("Asia/Kolkata")
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)
SETTING_PREFIX = "scheduler"


class OptionDataScheduler:
    def __init__(self) -> None:
        self.scheduler = BackgroundScheduler(timezone=timezone.utc)
        self.running = False
        self.interval_minutes = 5
        self.underlying = "NIFTY"
        self.last_run: datetime | None = None
        self.last_attempt: datetime | None = None
        self.next_run: datetime | None = None
        self.last_catch_up: dict[str, Any] | None = None
        self.last_error: str | None = None
        self.last_outcome: str | None = None

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

    def _setting_key(self, suffix: str) -> str:
        return f"{SETTING_PREFIX}:{suffix}"

    def _persist_state(self) -> None:
        set_setting(self._setting_key("interval_minutes"), str(self.interval_minutes))
        set_setting(self._setting_key("underlying"), self.underlying)
        set_setting(self._setting_key("running"), "1" if self.running else "0")

    def restore(self) -> dict[str, Any]:
        stored_interval = get_setting(self._setting_key("interval_minutes"))
        stored_underlying = get_setting(self._setting_key("underlying"))
        stored_running = get_setting(self._setting_key("running"))

        if stored_interval:
            try:
                self.interval_minutes = max(1, int(stored_interval))
            except ValueError:
                logger.warning("Ignoring invalid stored scheduler interval: %s", stored_interval)

        if stored_underlying:
            normalized = stored_underlying.upper()
            if normalized in SUPPORTED_UNDERLYINGS:
                self.underlying = normalized

        should_resume = stored_running == "1"
        if should_resume:
            try:
                self.start(resume=True)
            except Exception as exc:
                self.last_error = f"Auto-resume failed: {exc}"
                self.last_outcome = "failed"
                logger.exception("Failed to auto-resume scheduler")
                self.running = False
                self._persist_state()
        else:
            self._persist_state()

        return self.status()

    def run_collection_job(self) -> None:
        self.last_attempt = datetime.now(timezone.utc)
        try:
            if not self._market_is_open():
                self.last_outcome = "skipped_market_closed"
                self.last_error = None
                logger.info("Skipping live snapshot insert because market is closed")
                self._sync_next_run()
                return

            option_chain = get_option_chain(self.underlying)
            if not option_chain:
                self.last_outcome = "skipped_no_data"
                self.last_error = "Zerodha returned no option data"
                logger.warning("Skipping snapshot insert because Zerodha returned no option data")
                self._sync_next_run()
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

            upsert_option_snapshots(snapshot_rows)
            upsert_pcr_rows(
                {
                    "timestamp": timestamp,
                    "underlying": self.underlying,
                    "expiry": expiry,
                    "total_call_oi": total_call_oi,
                    "total_put_oi": total_put_oi,
                    "pcr": pcr,
                }
            )

            self.last_run = datetime.now(timezone.utc)
            self.last_outcome = "success"
            self.last_error = None
            self._sync_next_run()
        except Exception as exc:
            self.last_outcome = "failed"
            self.last_error = str(exc)
            self._sync_next_run()
            logger.exception("Scheduled option collection failed")

    def _sync_next_run(self) -> None:
        job = self.scheduler.get_job(JOB_ID)
        if job and job.next_run_time:
            self.next_run = job.next_run_time
        elif self.running:
            self.next_run = datetime.now(timezone.utc) + timedelta(minutes=self.interval_minutes)
        else:
            self.next_run = None

    def _latest_data_status(self) -> dict[str, Any] | None:
        try:
            latest_pcr = latest_pcr_row(self.underlying)
            latest_snapshot = latest_snapshot_timestamp(self.underlying)

            snapshot_contracts = 0
            if latest_snapshot:
                snapshot_contracts = snapshot_count(self.underlying, latest_snapshot)

            return {
                "latest_snapshot_timestamp": latest_snapshot,
                "snapshot_contracts": snapshot_contracts,
                "latest_pcr_timestamp": latest_pcr["timestamp"] if latest_pcr else None,
                "latest_pcr": float(latest_pcr["pcr"]) if latest_pcr else None,
                "total_call_oi": float(latest_pcr["total_call_oi"]) if latest_pcr else None,
                "total_put_oi": float(latest_pcr["total_put_oi"]) if latest_pcr else None,
                "expiry": latest_pcr["expiry"] if latest_pcr else None,
            }
        except Exception:
            logger.exception("Failed to build scheduler data status")
            return None

    def start(self, *, resume: bool = False) -> dict[str, Any]:
        from backfill import DEFAULT_LOOKBACK_DAYS, catch_up_missing_history

        self.start_engine()
        self.last_error = None
        self.last_outcome = "starting"
        self.last_catch_up = catch_up_missing_history(DEFAULT_LOOKBACK_DAYS)
        existing = self.scheduler.get_job(JOB_ID)
        if existing:
            self.scheduler.remove_job(JOB_ID)
        trigger = IntervalTrigger(minutes=self.interval_minutes, timezone=timezone.utc)
        self.scheduler.add_job(self.run_collection_job, trigger=trigger, id=JOB_ID, replace_existing=True)
        self.running = True
        self._persist_state()
        self.run_collection_job()
        self._sync_next_run()
        return self.status()

    def stop(self) -> dict[str, Any]:
        if self.scheduler.get_job(JOB_ID):
            self.scheduler.remove_job(JOB_ID)
        self.running = False
        self.next_run = None
        self.last_outcome = "stopped"
        self._persist_state()
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
        else:
            self._persist_state()
        return self.status()

    def status(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "interval_minutes": self.interval_minutes,
            "underlying": self.underlying,
            "supported_underlyings": list(SUPPORTED_UNDERLYINGS.keys()),
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "last_attempt": self.last_attempt.isoformat() if self.last_attempt else None,
            "next_run": self.next_run.isoformat() if self.next_run else None,
            "last_error": self.last_error,
            "last_outcome": self.last_outcome,
            "data_status": self._latest_data_status(),
            "last_catch_up": self.last_catch_up,
        }


option_scheduler = OptionDataScheduler()
