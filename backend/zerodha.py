from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from math import erf, log, sqrt
from typing import Any

from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException

from config import get_env_value, require_settings
from runtime_settings import clear_access_token, get_access_token


logger = logging.getLogger(__name__)
NFO_EXCHANGE = "NFO"
NSE_EXCHANGE = "NSE"
SUPPORTED_UNDERLYINGS = {
    "NIFTY": {"instrument_name": "NIFTY", "spot_symbol": "NSE:NIFTY 50"},
    "BANKNIFTY": {"instrument_name": "BANKNIFTY", "spot_symbol": "NSE:NIFTY BANK"},
    "FINNIFTY": {"instrument_name": "FINNIFTY", "spot_symbol": "NSE:NIFTY FIN SERVICE"},
}
LOT_SIZES = {"NIFTY": 75, "BANKNIFTY": 30}
_QUOTE_OI_CACHE: dict[str, float] = {}


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
    quote_index: dict[str, tuple[float, str, dict[str, Any]]] = {}
    for strike_price, option_map in grouped.items():
        for option_type, instrument in option_map.items():
            symbol = f"{instrument['exchange']}:{instrument['tradingsymbol']}"
            quote_symbols.append(symbol)
            quote_index[symbol] = (strike_price, option_type, instrument)

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
        strike_price, option_type, instrument = quote_index[symbol]
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


def _last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    if month == 12:
        candidate = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        candidate = date(year, month + 1, 1) - timedelta(days=1)
    while candidate.weekday() != weekday:
        candidate -= timedelta(days=1)
    return candidate


def _nearest_target_expiry(expiries: list[date], target_weekday: int) -> date:
    today = date.today()
    candidates = [expiry for expiry in expiries if expiry >= today and expiry.weekday() == target_weekday]
    if not candidates:
        raise ZerodhaClientError("No future weekly expiry found")
    return min(candidates)


def _monthly_target_expiry(expiries: list[date], target_weekday: int) -> date:
    today = date.today()
    future_expiries = sorted(expiry for expiry in expiries if expiry >= today and expiry.weekday() == target_weekday)
    for expiry in future_expiries:
        if expiry == _last_weekday_of_month(expiry.year, expiry.month, target_weekday):
            return expiry
    raise ZerodhaClientError("No future monthly expiry found")


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + erf(value / sqrt(2.0)))


def _black_scholes_price(spot: float, strike: float, time_to_expiry: float, volatility: float, option_type: str) -> float:
    if spot <= 0 or strike <= 0 or time_to_expiry <= 0 or volatility <= 0:
        intrinsic = max(spot - strike, 0.0) if option_type == "CE" else max(strike - spot, 0.0)
        return intrinsic

    sigma_sqrt_t = volatility * sqrt(time_to_expiry)
    if sigma_sqrt_t <= 0:
        intrinsic = max(spot - strike, 0.0) if option_type == "CE" else max(strike - spot, 0.0)
        return intrinsic

    d1 = log(spot / strike) + 0.5 * volatility * volatility * time_to_expiry
    d1 /= sigma_sqrt_t
    d2 = d1 - sigma_sqrt_t

    if option_type == "CE":
        return spot * _normal_cdf(d1) - strike * _normal_cdf(d2)
    return strike * _normal_cdf(-d2) - spot * _normal_cdf(-d1)


def _estimate_implied_volatility(
    option_price: float,
    spot: float | None,
    strike: float,
    expiry: date | None,
    option_type: str,
) -> float:
    if not option_price or option_price <= 0 or spot is None or spot <= 0 or not expiry:
        return 0.0

    expiry_close = datetime.combine(expiry, datetime.max.time())
    time_to_expiry = max((expiry_close - datetime.now()).total_seconds(), 0.0) / (365.0 * 24.0 * 60.0 * 60.0)
    if time_to_expiry <= 0:
        return 0.0

    low = 0.01
    high = 5.0
    for _ in range(40):
        mid = (low + high) / 2.0
        model_price = _black_scholes_price(spot, strike, time_to_expiry, mid, option_type)
        if model_price > option_price:
            high = mid
        else:
            low = mid
    return round(((low + high) / 2.0) * 100.0, 2)


def _clean_number(value: Any, *, zero_is_zero: bool = True) -> float:
    if value in (None, "", "-", " "):
        return 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if zero_is_zero and number == 0:
        return 0.0
    return number


def _depth_value(levels: Any, index: int, key: str) -> float:
    if not isinstance(levels, list) or len(levels) <= index:
        return 0.0
    level = levels[index] or {}
    return _clean_number(level.get(key))


