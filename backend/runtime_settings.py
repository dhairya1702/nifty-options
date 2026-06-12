from __future__ import annotations

from config import get_env_value, set_env_value
from local_db import get_setting, set_setting


ZERODHA_ACCESS_TOKEN_KEY = "zerodha_access_token"


def get_runtime_setting(key: str) -> str | None:
    value = get_env_value(key.upper())
    if value:
        return value

    return get_setting(key)


def set_runtime_setting(key: str, value: str) -> None:
    set_setting(key, value)


def get_access_token() -> str | None:
    return get_runtime_setting(ZERODHA_ACCESS_TOKEN_KEY)


def set_access_token(value: str) -> None:
    # Persist locally for laptop runs and remotely for hosted/runtime continuity.
    set_env_value("ZERODHA_ACCESS_TOKEN", value)
    set_runtime_setting(ZERODHA_ACCESS_TOKEN_KEY, value)


def clear_access_token() -> None:
    set_env_value("ZERODHA_ACCESS_TOKEN", "")
    set_runtime_setting(ZERODHA_ACCESS_TOKEN_KEY, "")
