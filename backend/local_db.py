from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import BASE_DIR, get_env_value


DEFAULT_DB_PATH = BASE_DIR / "data" / "options_dashboard.sqlite3"


def get_db_path() -> Path:
    configured = get_env_value("LOCAL_DB_PATH")
    return Path(configured).expanduser() if configured else DEFAULT_DB_PATH


def _connect() -> sqlite3.Connection:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("pragma foreign_keys = on")
    return connection


def init_db() -> None:
    with _connect() as connection:
        connection.executescript(
            """
            pragma journal_mode = wal;

            create table if not exists option_snapshots (
              id integer primary key autoincrement,
              timestamp text not null,
              underlying text not null,
              expiry text,
              tradingsymbol text,
              instrument_token integer,
              strike_price real not null,
              option_type text not null check (option_type in ('CE', 'PE')),
              oi real not null,
              ltp real not null,
              unique (underlying, timestamp, expiry, strike_price, option_type)
            );

            create index if not exists option_snapshots_timestamp_idx
              on option_snapshots (underlying, timestamp desc);

            create index if not exists option_snapshots_strike_idx
              on option_snapshots (underlying, strike_price, option_type, timestamp desc);

            create table if not exists pcr_timeseries (
              id integer primary key autoincrement,
              timestamp text not null,
              underlying text not null,
              expiry text,
              total_call_oi real not null,
              total_put_oi real not null,
              pcr real not null,
              unique (underlying, timestamp)
            );

            create index if not exists pcr_timeseries_timestamp_idx
              on pcr_timeseries (underlying, timestamp desc);

            create table if not exists app_settings (
              key text primary key,
              value text not null,
              updated_at text not null
            );
            """
        )