def _build_option_leg(
    payload: dict[str, Any],
    spot_ltp: float | None,
    strike_price: float,
    expiry: date | None,
    option_type: str,
    cache_key: str,
) -> dict[str, float]:
    oi = _clean_number(payload.get("oi") or payload.get("open_interest"))
    previous_oi = _QUOTE_OI_CACHE.get(cache_key, oi)
    _QUOTE_OI_CACHE[cache_key] = oi
    ltp = _clean_number(payload.get("last_price"))
    depth = payload.get("depth") or {}
    buy_levels = depth.get("buy") or []
    sell_levels = depth.get("sell") or []

    return {
        "oi": oi,
        "change_in_oi": oi - previous_oi,
        "volume": _clean_number(payload.get("volume")),
        "iv": _estimate_implied_volatility(ltp, spot_ltp, strike_price, expiry, option_type),
        "ltp": ltp,
        "bid_qty": _depth_value(buy_levels, 0, "quantity"),
        "bid_price": _depth_value(buy_levels, 0, "price"),
        "ask_price": _depth_value(sell_levels, 0, "price"),
        "ask_qty": _depth_value(sell_levels, 0, "quantity"),
    }


def _ratio(numerator: float, denominator: float) -> float:
    return numerator / (denominator if denominator else 1.0)


def _contract_row(
    strike_price: float,
    call_leg: dict[str, float],
    put_leg: dict[str, float],
    lot_size: int,
) -> dict[str, float]:
    f_call_oi = _clean_number(call_leg.get("oi"))
    f_put_oi = _clean_number(put_leg.get("oi"))
    call_ltp = _clean_number(call_leg.get("ltp"))
    put_ltp = _clean_number(put_leg.get("ltp"))
    call_amount = f_call_oi * lot_size * call_ltp
    put_amount = f_put_oi * lot_size * put_ltp
    pcr = _ratio(f_put_oi, f_call_oi)
    cpr = _ratio(f_call_oi, f_put_oi)
    pca_ratio = _ratio(put_amount, call_amount)
    cpa_ratio = _ratio(call_amount, put_amount)

    return {
        "strike_price": strike_price,
        "call_oi": f_call_oi,
        "call_change_in_oi": _clean_number(call_leg.get("change_in_oi")),
        "call_volume": _clean_number(call_leg.get("volume")),
        "call_iv": _clean_number(call_leg.get("iv")),
        "call_ltp": call_ltp,
        "call_bid_qty": _clean_number(call_leg.get("bid_qty")),
        "call_bid_price": _clean_number(call_leg.get("bid_price")),
        "call_ask_price": _clean_number(call_leg.get("ask_price")),
        "call_ask_qty": _clean_number(call_leg.get("ask_qty")),
        "put_bid_qty": _clean_number(put_leg.get("bid_qty")),
        "put_bid_price": _clean_number(put_leg.get("bid_price")),
        "put_ask_price": _clean_number(put_leg.get("ask_price")),
        "put_ask_qty": _clean_number(put_leg.get("ask_qty")),
        "put_ltp": put_ltp,
        "put_iv": _clean_number(put_leg.get("iv")),
        "put_volume": _clean_number(put_leg.get("volume")),
        "put_change_in_oi": _clean_number(put_leg.get("change_in_oi")),
        "put_oi": f_put_oi,
        "f_call_oi": f_call_oi,
        "f_put_oi": f_put_oi,
        "call_amount": call_amount,
        "put_amount": put_amount,
        "pcr": pcr,
        "cpr": cpr,
        "pca_ratio": pca_ratio,
        "cpa_ratio": cpa_ratio,
        "pca_total": put_amount + call_amount,
        "cpa_difference": call_amount - put_amount,
        "pcr_total": cpr + pcr,
        "cpa_total": cpa_ratio + pca_ratio,
        "st50": strike_price % 100,
    }


