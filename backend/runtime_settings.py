from __future__ import annotations

from datetime import datetime, timezone

from config import get_env_value, set_env_value
from supabase_client import supabase_execute


ZERODHA_ACCESS_TOKEN_KEY = "zerodha_access_token"


def get_runtime_setting(key: str) -> str | None:
    value = get_env_value(key.upper())
    if value:
        return value

    try:
        response = supabase_execute(
            "load runtime setting",
            lambda supabase: supabase.table("app_settings").select("value").eq("key", key).limit(1).execute(),
        )
        rows = response.data or []
        return str(rows[0]["value"]) if rows else None
    except Exception:
        return None


def set_runtime_setting(key: str, value: str) -> None:
    supabase_execute(
        "save runtime setting",
        lambda supabase: supabase.table("app_settings").upsert(
            {"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()},
            on_conflict="key",
        ).execute(),
    )


def get_access_token() -> str | None:
    return get_runtime_setting(ZERODHA_ACCESS_TOKEN_KEY)


def set_access_token(value: str) -> None:
    # Persist locally for laptop runs and remotely for hosted/runtime continuity.
    set_env_value("ZERODHA_ACCESS_TOKEN", value)
    set_runtime_setting(ZERODHA_ACCESS_TOKEN_KEY, value)


def clear_access_token() -> None:
    set_env_value("ZERODHA_ACCESS_TOKEN", "")
    set_runtime_setting(ZERODHA_ACCESS_TOKEN_KEY, "")