def _rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def upsert_option_snapshots(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    init_db()
    with _connect() as connection:
        connection.executemany(
            """
            insert into option_snapshots (
              timestamp, underlying, expiry, tradingsymbol, instrument_token,
              strike_price, option_type, oi, ltp
            )
            values (
              :timestamp, :underlying, :expiry, :tradingsymbol, :instrument_token,
              :strike_price, :option_type, :oi, :ltp
            )
            on conflict (underlying, timestamp, expiry, strike_price, option_type)
            do update set
              tradingsymbol = excluded.tradingsymbol,
              instrument_token = excluded.instrument_token,
              oi = excluded.oi,
              ltp = excluded.ltp
            """,
            rows,
        )


def upsert_pcr_rows(rows: dict[str, Any] | list[dict[str, Any]]) -> None:
    normalized_rows = [rows] if isinstance(rows, dict) else rows
    if not normalized_rows:
        return
    init_db()
    with _connect() as connection:
        connection.executemany(
            """
            insert into pcr_timeseries (
              timestamp, underlying, expiry, total_call_oi, total_put_oi, pcr
            )
            values (
              :timestamp, :underlying, :expiry, :total_call_oi, :total_put_oi, :pcr
            )
            on conflict (underlying, timestamp)
            do update set
              expiry = excluded.expiry,
              total_call_oi = excluded.total_call_oi,
              total_put_oi = excluded.total_put_oi,
              pcr = excluded.pcr
            """,
            normalized_rows,
        )


def latest_pcr_row(underlying: str) -> dict[str, Any] | None:
    init_db()
    with _connect() as connection:
        row = connection.execute(
            """
            select timestamp, expiry, pcr, total_call_oi, total_put_oi
            from pcr_timeseries
            where underlying = ?
            order by timestamp desc
            limit 1
            """,
            (underlying,),
        ).fetchone()
    return dict(row) if row else None


def pcr_history(underlying: str, limit: int) -> list[dict[str, Any]]:
    init_db()
    with _connect() as connection:
        rows = connection.execute(
            """
            select timestamp, pcr
            from pcr_timeseries
            where underlying = ?
            order by timestamp desc
            limit ?
            """,
            (underlying, limit),
        ).fetchall()
    return list(reversed(_rows_to_dicts(rows)))


def pcr_range_history(underlying: str, limit: int, strike_min: float, strike_max: float) -> list[dict[str, Any]]:
    init_db()
    with _connect() as connection:
        rows = connection.execute(
            """
            select
              timestamp,
              sum(case when option_type = 'CE' then oi else 0 end) as total_call_oi,
              sum(case when option_type = 'PE' then oi else 0 end) as total_put_oi
            from option_snapshots
            where underlying = ?
              and strike_price >= ?
              and strike_price <= ?
            group by timestamp
            order by timestamp desc
            limit ?
            """,
            (underlying, strike_min, strike_max, limit),
        ).fetchall()

    history = []
    for row in reversed(rows):
        total_call_oi = float(row["total_call_oi"] or 0.0)
        total_put_oi = float(row["total_put_oi"] or 0.0)
        history.append(
            {
                "timestamp": str(row["timestamp"]),
                "pcr": round(total_put_oi / total_call_oi, 4) if total_call_oi else 0.0,
                "total_call_oi": total_call_oi,
                "total_put_oi": total_put_oi,
            }
        )
    return history


def pcr_history_filtered(
    underlying: str,
    *,
    limit: int | None = None,
    from_timestamp: str | None = None,
    to_timestamp: str | None = None,
) -> list[dict[str, Any]]:
    init_db()
    query = """
        select timestamp, pcr, total_call_oi, total_put_oi
        from pcr_timeseries
        where underlying = ?
    """
    params: list[Any] = [underlying]

    if from_timestamp:
        query += " and datetime(timestamp) >= datetime(?)"
        params.append(from_timestamp)
    if to_timestamp:
        query += " and datetime(timestamp) <= datetime(?)"
        params.append(to_timestamp)

    query += " order by datetime(timestamp) desc"
    if limit is not None:
        query += " limit ?"
        params.append(limit)

    with _connect() as connection:
        rows = connection.execute(query, params).fetchall()

    history = []
    for row in reversed(rows):
        history.append(
            {
                "timestamp": str(row["timestamp"]),
                "pcr": float(row["pcr"] or 0.0),
                "total_call_oi": float(row["total_call_oi"] or 0.0),
                "total_put_oi": float(row["total_put_oi"] or 0.0),
            }
        )
    return history


def pcr_range_history_filtered(
    underlying: str,
    strike_min: float,
    strike_max: float,
    *,
    limit: int | None = None,
    from_timestamp: str | None = None,
    to_timestamp: str | None = None,
) -> list[dict[str, Any]]:
    init_db()
    query = """
        select
          timestamp,
          sum(case when option_type = 'CE' then oi else 0 end) as total_call_oi,
          sum(case when option_type = 'PE' then oi else 0 end) as total_put_oi
        from option_snapshots
        where underlying = ?
          and strike_price >= ?
          and strike_price <= ?
    """
    params: list[Any] = [underlying, strike_min, strike_max]

    if from_timestamp:
        query += " and datetime(timestamp) >= datetime(?)"
        params.append(from_timestamp)
    if to_timestamp:
        query += " and datetime(timestamp) <= datetime(?)"
        params.append(to_timestamp)

    query += " group by timestamp order by datetime(timestamp) desc"
    if limit is not None:
        query += " limit ?"
        params.append(limit)

    with _connect() as connection:
        rows = connection.execute(query, params).fetchall()

    history = []
    for row in reversed(rows):
        total_call_oi = float(row["total_call_oi"] or 0.0)
        total_put_oi = float(row["total_put_oi"] or 0.0)
        history.append(
            {
                "timestamp": str(row["timestamp"]),
                "pcr": round(total_put_oi / total_call_oi, 4) if total_call_oi else 0.0,
                "total_call_oi": total_call_oi,
                "total_put_oi": total_put_oi,
            }
        )
    return history


def pcr_rows_for_analytics(underlying: str, limit: int) -> list[dict[str, Any]]:
    init_db()
    with _connect() as connection:
        rows = connection.execute(
            """
            select timestamp, pcr, total_call_oi, total_put_oi
            from pcr_timeseries
            where underlying = ?
            order by timestamp desc
            limit ?
            """,
            (underlying, limit),
        ).fetchall()
    return list(reversed(_rows_to_dicts(rows)))


def latest_snapshot_timestamps(underlying: str, limit: int = 2) -> list[str]:
    init_db()
    with _connect() as connection:
        rows = connection.execute(
            """
            select distinct timestamp
            from option_snapshots
            where underlying = ?
            order by timestamp desc
            limit ?
            """,
            (underlying, limit),
        ).fetchall()
    return [str(row["timestamp"]) for row in rows]


def snapshot_timestamps_filtered(
    underlying: str,
    *,
    from_timestamp: str | None = None,
    to_timestamp: str | None = None,
) -> list[str]:
    init_db()
    query = """
        select distinct timestamp
        from option_snapshots
        where underlying = ?
    """
    params: list[Any] = [underlying]

    if from_timestamp:
        query += " and datetime(timestamp) >= datetime(?)"
        params.append(from_timestamp)
    if to_timestamp:
        query += " and datetime(timestamp) <= datetime(?)"
        params.append(to_timestamp)

    query += " order by datetime(timestamp)"

    with _connect() as connection:
        rows = connection.execute(query, params).fetchall()
    return [str(row["timestamp"]) for row in rows]


def snapshot_rows(underlying: str, timestamp: str | None) -> list[dict[str, Any]]:
    if not timestamp:
        return []
    init_db()
    with _connect() as connection:
        rows = connection.execute(
            """
            select strike_price, option_type, oi, ltp
            from option_snapshots
            where underlying = ? and timestamp = ?
            order by strike_price
            """,
            (underlying, timestamp),
        ).fetchall()
    return _rows_to_dicts(rows)


def latest_snapshot_timestamp(underlying: str) -> str | None:
    timestamps = latest_snapshot_timestamps(underlying, limit=1)
    return timestamps[0] if timestamps else None


def snapshot_count(underlying: str, timestamp: str) -> int:
    init_db()
    with _connect() as connection:
        row = connection.execute(
            """
            select count(*) as count
            from option_snapshots
            where underlying = ? and timestamp = ?
            """,
            (underlying, timestamp),
        ).fetchone()
    return int(row["count"]) if row else 0


def latest_stored_timestamp(underlying: str) -> str | None:
    init_db()
    with _connect() as connection:
        row = connection.execute(
            """
            select max(timestamp) as timestamp
            from (
              select timestamp from pcr_timeseries where underlying = ?
              union all
              select timestamp from option_snapshots where underlying = ?
            )
            """,
            (underlying, underlying),
        ).fetchone()
    return str(row["timestamp"]) if row and row["timestamp"] else None


def delete_underlying_history(underlying: str) -> None:
    init_db()
    with _connect() as connection:
        connection.execute("delete from option_snapshots where underlying = ?", (underlying,))
        connection.execute("delete from pcr_timeseries where underlying = ?", (underlying,))


def get_setting(key: str) -> str | None:
    init_db()
    with _connect() as connection:
        row = connection.execute("select value from app_settings where key = ? limit 1", (key,)).fetchone()
    return str(row["value"]) if row else None


def set_setting(key: str, value: str) -> None:
    init_db()
    with _connect() as connection:
        connection.execute(
            """
            insert into app_settings (key, value, updated_at)
            values (?, ?, ?)
            on conflict (key)
            do update set value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, datetime.now(timezone.utc).isoformat()),
        )
