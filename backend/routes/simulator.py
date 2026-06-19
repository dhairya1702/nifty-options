from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

from local_db import pcr_history_filtered, snapshot_rows
from zerodha import LOT_SIZES, SUPPORTED_UNDERLYINGS


router = APIRouter(prefix="/simulator", tags=["simulator"])
IST = ZoneInfo("Asia/Kolkata")
DEFAULT_ENTRY_START = time(10, 30)
DEFAULT_ENTRY_CUTOFF = time(15, 0)
DEFAULT_SQUARE_OFF = time(15, 20)


def _estimate_fees(notional: float) -> float:
    return round(max(12.0, notional * 0.0005), 2)


def _round(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


def _group_snapshot(timestamp: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[float, dict[str, float]] = defaultdict(
        lambda: {
            "strike_price": 0.0,
            "call_oi": 0.0,
            "put_oi": 0.0,
            "call_ltp": 0.0,
            "put_ltp": 0.0,
        }
    )

    for row in rows:
        strike = float(row["strike_price"])
        item = grouped[strike]
        item["strike_price"] = strike
        if row["option_type"] == "CE":
            item["call_oi"] = float(row["oi"] or 0.0)
            item["call_ltp"] = float(row["ltp"] or 0.0)
        elif row["option_type"] == "PE":
            item["put_oi"] = float(row["oi"] or 0.0)
            item["put_ltp"] = float(row["ltp"] or 0.0)

    strikes = sorted(grouped.values(), key=lambda item: item["strike_price"])
    reference = max(strikes, key=lambda item: item["call_oi"] + item["put_oi"])["strike_price"] if strikes else None
    return {"timestamp": timestamp, "strikes": strikes, "reference_strike": reference}


def _compute_signal(
    current: dict[str, Any],
    previous: dict[str, Any] | None,
    *,
    min_pcr_sma_gap: float,
    min_oi_bias_ratio: float,
) -> tuple[str, str]:
    pcr = float(current["pcr"])
    pcr_sma = current.get("pcr_sma")
    if pcr_sma is None or previous is None:
        return "wait", "Need enough history for SMA and prior OI comparison."

    pcr_change = pcr - float(previous["pcr"])
    pcr_gap = pcr - float(pcr_sma)
    oi_bias = float(current["total_put_oi"]) - float(previous["total_put_oi"]) - (
        float(current["total_call_oi"]) - float(previous["total_call_oi"])
    )
    total_oi = max(float(current["total_put_oi"]) + float(current["total_call_oi"]), 1.0)
    oi_bias_ratio = abs(oi_bias) / total_oi

    if abs(pcr_gap) < min_pcr_sma_gap:
        return "wait", f"PCR/SMA gap {abs(pcr_gap):.4f} is below the {min_pcr_sma_gap:.4f} threshold."

    if oi_bias_ratio < min_oi_bias_ratio:
        return "wait", f"OI bias {oi_bias_ratio:.2%} is below the {min_oi_bias_ratio:.2%} threshold."

    if pcr_gap > 0 and pcr_change > 0 and oi_bias > 0:
        return "buy_ce", f"PCR {pcr:.4f} is above SMA {float(pcr_sma):.4f} with positive OI bias."

    if pcr_gap < 0 and pcr_change < 0 and oi_bias < 0:
        return "buy_pe", f"PCR {pcr:.4f} is below SMA {float(pcr_sma):.4f} with negative OI bias."

    return "wait", "PCR and OI bias are not aligned."


def _confirmed_action(signals: list[str], confirmation_bars: int) -> str:
    if confirmation_bars <= 1:
        return signals[-1] if signals else "wait"
    if len(signals) < confirmation_bars:
        return "wait"
    recent = signals[-confirmation_bars:]
    first = recent[0]
    if first == "wait":
        return "wait"
    return first if all(action == first for action in recent) else "wait"


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=IST)
    return parsed.astimezone(IST)


def _close_position(
    *,
    cash: float,
    position: dict[str, Any],
    current: dict[str, Any],
    exit_price: float,
    bars_held: int,
    exit_reason: str,
    trades: list[dict[str, Any]],
) -> tuple[float, None]:
    exit_fees = _estimate_fees(exit_price * position["quantity"])
    gross_exit_value = exit_price * position["quantity"]
    proceeds = gross_exit_value - exit_fees
    pnl = _round(proceeds - float(position["entry_notional"]) - float(position["entry_fees"]))
    pnl_pct = _round(
        ((exit_price - float(position["entry_price"])) / float(position["entry_price"]) * 100.0)
        if position["entry_price"]
        else 0.0
    )
    cash = _round(cash + proceeds)
    trades.append(
        {
            "entry_timestamp": position["entry_timestamp"],
            "exit_timestamp": current["timestamp"],
            "side": position["side"],
            "strike_price": position["strike_price"],
            "quantity": position["quantity"],
            "entry_price": _round(position["entry_price"]),
            "exit_price": _round(exit_price),
            "entry_fees": _round(position["entry_fees"]),
            "exit_fees": _round(exit_fees),
            "bars_held": bars_held,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "entry_signal": position["entry_signal"],
            "exit_reason": exit_reason,
            "trading_day": position["trading_day"],
        }
    )
    return cash, None


def _record_day_trade(day_summary: dict[str, Any], trade: dict[str, Any], capital: float, daily_profit_lock_pct: float, daily_loss_limit_pct: float) -> None:
    day_summary["trades"] += 1
    day_summary["realized_pnl"] = _round(float(day_summary["realized_pnl"]) + float(trade["pnl"]))
    if float(trade["pnl"]) > 0:
        day_summary["wins"] += 1
    elif float(trade["pnl"]) < 0:
        day_summary["losses"] += 1
    if float(day_summary["realized_pnl"]) >= capital * daily_profit_lock_pct:
        day_summary["locked_reason"] = "daily_profit_lock"
    elif float(day_summary["realized_pnl"]) <= -capital * daily_loss_limit_pct:
        day_summary["locked_reason"] = "daily_loss_limit"


@router.get("/backtest")
def simulator_backtest(
    underlying: str = Query("NIFTY"),
    capital: float = Query(100000.0, ge=1000.0, le=10000000.0),
    limit: int = Query(160, ge=30, le=1000),
    sma_period: int = Query(8, ge=2, le=50),
    profit_target_pct: float = Query(0.18, ge=0.01, le=1.0),
    stop_loss_pct: float = Query(0.06, ge=0.01, le=1.0),
    max_hold_bars: int = Query(3, ge=1, le=50),
    lot_multiplier: int = Query(1, ge=1, le=25),
    max_trades_per_day: int = Query(20, ge=1, le=20),
    daily_profit_lock_pct: float = Query(0.25, ge=0.001, le=1.0),
    daily_loss_limit_pct: float = Query(0.10, ge=0.001, le=1.0),
    confirmation_bars: int = Query(1, ge=1, le=5),
    cooldown_bars: int = Query(1, ge=0, le=20),
    min_pcr_sma_gap: float = Query(0.006, ge=0.0, le=1.0),
    min_oi_bias_ratio: float = Query(0.0025, ge=0.0, le=1.0),
    min_entry_price: float = Query(45.0, ge=0.0, le=10000.0),
) -> dict[str, Any]:
    normalized = underlying.upper()
    if normalized not in SUPPORTED_UNDERLYINGS:
        raise HTTPException(status_code=400, detail=f"Unsupported underlying: {underlying}")

    pcr_rows = pcr_history_filtered(normalized, limit=limit)
    if len(pcr_rows) < max(10, sma_period + 2):
        raise HTTPException(status_code=400, detail="Not enough historical PCR rows to run the backtest.")

    timeline: list[dict[str, Any]] = []
    rolling_values: list[float] = []

    for index, row in enumerate(pcr_rows):
        timestamp = str(row["timestamp"])
        grouped_snapshot = _group_snapshot(timestamp, snapshot_rows(normalized, timestamp))
        if not grouped_snapshot["strikes"]:
            continue

        rolling_values.append(float(row["pcr"]))
        if len(rolling_values) > sma_period:
            rolling_values.pop(0)

        current = {
            "timestamp": timestamp,
            "dt_ist": _parse_timestamp(timestamp),
            "pcr": float(row["pcr"]),
            "total_call_oi": float(row["total_call_oi"]),
            "total_put_oi": float(row["total_put_oi"]),
            "pcr_sma": _round(sum(rolling_values) / sma_period, 4) if len(rolling_values) == sma_period else None,
            "snapshot": grouped_snapshot,
            "index": index,
        }
        timeline.append(current)

    if len(timeline) < max(10, sma_period + 2):
        raise HTTPException(status_code=400, detail="Not enough snapshot rows aligned with PCR history to run the backtest.")

    lot_size = LOT_SIZES.get(normalized, 1)
    cash = float(capital)
    position: dict[str, Any] | None = None
    trades: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []
    signal_points: list[dict[str, Any]] = []
    day_summaries: dict[str, dict[str, Any]] = {}
    raw_actions: list[str] = []
    last_exit_index: int | None = None

    for index, current in enumerate(timeline):
        trading_day = current["dt_ist"].date().isoformat()
        current_time = current["dt_ist"].time()
        day_summary = day_summaries.setdefault(
            trading_day,
            {
                "trading_day": trading_day,
                "trades": 0,
                "realized_pnl": 0.0,
                "wins": 0,
                "losses": 0,
                "locked_reason": None,
            },
        )
        previous = timeline[index - 1] if index > 0 else None
        raw_action, signal_reason = _compute_signal(
            current,
            previous,
            min_pcr_sma_gap=min_pcr_sma_gap,
            min_oi_bias_ratio=min_oi_bias_ratio,
        )
        raw_actions.append(raw_action)
        action = _confirmed_action(raw_actions, confirmation_bars)
        if raw_action != "wait" and action == "wait":
            signal_reason = f"Waiting for {confirmation_bars} confirming bars. Latest raw signal: {raw_action}."

        if position is not None and position["trading_day"] != trading_day:
            closed_day = position["trading_day"]
            previous_point = previous if previous is not None else current
            mark_row = next(
                (row for row in previous_point["snapshot"]["strikes"] if float(row["strike_price"]) == float(position["strike_price"])),
                None,
            )
            mark_key = "call_ltp" if position["side"] == "CE" else "put_ltp"
            mark_price = float(mark_row.get(mark_key) or 0.0) if mark_row else 0.0
            if mark_price > 0:
                cash, position = _close_position(
                    cash=cash,
                    position=position,
                    current=previous_point,
                    exit_price=mark_price,
                    bars_held=int(previous_point["index"]) - int(position["entry_index"]),
                    exit_reason="day_end_square_off",
                    trades=trades,
                )
                _record_day_trade(
                    day_summaries[closed_day],
                    trades[-1],
                    capital,
                    daily_profit_lock_pct,
                    daily_loss_limit_pct,
                )

        signal_points.append(
            {
                "timestamp": current["timestamp"],
                "action": action,
                "raw_action": raw_action,
                "pcr": current["pcr"],
                "pcr_sma": current["pcr_sma"],
                "reason": signal_reason,
                "trading_day": trading_day,
            }
        )

        if position is not None:
            side_key = "call_ltp" if position["side"] == "CE" else "put_ltp"
            current_row = next(
                (row for row in current["snapshot"]["strikes"] if float(row["strike_price"]) == float(position["strike_price"])),
                None,
            )
            current_ltp = float(current_row.get(side_key) or 0.0) if current_row else 0.0
            current_return_pct = (current_ltp - float(position["entry_price"])) / float(position["entry_price"]) if position["entry_price"] else 0.0
            bars_held = index - int(position["entry_index"])
            target_price = float(position["entry_price"]) * (1.0 + profit_target_pct)
            stop_price = float(position["entry_price"]) * (1.0 - stop_loss_pct)

            exit_reason: str | None = None
            exit_price: float | None = None
            if current_ltp <= 0:
                exit_reason = "missing_price"
            elif current_ltp >= target_price:
                exit_reason = "target_hit"
                exit_price = target_price
            elif current_ltp <= stop_price:
                exit_reason = "stop_hit"
                exit_price = stop_price
            elif action == "buy_ce" and position["side"] == "PE":
                exit_reason = "signal_flip"
                exit_price = current_ltp
            elif action == "buy_pe" and position["side"] == "CE":
                exit_reason = "signal_flip"
                exit_price = current_ltp
            elif bars_held >= max_hold_bars:
                exit_reason = "max_hold"
                exit_price = current_ltp
            elif current_time >= DEFAULT_SQUARE_OFF:
                exit_reason = "day_end_square_off"
                exit_price = current_ltp
            elif index == len(timeline) - 1:
                exit_reason = "day_end_square_off"
                exit_price = current_ltp

            if exit_reason and (exit_price or 0) > 0:
                position_day = position["trading_day"]
                cash, position = _close_position(
                    cash=cash,
                    position=position,
                    current=current,
                    exit_price=float(exit_price),
                    bars_held=bars_held,
                    exit_reason=exit_reason,
                    trades=trades,
                )
                _record_day_trade(
                    day_summaries[position_day],
                    trades[-1],
                    capital,
                    daily_profit_lock_pct,
                    daily_loss_limit_pct,
                )
                last_exit_index = index

        day_locked = day_summary["locked_reason"] in {"daily_profit_lock", "daily_loss_limit", "max_trades_reached", "entry_cutoff_passed"}
        cooldown_active = last_exit_index is not None and index - last_exit_index <= cooldown_bars
        if position is None and action in {"buy_ce", "buy_pe"} and index < len(timeline) - 1 and not day_locked and not cooldown_active:
            reference = current["snapshot"]["reference_strike"]
            side = "CE" if action == "buy_ce" else "PE"
            side_key = "call_ltp" if side == "CE" else "put_ltp"
            entry_row = next(
                (row for row in current["snapshot"]["strikes"] if float(row["strike_price"]) == float(reference)),
                None,
            )
            entry_price = float(entry_row.get(side_key) or 0.0) if entry_row else 0.0
            quantity = lot_size * lot_multiplier
            entry_notional = entry_price * quantity
            entry_fees = _estimate_fees(entry_notional)

            if day_summary["trades"] >= max_trades_per_day:
                day_summary["locked_reason"] = "max_trades_reached"
            elif current_time < DEFAULT_ENTRY_START:
                if day_summary["trades"] == 0 and day_summary["realized_pnl"] == 0:
                    day_summary["locked_reason"] = "observation_window"
            elif current_time >= DEFAULT_ENTRY_CUTOFF:
                day_summary["locked_reason"] = day_summary["locked_reason"] or "entry_cutoff_passed"
            elif entry_price < min_entry_price:
                pass
            elif reference is not None and entry_price > 0 and cash >= entry_notional + entry_fees:
                cash = _round(cash - entry_notional - entry_fees)
                if day_summary["locked_reason"] == "observation_window":
                    day_summary["locked_reason"] = None
                position = {
                    "side": side,
                    "strike_price": float(reference),
                    "quantity": quantity,
                    "entry_price": float(entry_price),
                    "entry_timestamp": current["timestamp"],
                    "entry_notional": float(entry_notional),
                    "entry_fees": float(entry_fees),
                    "entry_index": index,
                    "entry_signal": signal_reason,
                    "trading_day": trading_day,
                }

        equity = cash
        if position is not None:
            mark_row = next(
                (row for row in current["snapshot"]["strikes"] if float(row["strike_price"]) == float(position["strike_price"])),
                None,
            )
            mark_key = "call_ltp" if position["side"] == "CE" else "put_ltp"
            mark_price = float(mark_row.get(mark_key) or position["entry_price"]) if mark_row else float(position["entry_price"])
            equity += mark_price * position["quantity"]

        equity_curve.append({"timestamp": current["timestamp"], "equity": _round(equity), "cash": _round(cash)})

    realized_pnl = _round(sum(float(trade["pnl"]) for trade in trades))
    wins = [trade for trade in trades if float(trade["pnl"]) > 0]
    losses = [trade for trade in trades if float(trade["pnl"]) < 0]
    max_equity = 0.0
    max_drawdown = 0.0
    for point in equity_curve:
        equity = float(point["equity"])
        max_equity = max(max_equity, equity)
        if max_equity > 0:
            drawdown = (max_equity - equity) / max_equity * 100.0
            max_drawdown = max(max_drawdown, drawdown)

    return {
        "config": {
            "underlying": normalized,
            "capital": _round(capital),
            "limit": limit,
            "sma_period": sma_period,
            "profit_target_pct": profit_target_pct,
            "stop_loss_pct": stop_loss_pct,
            "max_hold_bars": max_hold_bars,
            "lot_multiplier": lot_multiplier,
            "lot_size": lot_size,
            "intraday_only": True,
            "entry_start_ist": DEFAULT_ENTRY_START.strftime("%H:%M"),
            "entry_cutoff_ist": DEFAULT_ENTRY_CUTOFF.strftime("%H:%M"),
            "square_off_ist": DEFAULT_SQUARE_OFF.strftime("%H:%M"),
            "max_trades_per_day": max_trades_per_day,
            "daily_profit_lock_pct": daily_profit_lock_pct,
            "daily_loss_limit_pct": daily_loss_limit_pct,
            "confirmation_bars": confirmation_bars,
            "cooldown_bars": cooldown_bars,
            "min_pcr_sma_gap": min_pcr_sma_gap,
            "min_oi_bias_ratio": min_oi_bias_ratio,
            "min_entry_price": min_entry_price,
        },
        "summary": {
            "trades": len(trades),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": _round((len(wins) / len(trades) * 100.0) if trades else 0.0),
            "realized_pnl": realized_pnl,
            "ending_equity": _round(equity_curve[-1]["equity"]) if equity_curve else _round(capital),
            "return_pct": _round((realized_pnl / capital * 100.0) if capital else 0.0),
            "avg_win": _round(sum(float(trade["pnl"]) for trade in wins) / len(wins)) if wins else 0.0,
            "avg_loss": _round(sum(float(trade["pnl"]) for trade in losses) / len(losses)) if losses else 0.0,
            "max_drawdown_pct": _round(max_drawdown),
            "timestamps_tested": len(timeline),
            "profitable_days": sum(1 for item in day_summaries.values() if float(item["realized_pnl"]) > 0),
            "losing_days": sum(1 for item in day_summaries.values() if float(item["realized_pnl"]) < 0),
            "forced_day_end_exits": sum(1 for trade in trades if trade["exit_reason"] == "day_end_square_off"),
        },
        "trades": trades,
        "equity_curve": equity_curve,
        "signals": signal_points,
        "days": [
            {
                **item,
                "realized_pnl": _round(float(item["realized_pnl"])),
            }
            for item in sorted(day_summaries.values(), key=lambda value: value["trading_day"])
        ],
    }


def _strategy_score(summary: dict[str, Any]) -> float:
    trades = int(summary["trades"])
    if trades <= 0:
        return -9999.0

    trade_penalty = 0.0
    if trades < 4:
        trade_penalty += (4 - trades) * 2.0
    if trades > 24:
        trade_penalty += (trades - 24) * 0.15

    return _round(
        float(summary["return_pct"])
        - float(summary["max_drawdown_pct"]) * 0.45
        + float(summary["win_rate"]) * 0.025
        - trade_penalty,
        4,
    )


@router.get("/optimize")
def simulator_optimize(
    underlying: str = Query("NIFTY"),
    capital: float = Query(100000.0, ge=1000.0, le=10000000.0),
    limit: int = Query(160, ge=30, le=1000),
    lot_multiplier: int = Query(1, ge=1, le=25),
    max_trades_per_day: int = Query(20, ge=1, le=20),
    daily_profit_lock_pct: float = Query(0.25, ge=0.001, le=1.0),
    daily_loss_limit_pct: float = Query(0.10, ge=0.001, le=1.0),
    max_results: int = Query(8, ge=1, le=25),
) -> dict[str, Any]:
    normalized = underlying.upper()
    if normalized not in SUPPORTED_UNDERLYINGS:
        raise HTTPException(status_code=400, detail=f"Unsupported underlying: {underlying}")

    candidates: list[dict[str, Any]] = []
    for sma_period in [5, 8]:
        for profit_target_pct in [0.15, 0.18]:
            for stop_loss_pct in [0.04, 0.06]:
                for max_hold_bars in [3, 4]:
                    for confirmation_bars in [1]:
                        for cooldown_bars in [1]:
                            min_pcr_sma_gap = 0.006 if confirmation_bars == 1 else 0.010
                            min_oi_bias_ratio = 0.0015 if sma_period <= 5 else 0.0025
                            min_entry_price = 35.0 if stop_loss_pct <= 0.04 else 45.0
                            try:
                                result = simulator_backtest(
                                    underlying=normalized,
                                    capital=capital,
                                    limit=limit,
                                    sma_period=sma_period,
                                    profit_target_pct=profit_target_pct,
                                    stop_loss_pct=stop_loss_pct,
                                    max_hold_bars=max_hold_bars,
                                    lot_multiplier=lot_multiplier,
                                    max_trades_per_day=max_trades_per_day,
                                    daily_profit_lock_pct=daily_profit_lock_pct,
                                    daily_loss_limit_pct=daily_loss_limit_pct,
                                    confirmation_bars=confirmation_bars,
                                    cooldown_bars=cooldown_bars,
                                    min_pcr_sma_gap=min_pcr_sma_gap,
                                    min_oi_bias_ratio=min_oi_bias_ratio,
                                    min_entry_price=min_entry_price,
                                )
                            except HTTPException:
                                raise
                            except Exception:
                                continue

                            summary = result["summary"]
                            candidates.append(
                                {
                                    "score": _strategy_score(summary),
                                    "config": {
                                        "sma_period": sma_period,
                                        "profit_target_pct": profit_target_pct,
                                        "stop_loss_pct": stop_loss_pct,
                                        "max_hold_bars": max_hold_bars,
                                        "lot_multiplier": lot_multiplier,
                                        "max_trades_per_day": max_trades_per_day,
                                        "daily_profit_lock_pct": daily_profit_lock_pct,
                                        "daily_loss_limit_pct": daily_loss_limit_pct,
                                        "confirmation_bars": confirmation_bars,
                                        "cooldown_bars": cooldown_bars,
                                        "min_pcr_sma_gap": min_pcr_sma_gap,
                                        "min_oi_bias_ratio": min_oi_bias_ratio,
                                        "min_entry_price": min_entry_price,
                                    },
                                    "summary": summary,
                                }
                            )

    ranked = sorted(
        candidates,
        key=lambda item: (
            float(item["score"]),
            float(item["summary"]["realized_pnl"]),
            -float(item["summary"]["max_drawdown_pct"]),
        ),
        reverse=True,
    )

    return {
        "underlying": normalized,
        "capital": _round(capital),
        "limit": limit,
        "runs": len(candidates),
        "results": ranked[:max_results],
    }
