from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import dotenv_values


BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"


def read_env_file() -> dict[str, str]:
    if not ENV_PATH.exists():
        return {}
    values = dotenv_values(ENV_PATH)
    return {key: str(value) for key, value in values.items() if value is not None}


def get_env_value(key: str, default: str | None = None) -> str | None:
    file_values = read_env_file()
    return os.getenv(key, file_values.get(key, default))


@lru_cache(maxsize=1)
def get_frontend_url() -> str:
    return get_env_value("FRONTEND_URL", "http://localhost:3000") or "http://localhost:3000"


def set_env_value(key: str, value: str) -> None:
    lines: list[str] = []
    if ENV_PATH.exists():
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines()

    replaced = False
    updated_lines: list[str] = []
    for line in lines:
        if line.startswith(f"{key}="):
            updated_lines.append(f"{key}={value}")
            replaced = True
        else:
            updated_lines.append(line)

    if not replaced:
        updated_lines.append(f"{key}={value}")

    ENV_PATH.write_text("\n".join(updated_lines).strip() + "\n", encoding="utf-8")


def require_settings(keys: list[str]) -> dict[str, str]:
    values = {key: get_env_value(key) for key in keys}
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise ValueError(f"Missing required settings: {', '.join(missing)}")
    return {key: value for key, value in values.items() if value is not None}
