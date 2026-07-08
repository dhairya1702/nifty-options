from __future__ import annotations

import argparse
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from statistics import mean
from typing import Any
from zoneinfo import ZoneInfo

from local_db import index_history_filtered, init_db, strategy_backtest_rows
from zerodha import LOT_SIZES


IST = ZoneInfo("Asia/Kolkata")
ENTRY_START = time(10, 0)
ENTRY_CUTOFF = time(14, 45)
SQUARE_OFF = time(15, 20)
TARGET_PCT = 0.50
STOP_LOSS_PCT = 0.20
SLIPPAGE_PCT = 0.01
SCORE_THRESHOLD = 70.0
CONFIRMATION_BARS = 2
STRIKE_STEPS = {"NIFTY": 50, "BANKNIFTY": 100}
SIGNAL_WIDTH_POINTS = {"NIFTY": 100, "BANKNIFTY": 200}
MAX_SPOT_AGE = timedelta(minutes=10)


@dataclass
class Trade:
    entry_timestamp: str
    exit_timestamp: str
    side: str
    strike_price: float
    quantity: int
    entry_price: float
    exit_price: float
    gross_pnl: float
    costs: float
    net_pnl: float
    pnl_pct: float
    exit_reason: str
    entry_score: float
    exit_score: float


@dataclass
class Position:
    entry_timestamp: str
    side: str
    strike_price: float
    quantity: int
    entry_ltp: float
    entry_price: float
    entry_cost: float
    entry_score: float


@dataclass
class BacktestResult:
    trades: list[Trade]
    signals: list[dict[str, Any]]
    raw_rows: int
    snapshot_timestamps: int
    entry_window_signals: int
    threshold_signals: int
    confirmed_entries: int
    skipped_missing_atm: int
    skipped_no_entry_window: int
    skipped_position_open: int
    skipped_unreliable_atm: int
    volume_rows: int
    index_matched_signals: int


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=IST)
    return parsed.astimezone(IST)


def _format_timestamp(value: str) -> str:
    return _parse_timestamp(value).strftime("%Y-%m-%d %H:%M")


def _trading_day(value: str) -> str:
    return _parse_timestamp(value).date().isoformat()


def _in_entry_window(value: str) -> bool:
    current_time = _parse_timestamp(value).time()
    return ENTRY_START <= current_time <= ENTRY_CUTOFF


def _is_square_off_time(value: str) -> bool:
    return _parse_timestamp(value).time() >= SQUARE_OFF


def _round_to_step(value: float, step: int) -> float:
    return float(round(value / step) * step)


