from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from config import require_settings


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    settings = require_settings(["SUPABASE_URL", "SUPABASE_KEY"])
    return create_client(settings["SUPABASE_URL"], settings["SUPABASE_KEY"])