def get_live_option_contracts() -> list[dict[str, Any]]:
    kite = get_kite_client()
    _require_access_token()

    nifty_instruments = _get_option_instruments("NIFTY")
    banknifty_instruments = _get_option_instruments("BANKNIFTY")
    nifty_expiries = sorted({instrument["expiry"] for instrument in nifty_instruments if instrument.get("expiry")})
    banknifty_expiries = sorted({instrument["expiry"] for instrument in banknifty_instruments if instrument.get("expiry")})

    contract_specs = [
        {
            "id": "nifty-weekly",
            "label": "NIFTY Weekly",
            "underlying": "NIFTY",
            "expiry_type": "weekly",
            "expiry": _nearest_target_expiry(nifty_expiries, 3),
            "lot_size": LOT_SIZES["NIFTY"],
            "instruments": nifty_instruments,
        },
        {
            "id": "nifty-monthly",
            "label": "NIFTY Monthly",
            "underlying": "NIFTY",
            "expiry_type": "monthly",
            "expiry": _monthly_target_expiry(nifty_expiries, 3),
            "lot_size": LOT_SIZES["NIFTY"],
            "instruments": nifty_instruments,
        },
        {
            "id": "banknifty-monthly",
            "label": "BANKNIFTY Monthly",
            "underlying": "BANKNIFTY",
            "expiry_type": "monthly",
            "expiry": _monthly_target_expiry(banknifty_expiries, 2),
            "lot_size": LOT_SIZES["BANKNIFTY"],
            "instruments": banknifty_instruments,
        },
    ]

    spot_symbols = sorted({SUPPORTED_UNDERLYINGS[spec["underlying"]]["spot_symbol"] for spec in contract_specs})
    try:
        spot_quotes = kite.quote(spot_symbols)
    except TokenException as exc:
        _handle_token_exception(exc)
        raise ZerodhaClientError("Zerodha session expired. Complete login again.") from exc
    except Exception as exc:
        logger.exception("Failed to fetch spot quotes from Zerodha")
        raise ZerodhaClientError(f"Failed to fetch spot quotes: {exc}") from exc

    contracts: list[dict[str, Any]] = []
    for spec in contract_specs:
        selected_instruments = [
            instrument for instrument in spec["instruments"] if instrument.get("expiry") == spec["expiry"]
        ]
        grouped: dict[float, dict[str, dict[str, Any]]] = defaultdict(dict)
        for instrument in selected_instruments:
            grouped[float(instrument["strike"])][str(instrument["instrument_type"])] = instrument

        quote_symbols: list[str] = []
        quote_index: dict[str, tuple[float, str, dict[str, Any]]] = {}
        for strike_price, option_map in grouped.items():
            for option_type, instrument in option_map.items():
                symbol = f"{instrument['exchange']}:{instrument['tradingsymbol']}"
                quote_symbols.append(symbol)
                quote_index[symbol] = (strike_price, option_type, instrument)

        try:
            quotes = kite.quote(quote_symbols)
        except TokenException as exc:
            _handle_token_exception(exc)
            raise ZerodhaClientError("Zerodha session expired. Complete login again.") from exc
        except Exception as exc:
            logger.exception("Failed to fetch option quotes from Zerodha")
            raise ZerodhaClientError(f"Failed to fetch option quotes: {exc}") from exc

        spot_symbol = SUPPORTED_UNDERLYINGS[spec["underlying"]]["spot_symbol"]
        spot_ltp = _clean_number((spot_quotes.get(spot_symbol) or {}).get("last_price"))
        strike_rows: list[dict[str, float]] = []
        for strike_price in sorted(grouped.keys()):
            option_map = grouped[strike_price]
            call_instrument = option_map.get("CE")
            put_instrument = option_map.get("PE")
            if not call_instrument or not put_instrument:
                continue

            call_symbol = f"{call_instrument['exchange']}:{call_instrument['tradingsymbol']}"
            put_symbol = f"{put_instrument['exchange']}:{put_instrument['tradingsymbol']}"
            call_payload = quotes.get(call_symbol) or {}
            put_payload = quotes.get(put_symbol) or {}
            call_leg = _build_option_leg(
                call_payload,
                spot_ltp,
                strike_price,
                spec["expiry"],
                "CE",
                f"{spec['id']}:{call_symbol}",
            )
            put_leg = _build_option_leg(
                put_payload,
                spot_ltp,
                strike_price,
                spec["expiry"],
                "PE",
                f"{spec['id']}:{put_symbol}",
            )
            strike_rows.append(_contract_row(strike_price, call_leg, put_leg, spec["lot_size"]))

        differences = [float(row["cpa_difference"]) for row in strike_rows]
        total_call_oi = sum(float(row["f_call_oi"]) for row in strike_rows)
        total_put_oi = sum(float(row["f_put_oi"]) for row in strike_rows)
        contracts.append(
            {
                "id": spec["id"],
                "label": spec["label"],
                "underlying": spec["underlying"],
                "expiry_type": spec["expiry_type"],
                "expiry": spec["expiry"].isoformat(),
                "lot_size": spec["lot_size"],
                "spot_ltp": spot_ltp,
                "pcr": _ratio(total_put_oi, total_call_oi),
                "cpa_difference_min": min(differences) if differences else 0.0,
                "cpa_difference_max": max(differences) if differences else 0.0,
                "rows": strike_rows,
            }
        )

    return contracts