def _safe_float(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        number = float(value)
        return number if math.isfinite(number) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _option_key(row: dict[str, Any]) -> tuple[float, str]:
    return (float(row["strike_price"]), str(row["option_type"]))


def _build_snapshots(rows: list[dict[str, Any]]) -> dict[str, dict[tuple[float, str], dict[str, Any]]]:
    snapshots: dict[str, dict[tuple[float, str], dict[str, Any]]] = defaultdict(dict)
    for row in rows:
        normalized = dict(row)
        normalized["strike_price"] = float(row["strike_price"])
        normalized["oi"] = _safe_float(row.get("oi"))
        normalized["ltp"] = _safe_float(row.get("ltp"))
        normalized["volume"] = _safe_float(row.get("volume"))
        snapshots[str(row["timestamp"])][_option_key(normalized)] = normalized
    return dict(snapshots)


def _spot_by_timestamp(underlying: str, from_timestamp: str | None, to_timestamp: str | None) -> dict[str, float]:
    points = index_history_filtered(underlying, from_timestamp=from_timestamp, to_timestamp=to_timestamp)
    return {str(point["timestamp"]): _safe_float(point.get("spot_ltp")) for point in points}


def _nearest_spot(timestamp: str, ordered_spots: list[tuple[str, float]], cursor: int) -> tuple[float | None, int, bool]:
    timestamp_dt = _parse_timestamp(timestamp)
    while cursor + 1 < len(ordered_spots) and _parse_timestamp(ordered_spots[cursor + 1][0]) <= timestamp_dt:
        cursor += 1
    if cursor >= 0:
        spot_timestamp, spot_ltp = ordered_spots[cursor]
        spot_dt = _parse_timestamp(spot_timestamp)
        if spot_dt.date() == timestamp_dt.date() and timedelta(0) <= timestamp_dt - spot_dt <= MAX_SPOT_AGE:
            return spot_ltp, cursor, True
    return None, cursor, False


def _strike_has_pair(snapshot: dict[tuple[float, str], dict[str, Any]], strike: float) -> bool:
    call = snapshot.get((strike, "CE"))
    put = snapshot.get((strike, "PE"))
    return bool(call and put and _safe_float(call.get("ltp")) > 0 and _safe_float(put.get("ltp")) > 0)


def _fallback_atm_strike(snapshot: dict[tuple[float, str], dict[str, Any]], step: int) -> float | None:
    strikes = sorted({strike for strike, _ in snapshot.keys()})
    if not strikes:
        return None
    lower_guard = strikes[0] + (len(strikes) * 0.2 * step)
    upper_guard = strikes[-1] - (len(strikes) * 0.2 * step)
    pairs: list[tuple[float, float]] = []
    for strike in strikes:
        call_ltp = snapshot.get((strike, "CE"), {}).get("ltp")
        put_ltp = snapshot.get((strike, "PE"), {}).get("ltp")
        if call_ltp is not None and put_ltp is not None and lower_guard <= strike <= upper_guard:
            pairs.append((abs(_safe_float(call_ltp) - _safe_float(put_ltp)), strike))
    if pairs:
        return min(pairs)[1]
    return None


def _fee_estimate(turnover: float) -> float:
    brokerage = min(20.0, turnover * 0.0003)
    stt = turnover * 0.000625
    exchange = turnover * 0.00053
    sebi = turnover * 0.000001
    gst = 0.18 * (brokerage + exchange + sebi)
    stamp = turnover * 0.00003
    return brokerage + stt + exchange + sebi + gst + stamp


def _leg_delta(
    snapshot: dict[tuple[float, str], dict[str, Any]],
    previous: dict[tuple[float, str], dict[str, Any]] | None,
    strike: float,
    option_type: str,
    field: str,
) -> float:
    current_value = _safe_float(snapshot.get((strike, option_type), {}).get(field))
    previous_value = _safe_float((previous or {}).get((strike, option_type), {}).get(field))
    return current_value - previous_value


def _signal_strikes(atm_strike: float, width_points: int, step: int) -> list[float]:
    steps = max(0, int(width_points / step))
    return [atm_strike + (offset * step) for offset in range(-steps, steps + 1)]


def _range_delta_totals(
    snapshot: dict[tuple[float, str], dict[str, Any]],
    previous: dict[tuple[float, str], dict[str, Any]] | None,
    strikes: list[float],
) -> tuple[float, float]:
    call_delta = sum(_leg_delta(snapshot, previous, strike, "CE", "oi") for strike in strikes)
    put_delta = sum(_leg_delta(snapshot, previous, strike, "PE", "oi") for strike in strikes)
    return call_delta, put_delta


def _range_delta_pcr(call_delta: float, put_delta: float) -> float:
    if call_delta <= 0:
        return 0.0
    return max(0.0, min(put_delta / call_delta, 3.0))


def _score_signal(
    timestamp: str,
    snapshot: dict[tuple[float, str], dict[str, Any]],
    previous: dict[tuple[float, str], dict[str, Any]] | None,
    previous_spot: float | None,
    spot: float | None,
    atm_strike: float,
    step: int,
    signal_width: int,
) -> dict[str, Any]:
    ce = snapshot.get((atm_strike, "CE"))
    pe = snapshot.get((atm_strike, "PE"))
    if not ce or not pe or ce["ltp"] <= 0 or pe["ltp"] <= 0:
        missing_reason = "missing_atm_leg" if not ce or not pe else "missing_atm_ltp"
        return {
            "timestamp": timestamp,
            "action": "wait",
            "score": 0.0,
            "ce_score": 0.0,
            "pe_score": 0.0,
            "oi_score": 0.0,
            "pcr_score": 0.0,
            "ltp_score": 0.0,
            "index_score": 0.0,
            "volume_score": 0.0,
            "atm_strike": atm_strike,
            "delta_pcr": 0.0,
            "spot": spot,
            "spot_delta": 0.0,
            "call_oi_delta": 0.0,
            "put_oi_delta": 0.0,
            "call_ltp_delta": 0.0,
            "put_ltp_delta": 0.0,
            "call_volume_delta": 0.0,
            "put_volume_delta": 0.0,
            "skip_reason": missing_reason,
        }

    strikes = _signal_strikes(atm_strike, signal_width, step)
    call_oi_delta, put_oi_delta = _range_delta_totals(snapshot, previous, strikes)
    call_ltp_delta = _leg_delta(snapshot, previous, atm_strike, "CE", "ltp")
    put_ltp_delta = _leg_delta(snapshot, previous, atm_strike, "PE", "ltp")
    call_volume_delta = _leg_delta(snapshot, previous, atm_strike, "CE", "volume")
    put_volume_delta = _leg_delta(snapshot, previous, atm_strike, "PE", "volume")
    delta_pcr = _range_delta_pcr(call_oi_delta, put_oi_delta)
    spot_delta = spot - previous_spot if spot is not None and previous_spot is not None else 0.0

    ce_components = {"oi": 0.0, "pcr": 0.0, "ltp": 0.0, "index": 0.0, "volume": 0.0}
    pe_components = {"oi": 0.0, "pcr": 0.0, "ltp": 0.0, "index": 0.0, "volume": 0.0}

    if call_oi_delta > 0:
        ce_components["oi"] += 18
    if put_oi_delta < 0:
        ce_components["oi"] += 12
    if put_oi_delta > 0:
        pe_components["oi"] += 18
    if call_oi_delta < 0:
        pe_components["oi"] += 12

    if delta_pcr >= 1.2:
        ce_components["pcr"] += 20
    elif delta_pcr <= 0.8 and delta_pcr > 0:
        pe_components["pcr"] += 20
    else:
        ce_components["pcr"] += 6
        pe_components["pcr"] += 6

    if call_ltp_delta > 0:
        ce_components["ltp"] += 20
    if put_ltp_delta > 0:
        pe_components["ltp"] += 20

    if spot_delta > 0:
        ce_components["index"] += 15
    elif spot_delta < 0:
        pe_components["index"] += 15

    if call_volume_delta > 0 and call_volume_delta >= put_volume_delta:
        ce_components["volume"] += 15
    if put_volume_delta > 0 and put_volume_delta >= call_volume_delta:
        pe_components["volume"] += 15

    ce_score = sum(ce_components.values())
    pe_score = sum(pe_components.values())

    action = "wait"
    score = max(ce_score, pe_score)
    selected_components = ce_components if ce_score >= pe_score else pe_components
    if ce_score >= SCORE_THRESHOLD and ce_score > pe_score:
        action = "CE"
        score = ce_score
        selected_components = ce_components
    elif pe_score >= SCORE_THRESHOLD and pe_score > ce_score:
        action = "PE"
        score = pe_score
        selected_components = pe_components

    return {
        "timestamp": timestamp,
        "action": action,
        "score": round(score, 2),
        "ce_score": round(ce_score, 2),
        "pe_score": round(pe_score, 2),
        "oi_score": round(selected_components["oi"], 2),
        "pcr_score": round(selected_components["pcr"], 2),
        "ltp_score": round(selected_components["ltp"], 2),
        "index_score": round(selected_components["index"], 2),
        "volume_score": round(selected_components["volume"], 2),
        "atm_strike": atm_strike,
        "delta_pcr": round(delta_pcr, 4),
        "call_oi_delta": call_oi_delta,
        "put_oi_delta": put_oi_delta,
        "call_ltp_delta": call_ltp_delta,
        "put_ltp_delta": put_ltp_delta,
        "call_volume_delta": call_volume_delta,
        "put_volume_delta": put_volume_delta,
        "spot": spot,
        "spot_delta": spot_delta,
        "skip_reason": "",
    }


def _exit_trade(
    position: Position,
    timestamp: str,
    exit_ltp: float,
    exit_reason: str,
    exit_score: float,
) -> Trade:
    exit_price = exit_ltp * (1.0 - SLIPPAGE_PCT)
    gross_pnl = (exit_price - position.entry_price) * position.quantity
    exit_cost = _fee_estimate(exit_price * position.quantity)
    costs = position.entry_cost + exit_cost
    net_pnl = gross_pnl - costs
    pnl_pct = (exit_price - position.entry_price) / position.entry_price if position.entry_price else 0.0
    return Trade(
        entry_timestamp=position.entry_timestamp,
        exit_timestamp=timestamp,
        side=position.side,
        strike_price=position.strike_price,
        quantity=position.quantity,
        entry_price=round(position.entry_price, 2),
        exit_price=round(exit_price, 2),
        gross_pnl=round(gross_pnl, 2),
        costs=round(costs, 2),
        net_pnl=round(net_pnl, 2),
        pnl_pct=round(pnl_pct * 100, 2),
        exit_reason=exit_reason,
        entry_score=position.entry_score,
        exit_score=exit_score,
    )


def run_backtest(args: argparse.Namespace) -> BacktestResult:
    underlying = args.underlying.upper()
    rows = strategy_backtest_rows(
        underlying,
        from_timestamp=args.from_timestamp,
        to_timestamp=args.to_timestamp,
        limit=args.limit,
    )
    snapshots = _build_snapshots(rows)
    timestamps = sorted(snapshots.keys(), key=_parse_timestamp)
    spot_map = _spot_by_timestamp(underlying, args.from_timestamp, args.to_timestamp)
    ordered_spots = sorted(spot_map.items(), key=lambda item: _parse_timestamp(item[0]))
    spot_cursor = -1
    step = STRIKE_STEPS.get(underlying, 50)
    signal_width = args.signal_width_points or SIGNAL_WIDTH_POINTS.get(underlying, step * 2)
    lot_size = LOT_SIZES.get(underlying, 1)
    quantity = lot_size * args.lots

    trades: list[Trade] = []
    signals: list[dict[str, Any]] = []
    position: Position | None = None
    previous_snapshot: dict[tuple[float, str], dict[str, Any]] | None = None
    previous_spot: float | None = None
    confirmation_side: str | None = None
    confirmation_count = 0
    exit_flip_side: str | None = None
    exit_flip_count = 0
    current_day: str | None = None
    entry_window_signals = 0
    threshold_signals = 0
    confirmed_entries = 0
    skipped_missing_atm = 0
    skipped_no_entry_window = 0
    skipped_position_open = 0
    skipped_unreliable_atm = 0
    index_matched_signals = 0
    volume_rows = sum(1 for row in rows if _safe_float(row.get("volume")) > 0)

    for timestamp in timestamps:
        day = _trading_day(timestamp)
        if current_day != day:
            current_day = day
            confirmation_side = None
            confirmation_count = 0
            exit_flip_side = None
            exit_flip_count = 0
            previous_snapshot = None
            previous_spot = None

        snapshot = snapshots[timestamp]
        exact_spot = spot_map.get(timestamp)
        if exact_spot:
            spot = exact_spot
            spot_matched = True
        else:
            spot, spot_cursor, spot_matched = _nearest_spot(timestamp, ordered_spots, spot_cursor)
        atm_strike = _round_to_step(spot, step) if spot else _fallback_atm_strike(snapshot, step)
        if atm_strike is None:
            skipped_unreliable_atm += 1
            previous_snapshot = snapshot
            previous_spot = spot
            continue
        if not _strike_has_pair(snapshot, atm_strike):
            skipped_missing_atm += 1
            previous_snapshot = snapshot
            previous_spot = spot
            signals.append(
                {
                    "timestamp": timestamp,
                    "action": "wait",
                    "score": 0.0,
                    "ce_score": 0.0,
                    "pe_score": 0.0,
                    "oi_score": 0.0,
                    "pcr_score": 0.0,
                    "ltp_score": 0.0,
                    "index_score": 0.0,
                    "volume_score": 0.0,
                    "atm_strike": atm_strike,
                    "delta_pcr": 0.0,
                    "spot": spot,
                    "spot_delta": 0.0,
                    "call_oi_delta": 0.0,
                    "put_oi_delta": 0.0,
                    "call_ltp_delta": 0.0,
                    "put_ltp_delta": 0.0,
                    "call_volume_delta": 0.0,
                    "put_volume_delta": 0.0,
                    "skip_reason": "missing_atm_pair",
                }
            )
            continue
        if spot_matched:
            index_matched_signals += 1

        signal = _score_signal(timestamp, snapshot, previous_snapshot, previous_spot, spot, atm_strike, step, signal_width)
        signals.append(signal)
        if signal.get("skip_reason"):
            skipped_missing_atm += 1
        if _in_entry_window(timestamp):
            entry_window_signals += 1
        if signal["action"] in {"CE", "PE"} and float(signal["score"]) >= SCORE_THRESHOLD:
            threshold_signals += 1

        if position:
            current_leg = snapshot.get((position.strike_price, position.side))
            current_ltp = _safe_float(current_leg.get("ltp")) if current_leg else 0.0
            exit_reason = ""
            if current_ltp > 0:
                if current_ltp >= position.entry_ltp * (1.0 + TARGET_PCT):
                    exit_reason = "target"
                elif current_ltp <= position.entry_ltp * (1.0 - STOP_LOSS_PCT):
                    exit_reason = "stop_loss"
                elif signal["action"] != "wait" and signal["action"] != position.side and signal["score"] >= SCORE_THRESHOLD:
                    if exit_flip_side == signal["action"]:
                        exit_flip_count += 1
                    else:
                        exit_flip_side = str(signal["action"])
                        exit_flip_count = 1
                    if exit_flip_count >= CONFIRMATION_BARS:
                        exit_reason = "signal_flip_confirmed"
                elif _is_square_off_time(timestamp):
                    exit_reason = "square_off"
                else:
                    exit_flip_side = None
                    exit_flip_count = 0

            if exit_reason and current_ltp > 0:
                trades.append(_exit_trade(position, timestamp, current_ltp, exit_reason, float(signal["score"])))
                position = None
                confirmation_side = None
                confirmation_count = 0
                exit_flip_side = None
                exit_flip_count = 0

        if not position and _in_entry_window(timestamp) and signal["action"] in {"CE", "PE"}:
            if confirmation_side == signal["action"]:
                confirmation_count += 1
            else:
                confirmation_side = str(signal["action"])
                confirmation_count = 1

            if confirmation_count >= CONFIRMATION_BARS:
                entry_leg = snapshot.get((atm_strike, str(signal["action"])))
                entry_ltp = _safe_float(entry_leg.get("ltp")) if entry_leg else 0.0
                if entry_ltp > 0:
                    entry_price = entry_ltp * (1.0 + SLIPPAGE_PCT)
                    entry_cost = _fee_estimate(entry_price * quantity)
                    position = Position(
                        entry_timestamp=timestamp,
                        side=str(signal["action"]),
                        strike_price=atm_strike,
                        quantity=quantity,
                        entry_ltp=entry_ltp,
                        entry_price=entry_price,
                        entry_cost=entry_cost,
                        entry_score=float(signal["score"]),
                    )
                    confirmed_entries += 1
                    confirmation_side = None
                    confirmation_count = 0
        elif position and signal["action"] in {"CE", "PE"}:
            skipped_position_open += 1
        elif not _in_entry_window(timestamp) and signal["action"] in {"CE", "PE"}:
            skipped_no_entry_window += 1
        elif signal["action"] == "wait":
            confirmation_side = None
            confirmation_count = 0

        previous_snapshot = snapshot
        previous_spot = spot

    if position and timestamps:
        last_snapshot = snapshots[timestamps[-1]]
        current_leg = last_snapshot.get((position.strike_price, position.side))
        current_ltp = _safe_float(current_leg.get("ltp")) if current_leg else position.entry_ltp
        trades.append(_exit_trade(position, timestamps[-1], current_ltp, "end_of_data", 0.0))

    return BacktestResult(
        trades=trades,
        signals=signals,
        raw_rows=len(rows),
        snapshot_timestamps=len(timestamps),
        entry_window_signals=entry_window_signals,
        threshold_signals=threshold_signals,
        confirmed_entries=confirmed_entries,
        skipped_missing_atm=skipped_missing_atm,
        skipped_no_entry_window=skipped_no_entry_window,
        skipped_position_open=skipped_position_open,
        skipped_unreliable_atm=skipped_unreliable_atm,
        volume_rows=volume_rows,
        index_matched_signals=index_matched_signals,
    )


def _print_report(args: argparse.Namespace, result: BacktestResult) -> None:
    trades = result.trades
    signals = result.signals
    total_pnl = sum(trade.net_pnl for trade in trades)
    wins = [trade for trade in trades if trade.net_pnl > 0]
    losses = [trade for trade in trades if trade.net_pnl <= 0]
    capital = float(args.capital)
    win_rate = (len(wins) / len(trades) * 100) if trades else 0.0
    return_pct = (total_pnl / capital * 100) if capital else 0.0

    print("Strategy Backtest")
    print(f"Underlying: {args.underlying.upper()}")
    print(f"Signal strike band: ATM +/- {args.signal_width_points or SIGNAL_WIDTH_POINTS.get(args.underlying.upper(), STRIKE_STEPS.get(args.underlying.upper(), 50) * 2)} points")
    print(f"Raw option rows loaded: {result.raw_rows}")
    print(f"Snapshot timestamps loaded: {result.snapshot_timestamps}")
    print(f"Signal timestamps tested: {len(signals)}")
    print(f"Trades: {len(trades)} | Wins: {len(wins)} | Losses: {len(losses)} | Win rate: {win_rate:.2f}%")
    print(f"Net PnL: {total_pnl:.2f} | Return on capital: {return_pct:.2f}%")
    print(f"Avg win: {(mean([trade.net_pnl for trade in wins]) if wins else 0.0):.2f}")
    print(f"Avg loss: {(mean([trade.net_pnl for trade in losses]) if losses else 0.0):.2f}")
    print("")

    volume_pct = (result.volume_rows / result.raw_rows * 100) if result.raw_rows else 0.0
    index_pct = (result.index_matched_signals / len(signals) * 100) if signals else 0.0
    print("Diagnostics")
    print(f"Entry-window signals: {result.entry_window_signals}")
    print(f"Threshold signals: {result.threshold_signals}")
    print(f"Confirmed entries: {result.confirmed_entries}")
    print(f"Signals skipped for missing ATM data: {result.skipped_missing_atm}")
    print(f"Timestamps skipped for unreliable ATM: {result.skipped_unreliable_atm}")
    print(f"Threshold signals after entry cutoff: {result.skipped_no_entry_window}")
    print(f"Threshold signals skipped while position open: {result.skipped_position_open}")
    print(f"Rows with volume: {result.volume_rows}/{result.raw_rows} ({volume_pct:.1f}%)")
    print(f"Signals with matched index spot: {result.index_matched_signals}/{len(signals)} ({index_pct:.1f}%)")
    print("")

    daily: dict[str, dict[str, float]] = defaultdict(lambda: {"signals": 0, "trades": 0, "pnl": 0.0})
    for signal in signals:
        daily[_trading_day(str(signal["timestamp"]))]["signals"] += 1
    for trade in trades:
        row = daily[_trading_day(trade.entry_timestamp)]
        row["trades"] += 1
        row["pnl"] += trade.net_pnl

    print("Daily summary")
    print("day        signals trades pnl")
    for day in sorted(daily.keys())[-args.show_days :]:
        row = daily[day]
        print(f"{day} {int(row['signals']):7d} {int(row['trades']):6d} {row['pnl']:8.2f}")
    print("")

    print("Recent signals")
    print("time              act score ce    pe    oi pcr ltp idx vol atm     dPCR   spot_d  callOI   putOI")
    for signal in signals[-args.show_signals :]:
        print(
            f"{_format_timestamp(signal['timestamp']):16} "
            f"{signal['action']:>3} "
            f"{float(signal['score']):5.1f} "
            f"{float(signal['ce_score']):5.1f} "
            f"{float(signal['pe_score']):5.1f} "
            f"{float(signal.get('oi_score') or 0):4.0f} "
            f"{float(signal.get('pcr_score') or 0):3.0f} "
            f"{float(signal.get('ltp_score') or 0):3.0f} "
            f"{float(signal.get('index_score') or 0):3.0f} "
            f"{float(signal.get('volume_score') or 0):3.0f} "
            f"{float(signal.get('atm_strike') or 0):7.0f} "
            f"{float(signal.get('delta_pcr') or 0):6.2f} "
            f"{float(signal.get('spot_delta') or 0):8.2f} "
            f"{float(signal.get('call_oi_delta') or 0):7.0f} "
            f"{float(signal.get('put_oi_delta') or 0):7.0f}"
        )

    print("")
    print("Trades")
    if not trades:
        print("No trades matched the configured rules.")
        return
    print("entry            exit             side strike qty entry exit  pnl    pnl% reason")
    for trade in trades[-args.show_trades :]:
        print(
            f"{_format_timestamp(trade.entry_timestamp):16} "
            f"{_format_timestamp(trade.exit_timestamp):16} "
            f"{trade.side:>2} "
            f"{trade.strike_price:6.0f} "
            f"{trade.quantity:3d} "
            f"{trade.entry_price:5.1f} "
            f"{trade.exit_price:5.1f} "
            f"{trade.net_pnl:7.2f} "
            f"{trade.pnl_pct:6.2f} "
            f"{trade.exit_reason}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local intraday ATM option strategy backtest.")
    parser.add_argument("--underlying", choices=["NIFTY", "BANKNIFTY"], required=True)
    parser.add_argument("--capital", type=float, default=100000.0)
    parser.add_argument("--lots", type=int, default=1)
    parser.add_argument("--from", dest="from_timestamp", default=None, help="Inclusive ISO timestamp lower bound.")
    parser.add_argument("--to", dest="to_timestamp", default=None, help="Inclusive ISO timestamp upper bound.")
    parser.add_argument("--limit", type=int, default=None, help="Use only the latest N snapshot timestamps.")
    parser.add_argument("--show-trades", type=int, default=50)
    parser.add_argument("--show-signals", type=int, default=20)
    parser.add_argument("--show-days", type=int, default=20)
    parser.add_argument("--signal-width-points", type=int, default=None, help="Signal strike band around ATM. Defaults to 100 for NIFTY and 200 for BANKNIFTY.")
    return parser.parse_args()


def main() -> None:
    init_db()
    args = parse_args()
    result = run_backtest(args)
    _print_report(args, result)


if __name__ == "__main__":
    main()
