from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException

from config import get_frontend_url, require_settings
from runtime_settings import clear_access_token, get_access_token, set_access_token
from scheduler import option_scheduler
from zerodha import get_kite_client


router = APIRouter(tags=["auth"])


@router.get("/auth/status")
def auth_status() -> dict:
    token_present = bool(get_access_token())
    token_valid = False

    if token_present:
        try:
            kite = get_kite_client()
            profile = kite.profile()
            token_valid = bool(profile)
        except TokenException:
            clear_access_token()
            token_present = False
            token_valid = False
        except Exception:
            token_valid = False

    return {
        "authenticated": token_present,
        "token_valid": token_valid,
        "login_required": not token_valid,
        "underlying": option_scheduler.underlying,
    }


@router.get("/login")
def login() -> RedirectResponse:
    settings = require_settings(["ZERODHA_API_KEY"])
    kite = KiteConnect(api_key=settings["ZERODHA_API_KEY"])
    return RedirectResponse(url=kite.login_url(), status_code=307)


@router.get("/callback", response_model=None)
def callback(
    request: Request,
    request_token: str = Query(...),
    format: str | None = Query(default=None),
):
    try:
        settings = require_settings(["ZERODHA_API_KEY", "ZERODHA_API_SECRET"])
        kite = KiteConnect(api_key=settings["ZERODHA_API_KEY"])
        session = kite.generate_session(request_token, api_secret=settings["ZERODHA_API_SECRET"])
        access_token = session["access_token"]
        set_access_token(access_token)
        option_scheduler.catch_up_history()

        wants_json = format == "json" or "application/json" in request.headers.get("accept", "")
        if wants_json:
            return {"success": True, "message": "Login successful"}

        return RedirectResponse(
            url=f"{get_frontend_url()}?auth=success&message=Login%20successful",
            status_code=307,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Zerodha login failed: {exc}") from exc
