from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException

from config import get_env_value, require_settings
from runtime_settings import clear_access_token, get_access_token


logger = logging.getLogger(__name__)
NFO_EXCHANGE = "NFO"
SUPPORTED_UNDERLYINGS = {
    "NIFTY": {"instrument_name": "NIFTY", "spot_symbol": "NSE:NIFTY 50"},
    "BANKNIFTY": {"instrument_name": "BANKNIFTY", "spot_symbol": "NSE:NIFTY BANK"},
    "FINNIFTY": {"instrument_name": "FINNIFTY", "spot_symbol": "NSE:NIFTY FIN SERVICE"},
}


class ZerodhaClientError(Exception):
    pass


def _handle_token_exception(exc: TokenException) -> None:
    logger.warning("Clearing stored Zerodha access token after token rejection: %s", exc)
    clear_access_token()


def get_kite_client() -> KiteConnect:
    settings = require_settings(["ZERODHA_API_KEY"])
    kite = KiteConnect(api_key=settings["ZERODHA_API_KEY"])
    access_token = get_access_token()
    if access_token:
        kite.set_access_token(access_token)
    return kite


def _validate_underlying(underlying: str) -> str:
    normalized = underlying.upper()
    if normalized not in SUPPORTED_UNDERLYINGS:
        raise ZerodhaClientError(f"Unsupported underlying: {underlying}")
    return normalized


def _nearest_expiry(instruments: list[dict[str, Any]], underlying: str) -> date:
    today = date.today()
    future_expiries = sorted(
        {
            instrument["expiry"]
            for instrument in instruments
            if instrument.get("expiry") and instrument["expiry"] >= today
        }
    )
    if not future_expiries:
        raise ZerodhaClientError(f"No future {underlying} option expiries found in NFO instruments")

    return future_expiries[0]


def _get_option_instruments(underlying: str) -> list[dict[str, Any]]:
    underlying = _validate_underlying(underlying)
    _require_access_token()
    kite = get_kite_client()

    try:
        instruments = kite.instruments(NFO_EXCHANGE)
    except TokenException as exc:
        _handle_token_exception(exc)
        raise ZerodhaClientError("Zerodha session expired. Complete login again.") from exc
    except Exception as exc:
        logger.exception("Failed to fetch NFO instruments from Zerodha")
        raise ZerodhaClientError(f"Failed to fetch NFO instruments: {exc}") from exc

    return [
        instrument
        for instrument in instruments
        if instrument.get("name") == SUPPORTED_UNDERLYINGS[underlying]["instrument_name"]
        and instrument.get("instrument_type") in {"CE", "PE"}
    ]


def _require_access_token() -> str:
    access_token = get_access_token()
    if not access_token:
        raise ZerodhaClientError("Missing ZERODHA_ACCESS_TOKEN. Complete Zerodha login first.")
    return access_token


def get_option_chain(underlying: str = "NIFTY") -> list[dict[str, float | str]]:
    underlying = _validate_underlying(underlying)
    kite = get_kite_client()
    nearest_options = get_active_option_instruments(underlying)
    grouped: dict[float, dict[str, dict[str, Any]]] = defaultdict(dict)

    for instrument in nearest_options:
        strike_price = float(instrument["strike"])
        option_type = str(instrument["instrument_type"])
        grouped[strike_price][option_type] = instrument

    quote_symbols: list[str] = []
    quote_index: dict[str, tuple[float, str]] = {}
    for strike_price, option_map in grouped.items():
        for option_type, instrument in option_map.items():
            symbol = f"{instrument['exchange']}:{instrument['tradingsymbol']}"
            quote_symbols.append(symbol)
            quote_index[symbol] = (strike_price, option_type)

    try:
        quotes = kite.quote(quote_symbols)
    except TokenException as exc:
        _handle_token_exception(exc)
        raise ZerodhaClientError("Zerodha session expired. Complete login again.") from exc
    except Exception as exc:
        logger.exception("Failed to fetch option quotes from Zerodha")
        raise ZerodhaClientError(f"Failed to fetch option quotes: {exc}") from exc

    option_chain: list[dict[str, float | str]] = []
    for symbol, payload in quotes.items():
        strike_price, option_type = quote_index[symbol]
        option_chain.append(
            {
                "underlying": underlying,
                "strike_price": strike_price,
                "option_type": option_type,
                "expiry": instrument["expiry"].isoformat() if instrument.get("expiry") else None,
                "tradingsymbol": str(instrument["tradingsymbol"]),
                "instrument_token": int(instrument["instrument_token"]),
                "oi": float(payload.get("oi") or payload.get("open_interest") or 0.0),
                "ltp": float(payload.get("last_price") or 0.0),
            }
        )

    return sorted(option_chain, key=lambda row: (row["strike_price"], row["option_type"]))


def get_active_option_instruments(underlying: str = "NIFTY") -> list[dict[str, Any]]:
    underlying = _validate_underlying(underlying)
    option_instruments = _get_option_instruments(underlying)

    expiry = _nearest_expiry(option_instruments, underlying)
    return [instrument for instrument in option_instruments if instrument.get("expiry") == expiry]


def get_historical_option_instruments(
    underlying: str,
    from_dt: datetime,
    to_dt: datetime,
) -> list[tuple[date, datetime, datetime, list[dict[str, Any]]]]:
    underlying = _validate_underlying(underlying)
    option_instruments = _get_option_instruments(underlying)
    expiries = sorted({instrument["expiry"] for instrument in option_instruments if instrument.get("expiry")})
    if not expiries:
        raise ZerodhaClientError(f"No option expiries found for {underlying}")

    current_start = from_dt
    segments: list[tuple[date, datetime, datetime, list[dict[str, Any]]]] = []

    while current_start <= to_dt:
        trade_day = current_start.date()
        active_expiry = next((expiry for expiry in expiries if expiry >= trade_day), None)
        if active_expiry is None:
            break

        current_instruments = [instrument for instrument in option_instruments if instrument.get("expiry") == active_expiry]
        segment_end_date = min(active_expiry, to_dt.date())
        segment_end = min(
            to_dt,
            datetime.combine(segment_end_date, datetime.max.time(), tzinfo=current_start.tzinfo),
        )
        segments.append((active_expiry, current_start, segment_end, current_instruments))
        current_start = datetime.combine(segment_end.date() + timedelta(days=1), datetime.min.time()).replace(
            tzinfo=segment_end.tzinfo,
        )

    return segments


def get_spot_ltp(underlying: str = "NIFTY") -> float | None:
    try:
        underlying = _validate_underlying(underlying)
        kite = get_kite_client()
        _require_access_token()
        spot_symbol = SUPPORTED_UNDERLYINGS[underlying]["spot_symbol"]
        quote = kite.quote([spot_symbol])
        last_price = (quote.get(spot_symbol) or {}).get("last_price")
        return float(last_price) if last_price is not None else None
    except TokenException as exc:
        _handle_token_exception(exc)
        logger.info("Spot quote skipped because Zerodha session expired for %s", underlying)
        return None
    except Exception:
        logger.exception("Failed to fetch %s spot quote", underlying)
        return None


def get_nearest_expiry_for_underlying(underlying: str = "NIFTY") -> date | None:
    try:
        underlying = _validate_underlying(underlying)
        option_instruments = _get_option_instruments(underlying)
        return _nearest_expiry(option_instruments, underlying)
    except Exception:
        logger.exception("Failed to fetch nearest %s expiry", underlying)
        return None
