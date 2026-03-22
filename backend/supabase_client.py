from __future__ import annotations

import logging
from functools import lru_cache
from time import sleep
from typing import Callable, TypeVar

import httpx

from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from config import require_settings


logger = logging.getLogger(__name__)
_ResponseT = TypeVar("_ResponseT")
_MAX_RETRIES = 2
_BASE_RETRY_DELAY_SECONDS = 0.25


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    settings = require_settings(["SUPABASE_URL", "SUPABASE_KEY"])
    return create_client(
        settings["SUPABASE_URL"],
        settings["SUPABASE_KEY"],
        options=SyncClientOptions(postgrest_client_timeout=30),
    )


def reset_supabase() -> None:
    get_supabase.cache_clear()


def supabase_execute(operation: str, query: Callable[[Client], _ResponseT]) -> _ResponseT:
    last_error: Exception | None = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            return query(get_supabase())
        except httpx.TransportError as exc:
            last_error = exc
            if attempt >= _MAX_RETRIES:
                break
            logger.warning(
                "Transient Supabase transport error during %s (attempt %s/%s): %s",
                operation,
                attempt + 1,
                _MAX_RETRIES + 1,
                exc,
            )
            reset_supabase()
            sleep(_BASE_RETRY_DELAY_SECONDS * (attempt + 1))
    assert last_error is not None
    raise last_error
