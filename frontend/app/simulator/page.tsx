"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchAnalyticsOverview,
  fetchAuthStatus,
  fetchLiveOptionChain,
  fetchMarketStatus,
  fetchPCRCurrent,
  fetchSimulatorBacktest,
  fetchSimulatorOptimize,
  getLoginUrl,
  type AnalyticsOverview,
  type AuthStatus,
  type LiveOptionChainResponse,
  type MarketStatus,
  type OptionChainContract,
  type OptionChainStrikeRow,
  type PCRCurrent,
  type SimulatorOptimizationResult,
  type SimulatorOptimizeResponse,
  type SimulatorBacktestResponse
} from "@/lib/api";
import { AuthStatusCard } from "@/app/components/AuthStatusCard";
import { Header } from "@/app/components/Header";
import { LoginCard } from "@/app/components/LoginCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STORAGE_KEY = "options-dashboard:paper-simulator:v1";
const DEFAULT_CAPITAL = 100000;
const PROFIT_TARGET_PCT = 0.12;
const STOP_LOSS_PCT = 0.06;
const LIVE_ENTRY_START_HOUR = 10;
const LIVE_ENTRY_START_MINUTE = 30;

type SimulatorErrors = Partial<Record<"live" | "signal", string>>;
type PositionSide = "CE" | "PE";

type PaperPosition = {
  id: string;
  contractId: string;
  contractLabel: string;
  underlying: string;
  expiry: string;
  side: PositionSide;
  strikePrice: number;
  quantity: number;
  lotSize: number;
  entryPrice: number;
  entryFees: number;
  entryCost: number;
  openedAt: string;
  source: string;
};

type ClosedTrade = {
  id: string;
  contractLabel: string;
  underlying: string;
  expiry: string;
  side: PositionSide;
  strikePrice: number;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryFees: number;
  exitFees: number;
  openedAt: string;
  closedAt: string;
  pnl: number;
  pnlPct: number;
  source: string;
  exitReason: string;
};

type PaperAccount = {
  startingCapital: number;
  cash: number;
  positions: PaperPosition[];
  closedTrades: ClosedTrade[];
  lastResetAt: string;
};

type StrategySignal = {
  action: "buy_ce" | "buy_pe" | "wait";
  confidence: "Low" | "Medium" | "High";
  summary: string;
  detail: string;
};

const DEFAULT_ACCOUNT: PaperAccount = {
  startingCapital: DEFAULT_CAPITAL,
  cash: DEFAULT_CAPITAL,
  positions: [],
  closedTrades: [],
  lastResetAt: new Date().toISOString()
};

export default function SimulatorPage() {
  const [liveSessionEnabled, setLiveSessionEnabled] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [liveData, setLiveData] = useState<LiveOptionChainResponse | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [pcrCurrent, setPcrCurrent] = useState<PCRCurrent | null>(null);
  const [errors, setErrors] = useState<SimulatorErrors>({});
  const [busy, setBusy] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState("");
  const [selectedLots, setSelectedLots] = useState(1);
  const [account, setAccount] = useState<PaperAccount>(DEFAULT_ACCOUNT);
  const [storageReady, setStorageReady] = useState(false);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<SimulatorBacktestResponse | null>(null);
  const [optimizerBusy, setOptimizerBusy] = useState(false);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [optimizer, setOptimizer] = useState<SimulatorOptimizeResponse | null>(null);
  const [backtestCapital, setBacktestCapital] = useState(100000);
  const [backtestLimit, setBacktestLimit] = useState(160);
  const [backtestSmaPeriod, setBacktestSmaPeriod] = useState(8);
  const [backtestProfitTarget, setBacktestProfitTarget] = useState(18);
  const [backtestStopLoss, setBacktestStopLoss] = useState(6);
  const [backtestHoldBars, setBacktestHoldBars] = useState(3);
  const [backtestLots, setBacktestLots] = useState(1);
  const [backtestMaxTradesPerDay, setBacktestMaxTradesPerDay] = useState(20);
  const [backtestDailyProfitLock, setBacktestDailyProfitLock] = useState(25);
  const [backtestDailyLossLimit, setBacktestDailyLossLimit] = useState(10);
  const [backtestConfirmationBars, setBacktestConfirmationBars] = useState(1);
  const [backtestCooldownBars, setBacktestCooldownBars] = useState(1);
  const [backtestMinPcrGap, setBacktestMinPcrGap] = useState(0.006);
  const [backtestMinOiBias, setBacktestMinOiBias] = useState(0.25);
  const [backtestMinPremium, setBacktestMinPremium] = useState(45);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PaperAccount>;
        setAccount({
          startingCapital: asNumber(parsed.startingCapital, DEFAULT_CAPITAL),
          cash: asNumber(parsed.cash, DEFAULT_CAPITAL),
          positions: Array.isArray(parsed.positions) ? parsed.positions : [],
          closedTrades: Array.isArray(parsed.closedTrades) ? parsed.closedTrades : [],
          lastResetAt: typeof parsed.lastResetAt === "string" ? parsed.lastResetAt : new Date().toISOString()
        });
      }
    } catch {
      setAccount(DEFAULT_ACCOUNT);
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  }, [account, storageReady]);

  useEffect(() => {
    void runBacktest("NIFTY");
  }, []);

  async function refresh() {
    setBusy(true);
    const nextErrors: SimulatorErrors = {};

    try {
      const [authResult, marketResult, liveResult, overviewResult, pcrResult] = await Promise.allSettled([
        fetchAuthStatus(),
        fetchMarketStatus(),
        fetchLiveOptionChain(),
        fetchAnalyticsOverview(),
        fetchPCRCurrent()
      ]);

      if (authResult.status === "fulfilled") {
        setAuthStatus(authResult.value);
      }

      if (marketResult.status === "fulfilled") {
        setMarketStatus(marketResult.value);
      }

      if (liveResult.status === "fulfilled") {
        setLiveData(liveResult.value);
        setSelectedContractId((current) => current || liveResult.value.contracts[0]?.id || "");
      } else {
        nextErrors.live = liveResult.reason instanceof Error ? liveResult.reason.message : "Failed to load live option chain";
      }

      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value);
      }

      if (pcrResult.status === "fulfilled") {
        setPcrCurrent(pcrResult.value);
      }

      setErrors(nextErrors);
    } finally {
      setBusy(false);
    }
  }

  function stopLiveSession() {
    setLiveSessionEnabled(false);
    setLiveData(null);
    setOverview(null);
    setPcrCurrent(null);
    setMarketStatus(null);
    setAuthStatus(null);
    setSelectedContractId("");
    setErrors((current) => ({ ...current, live: undefined, signal: undefined }));
  }

  async function startLiveSession() {
    setLiveSessionEnabled(true);
    await refresh();
  }

  const selectedContract = useMemo(
    () => liveData?.contracts.find((contract) => contract.id === selectedContractId) ?? liveData?.contracts[0] ?? null,
    [liveData, selectedContractId]
  );

  const contractRows = useMemo(() => {
    if (!selectedContract) {
      return [];
    }

    return [...selectedContract.rows]
      .sort((left, right) => {
        const leftDistance = Math.abs(left.strike_price - selectedContract.spot_ltp);
        const rightDistance = Math.abs(right.strike_price - selectedContract.spot_ltp);
        return leftDistance - rightDistance;
      })
      .slice(0, 10);
  }, [selectedContract]);

  const priceBook = useMemo(() => buildPriceBook(liveData?.contracts ?? []), [liveData]);
  const signal = useMemo(() => buildStrategySignal(overview, pcrCurrent, selectedContract), [overview, pcrCurrent, selectedContract]);
  const accountMetrics = useMemo(() => buildAccountMetrics(account, priceBook), [account, priceBook]);
  const suggestedRow = useMemo(() => contractRows[0] ?? null, [contractRows]);
  const liveEntryOpen = useMemo(() => {
    const now = new Date();
    const nowInIst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const minutes = nowInIst.getHours() * 60 + nowInIst.getMinutes();
    return minutes >= LIVE_ENTRY_START_HOUR * 60 + LIVE_ENTRY_START_MINUTE;
  }, [liveData?.fetched_at, marketStatus?.timestamp]);

  function resetAccount(startingCapital: number) {
    setAccount({
      startingCapital,
      cash: startingCapital,
      positions: [],
      closedTrades: [],
      lastResetAt: new Date().toISOString()
    });
  }

  async function runBacktest(underlyingOverride?: string) {
    const underlyingToUse = underlyingOverride ?? selectedContract?.underlying ?? "NIFTY";
    setBacktestBusy(true);
    try {
      const response = await fetchSimulatorBacktest({
        underlying: underlyingToUse,
        capital: backtestCapital,
        limit: backtestLimit,
        smaPeriod: backtestSmaPeriod,
        profitTargetPct: backtestProfitTarget / 100,
        stopLossPct: backtestStopLoss / 100,
        maxHoldBars: backtestHoldBars,
        lotMultiplier: backtestLots,
        maxTradesPerDay: backtestMaxTradesPerDay,
        dailyProfitLockPct: backtestDailyProfitLock / 100,
        dailyLossLimitPct: backtestDailyLossLimit / 100,
        confirmationBars: backtestConfirmationBars,
        cooldownBars: backtestCooldownBars,
        minPcrSmaGap: backtestMinPcrGap,
        minOiBiasRatio: backtestMinOiBias / 100,
        minEntryPrice: backtestMinPremium
      });
      setBacktest(response);
      setBacktestError(null);
    } catch (error) {
      setBacktestError(error instanceof Error ? error.message : "Failed to run backtest");
      setBacktest(null);
    } finally {
      setBacktestBusy(false);
    }
  }

  async function runOptimizer() {
    const underlyingToUse = selectedContract?.underlying ?? "NIFTY";
    setOptimizerBusy(true);
    try {
      const response = await fetchSimulatorOptimize({
        underlying: underlyingToUse,
        capital: backtestCapital,
        limit: backtestLimit,
        lotMultiplier: backtestLots,
        maxTradesPerDay: backtestMaxTradesPerDay,
        dailyProfitLockPct: backtestDailyProfitLock / 100,
        dailyLossLimitPct: backtestDailyLossLimit / 100
      });
      setOptimizer(response);
      setOptimizerError(null);
    } catch (error) {
      setOptimizerError(error instanceof Error ? error.message : "Failed to optimize strategy");
      setOptimizer(null);
    } finally {
      setOptimizerBusy(false);
    }
  }

  function applyOptimizedConfig(result: SimulatorOptimizationResult) {
    setBacktestSmaPeriod(result.config.sma_period);
    setBacktestProfitTarget(Math.round(result.config.profit_target_pct * 100));
    setBacktestStopLoss(Math.round(result.config.stop_loss_pct * 100));
    setBacktestHoldBars(result.config.max_hold_bars);
    setBacktestLots(result.config.lot_multiplier);
    setBacktestMaxTradesPerDay(result.config.max_trades_per_day);
    setBacktestDailyProfitLock(Math.round(result.config.daily_profit_lock_pct * 100));
    setBacktestDailyLossLimit(Math.round(result.config.daily_loss_limit_pct * 100));
    setBacktestConfirmationBars(result.config.confirmation_bars);
    setBacktestCooldownBars(result.config.cooldown_bars);
    setBacktestMinPcrGap(result.config.min_pcr_sma_gap);
    setBacktestMinOiBias(roundToTwo(result.config.min_oi_bias_ratio * 100));
    setBacktestMinPremium(result.config.min_entry_price);
  }

  function openPaperTrade(side: PositionSide, row: OptionChainStrikeRow, source: string) {
    if (!selectedContract) {
      return;
    }

    if (!liveEntryOpen) {
      setErrors((existing) => ({
        ...existing,
        signal: "Observation window active. No simulator entries before 10:30 AM IST."
      }));
      return;
    }

    const price = side === "CE" ? row.call_ltp : row.put_ltp;
    const quantity = Math.max(1, selectedLots) * selectedContract.lot_size;
    const entryFees = estimateFees(price * quantity);
    const entryCost = price * quantity + entryFees;

    setAccount((current) => {
      if (entryCost > current.cash) {
        setErrors((existing) => ({
          ...existing,
          signal: `Need ${formatCurrency(entryCost)} cash for this entry, but only ${formatCurrency(current.cash)} is available.`
        }));
        return current;
      }

      const nextPosition: PaperPosition = {
        id: createId("pos"),
        contractId: selectedContract.id,
        contractLabel: selectedContract.label,
        underlying: selectedContract.underlying,
        expiry: selectedContract.expiry,
        side,
        strikePrice: row.strike_price,
        quantity,
        lotSize: selectedContract.lot_size,
        entryPrice: price,
        entryFees,
        entryCost,
        openedAt: new Date().toISOString(),
        source
      };

      setErrors((existing) => ({ ...existing, signal: undefined }));
      return {
        ...current,
        cash: roundToTwo(current.cash - entryCost),
        positions: [nextPosition, ...current.positions]
      };
    });
  }

  function takeSuggestedTrade() {
    if (!suggestedRow || !selectedContract) {
      return;
    }

    if (signal.action === "buy_ce") {
      openPaperTrade("CE", suggestedRow, "Signal entry");
    } else if (signal.action === "buy_pe") {
      openPaperTrade("PE", suggestedRow, "Signal entry");
    }
  }

  function closePaperTrade(position: PaperPosition, exitReason: string) {
    const mark = priceBook[positionKey(position.contractId, position.strikePrice, position.side)];
    if (mark == null) {
      setErrors((existing) => ({
        ...existing,
        signal: `No live ${position.side} price found to close ${position.contractLabel} ${position.strikePrice}.`
      }));
      return;
    }

    setAccount((current) => {
      const exitFees = estimateFees(mark * position.quantity);
      const proceeds = mark * position.quantity - exitFees;
      const pnl = roundToTwo(proceeds - position.entryPrice * position.quantity - position.entryFees);
      const pnlPct = position.entryPrice > 0 ? roundToTwo((mark - position.entryPrice) / position.entryPrice * 100) : 0;
      const nextTrade: ClosedTrade = {
        id: position.id,
        contractLabel: position.contractLabel,
        underlying: position.underlying,
        expiry: position.expiry,
        side: position.side,
        strikePrice: position.strikePrice,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        exitPrice: mark,
        entryFees: position.entryFees,
        exitFees,
        openedAt: position.openedAt,
        closedAt: new Date().toISOString(),
        pnl,
        pnlPct,
        source: position.source,
        exitReason
      };

      return {
        ...current,
        cash: roundToTwo(current.cash + proceeds),
        positions: current.positions.filter((item) => item.id !== position.id),
        closedTrades: [nextTrade, ...current.closedTrades]
      };
    });
  }

  return (
    <main className="grid-sheen min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
        <Header
          lastUpdatedLabel={liveSessionEnabled && liveData?.fetched_at ? formatDateTime(liveData.fetched_at) : "Live feed paused"}
          title="Paper Trading Simulator"
          subtitle="Rule-guided option entries with fake capital, live marks, and local trade history"
        />

        {liveSessionEnabled && authStatus && !authStatus.authenticated ? <LoginCard loginUrl={getLoginUrl()} /> : null}
        {liveSessionEnabled && authStatus?.authenticated && authStatus.login_required ? <AuthStatusCard loginUrl={getLoginUrl()} /> : null}

        <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr_1fr]">
          <Card className="border-white/10 bg-slate-950/70">
            <CardHeader>
              <CardTitle>Signal Engine</CardTitle>
              <CardDescription>
                First-pass rule set: buy CE when PCR and put support are strengthening, buy PE when call pressure dominates, otherwise wait.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${signalPillClasses(signal.action)}`}>
                  {signalLabel(signal.action)}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
                  Confidence {signal.confidence}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
                  Target +12% / Stop -6%
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
                  Entries after 10:30 AM IST
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{signal.summary}</p>
                <p className="mt-2 text-sm text-slate-300">{signal.detail}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <MetricChip label="Window PCR" value={pcrCurrent ? pcrCurrent.window_pcr.toFixed(4) : "--"} />
                <MetricChip label="PCR Change" value={overview?.pcr_change != null ? signedFixed(overview.pcr_change, 4) : "--"} />
                <MetricChip
                  label="OI Bias"
                  value={
                    overview
                      ? `${formatCompact(overview.put_oi_change - overview.call_oi_change)} edge`
                      : "--"
                  }
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={takeSuggestedTrade} disabled={!selectedContract || !suggestedRow || signal.action === "wait"}>
                  {liveEntryOpen ? "Take Suggested Trade" : "Observing Until 10:30"}
                </Button>
                <Button variant="outline" onClick={() => void (liveSessionEnabled ? refresh() : startLiveSession())} disabled={busy}>
                  {busy ? "Refreshing..." : liveSessionEnabled ? "Refresh Live Feed" : "Start Live Feed"}
                </Button>
                {liveSessionEnabled ? (
                  <Button variant="outline" onClick={stopLiveSession}>
                    Stop Live Feed
                  </Button>
                ) : null}
              </div>
              {errors.signal ? <p className="text-sm text-rose-300">{errors.signal}</p> : null}
            </CardContent>
          </Card>

          <SummaryCard title="Paper Account" rows={[
            { label: "Starting Capital", value: formatCurrency(account.startingCapital) },
            { label: "Available Cash", value: formatCurrency(account.cash) },
            { label: "Total Equity", value: formatCurrency(accountMetrics.totalEquity) },
            { label: "Open Positions", value: String(account.positions.length) }
          ]} />

          <SummaryCard title="PnL Snapshot" rows={[
            { label: "Realized PnL", value: formatCurrency(accountMetrics.realizedPnl), positive: accountMetrics.realizedPnl >= 0 },
            { label: "Unrealized PnL", value: formatCurrency(accountMetrics.unrealizedPnl), positive: accountMetrics.unrealizedPnl >= 0 },
            { label: "Win Rate", value: `${accountMetrics.winRate.toFixed(1)}%` },
            { label: "Closed Trades", value: String(account.closedTrades.length) }
          ]} />
        </section>

        <Card className="border-white/10 bg-slate-950/70">
          <CardHeader>
            <CardTitle>Simulator Controls</CardTitle>
            <CardDescription>Reset fake capital, choose the live contract to trade, and set your lot size per paper entry.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => resetAccount(1000)}>
                Reset to Rs 1,000
              </Button>
              <Button variant="outline" onClick={() => resetAccount(100000)}>
                Reset to Rs 1,00,000
              </Button>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Last reset {formatDateTime(account.lastResetAt)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Contract
                <select
                  value={selectedContract?.id ?? ""}
                  onChange={(event) => setSelectedContractId(event.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none"
                >
                  {(liveData?.contracts ?? []).map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Lots
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={selectedLots}
                  onChange={(event) => setSelectedLots(clamp(Math.round(Number(event.target.value) || 1), 1, 25))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                {liveSessionEnabled
                  ? marketStatus?.market_open
                    ? `Live market • closes ${formatDateTime(marketStatus.next_close)}`
                    : `Market ${marketStatus?.phase ?? "closed"}`
                  : "Live feed paused"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950/70">
          <CardHeader>
            <CardTitle>Historical Backtest</CardTitle>
            <CardDescription>
              Replays your stored snapshot history using the same PCR-vs-SMA and OI-bias rules, one position at a time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Capital
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={backtestCapital}
                  onChange={(event) => setBacktestCapital(clamp(Math.round(Number(event.target.value) || 100000), 1000, 10000000))}
                  className="w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Bars
                <input
                  type="number"
                  min={30}
                  max={1000}
                  value={backtestLimit}
                  onChange={(event) => setBacktestLimit(clamp(Math.round(Number(event.target.value) || 160), 30, 1000))}
                  className="w-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                SMA
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={backtestSmaPeriod}
                  onChange={(event) => setBacktestSmaPeriod(clamp(Math.round(Number(event.target.value) || 5), 2, 50))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Target %
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={backtestProfitTarget}
                  onChange={(event) => setBacktestProfitTarget(clamp(Math.round(Number(event.target.value) || 12), 1, 100))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Stop %
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={backtestStopLoss}
                  onChange={(event) => setBacktestStopLoss(clamp(Math.round(Number(event.target.value) || 6), 1, 100))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Hold bars
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={backtestHoldBars}
                  onChange={(event) => setBacktestHoldBars(clamp(Math.round(Number(event.target.value) || 4), 1, 50))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Lot x
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={backtestLots}
                  onChange={(event) => setBacktestLots(clamp(Math.round(Number(event.target.value) || 1), 1, 25))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Max/day
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={backtestMaxTradesPerDay}
                  onChange={(event) => setBacktestMaxTradesPerDay(clamp(Math.round(Number(event.target.value) || 3), 1, 20))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Day profit %
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={backtestDailyProfitLock}
                  onChange={(event) => setBacktestDailyProfitLock(clamp(Math.round(Number(event.target.value) || 3), 1, 100))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Day loss %
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={backtestDailyLossLimit}
                  onChange={(event) => setBacktestDailyLossLimit(clamp(Math.round(Number(event.target.value) || 2), 1, 100))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Confirm
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={backtestConfirmationBars}
                  onChange={(event) => setBacktestConfirmationBars(clamp(Math.round(Number(event.target.value) || 2), 1, 5))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Cooldown
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={backtestCooldownBars}
                  onChange={(event) => setBacktestCooldownBars(clamp(Math.round(Number(event.target.value) || 1), 0, 20))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                PCR gap
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.001}
                  value={backtestMinPcrGap}
                  onChange={(event) => setBacktestMinPcrGap(clampNumber(Number(event.target.value), 0.01, 0, 1))}
                  className="w-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                OI bias %
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={backtestMinOiBias}
                  onChange={(event) => setBacktestMinOiBias(clampNumber(Number(event.target.value), 0.2, 0, 100))}
                  className="w-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Min premium
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={5}
                  value={backtestMinPremium}
                  onChange={(event) => setBacktestMinPremium(clampNumber(Number(event.target.value), 40, 0, 10000))}
                  className="w-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <Button onClick={() => void runBacktest()} disabled={backtestBusy}>
                {backtestBusy ? "Running..." : "Run Backtest"}
              </Button>
              <Button variant="outline" onClick={() => void runOptimizer()} disabled={optimizerBusy}>
                {optimizerBusy ? "Optimizing..." : "Optimize Strategy"}
              </Button>
            </div>

            {backtestError ? <p className="text-sm text-rose-300">{backtestError}</p> : null}
            {optimizerError ? <p className="text-sm text-rose-300">{optimizerError}</p> : null}
            {optimizer ? (
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-slate-400">
                      <th className="px-3 py-3 font-medium">Rank</th>
                      <th className="px-3 py-3 font-medium">Score</th>
                      <th className="px-3 py-3 font-medium">Return</th>
                      <th className="px-3 py-3 font-medium">PnL</th>
                      <th className="px-3 py-3 font-medium">Win Rate</th>
                      <th className="px-3 py-3 font-medium">Drawdown</th>
                      <th className="px-3 py-3 font-medium">Trades</th>
                      <th className="px-3 py-3 font-medium">Setup</th>
                      <th className="px-3 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimizer.results.map((result, index) => (
                      <tr key={`${result.score}-${index}`} className="border-b border-white/5">
                        <td className="px-3 py-3 text-slate-200">{index + 1}</td>
                        <td className="px-3 py-3 font-medium text-white">{result.score.toFixed(2)}</td>
                        <td className={`px-3 py-3 font-medium ${result.summary.return_pct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {result.summary.return_pct.toFixed(2)}%
                        </td>
                        <td className={`px-3 py-3 font-medium ${result.summary.realized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {formatCurrency(result.summary.realized_pnl)}
                        </td>
                        <td className="px-3 py-3 text-slate-200">{result.summary.win_rate.toFixed(1)}%</td>
                        <td className="px-3 py-3 text-slate-200">{result.summary.max_drawdown_pct.toFixed(2)}%</td>
                        <td className="px-3 py-3 text-slate-200">{result.summary.trades}</td>
                        <td className="px-3 py-3 text-slate-300">
                          {`SMA ${result.config.sma_period}, T ${(result.config.profit_target_pct * 100).toFixed(0)}%, S ${(result.config.stop_loss_pct * 100).toFixed(0)}%, H ${result.config.max_hold_bars}, C ${result.config.confirmation_bars}, CD ${result.config.cooldown_bars}`}
                        </td>
                        <td className="px-3 py-3">
                          <Button size="sm" variant="outline" onClick={() => applyOptimizedConfig(result)}>
                            Apply
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">{`Scanned ${optimizer.runs} combinations for ${optimizer.underlying}. Apply a row, then run the backtest to inspect trades.`}</p>
              </div>
            ) : null}

            {backtest ? (
              <>
                <section className="grid gap-4 xl:grid-cols-5">
                  <MetricChip label="Trades" value={String(backtest.summary.trades)} />
                  <MetricChip label="Win Rate" value={`${backtest.summary.win_rate.toFixed(1)}%`} />
                  <MetricChip label="Return" value={`${backtest.summary.return_pct.toFixed(2)}%`} />
                  <MetricChip label="Realized PnL" value={formatCurrency(backtest.summary.realized_pnl)} />
                  <MetricChip label="Max Drawdown" value={`${backtest.summary.max_drawdown_pct.toFixed(2)}%`} />
                </section>
                <section className="grid gap-4 xl:grid-cols-4">
                  <MetricChip label="Profitable Days" value={String(backtest.summary.profitable_days)} />
                  <MetricChip label="Losing Days" value={String(backtest.summary.losing_days)} />
                  <MetricChip label="Forced Square-offs" value={String(backtest.summary.forced_day_end_exits)} />
                  <MetricChip
                    label="Intraday Rules"
                    value={`${backtest.config.entry_start_ist} start / ${backtest.config.square_off_ist} close`}
                  />
                </section>
                <section className="grid gap-4 xl:grid-cols-5">
                  <MetricChip label="Confirm Bars" value={String(backtest.config.confirmation_bars)} />
                  <MetricChip label="Cooldown Bars" value={String(backtest.config.cooldown_bars)} />
                  <MetricChip label="PCR Gap" value={backtest.config.min_pcr_sma_gap.toFixed(3)} />
                  <MetricChip label="OI Bias" value={`${(backtest.config.min_oi_bias_ratio * 100).toFixed(1)}%`} />
                  <MetricChip label="Min Premium" value={formatCurrency(backtest.config.min_entry_price)} />
                </section>

                <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                  <Card className="border-white/8 bg-white/[0.02]">
                    <CardHeader>
                      <CardTitle>Equity Curve</CardTitle>
                      <CardDescription>
                        Historical equity over {backtest.summary.timestamps_tested} replay timestamps.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={backtest.equity_curve}>
                            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis dataKey="timestamp" tickFormatter={(value) => formatBacktestTime(value)} stroke="#7c879f" />
                            <YAxis tickFormatter={(value) => formatCompact(value)} stroke="#7c879f" />
                            <Tooltip
                              contentStyle={{ background: "#151927", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                              labelFormatter={(value) => formatDateTime(String(value))}
                              formatter={(value: number, name: string) => [formatCurrency(value), name === "equity" ? "Equity" : "Cash"]}
                            />
                            <Line type="monotone" dataKey="equity" stroke="#00d4aa" strokeWidth={3} dot={false} />
                            <Line type="monotone" dataKey="cash" stroke="#ffd166" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-white/8 bg-white/[0.02]">
                    <CardHeader>
                      <CardTitle>Backtest Notes</CardTitle>
                      <CardDescription>The current engine is deliberately simple so the outputs are auditable.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-300">
                      <RuleRow title="Signal">Buy CE when PCR is above SMA and strengthening with positive OI bias. Buy PE for the inverse.</RuleRow>
                      <RuleRow title="Confirmation">{`Requires ${backtest.config.confirmation_bars} consecutive matching signal bars and waits ${backtest.config.cooldown_bars} bar after an exit before re-entry.`}</RuleRow>
                      <RuleRow title="Signal quality">{`Requires at least ${backtest.config.min_pcr_sma_gap.toFixed(3)} PCR/SMA separation, ${(backtest.config.min_oi_bias_ratio * 100).toFixed(1)}% OI-bias strength, and ${formatCurrency(backtest.config.min_entry_price)} minimum option premium.`}</RuleRow>
                      <RuleRow title="Instrument">Trades the reference strike with highest combined OI at each entry timestamp.</RuleRow>
                      <RuleRow title="Observation window">{`No entries before ${backtest.config.entry_start_ist} IST. The engine only observes the market until then.`}</RuleRow>
                      <RuleRow title="Intraday only">{`No overnight carry. Entries run only from ${backtest.config.entry_start_ist} to ${backtest.config.entry_cutoff_ist} IST and every position is squared off by ${backtest.config.square_off_ist} IST.`}</RuleRow>
                      <RuleRow title="Day lock">{`Stops new trades for the day after ${backtest.config.max_trades_per_day} trades, +${(backtest.config.daily_profit_lock_pct * 100).toFixed(1)}% day PnL, or -${(backtest.config.daily_loss_limit_pct * 100).toFixed(1)}% day PnL.`}</RuleRow>
                      <RuleRow title="Costs">Uses a simple fee model with a floor and no spread model yet, so treat results as directional, not final.</RuleRow>
                    </CardContent>
                  </Card>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-[980px] text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-slate-400">
                        <th className="px-3 py-3 font-medium">Day</th>
                        <th className="px-3 py-3 font-medium">Trades</th>
                        <th className="px-3 py-3 font-medium">Wins</th>
                        <th className="px-3 py-3 font-medium">Losses</th>
                        <th className="px-3 py-3 font-medium">Day PnL</th>
                        <th className="px-3 py-3 font-medium">Day Lock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtest.days.map((day) => (
                        <tr key={day.trading_day} className="border-b border-white/5">
                          <td className="px-3 py-3 text-slate-200">{day.trading_day}</td>
                          <td className="px-3 py-3 text-slate-200">{day.trades}</td>
                          <td className="px-3 py-3 text-slate-200">{day.wins}</td>
                          <td className="px-3 py-3 text-slate-200">{day.losses}</td>
                          <td className={`px-3 py-3 font-medium ${day.realized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                            {formatCurrency(day.realized_pnl)}
                          </td>
                          <td className="px-3 py-3 text-slate-200">{day.locked_reason ?? "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-[1220px] text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-slate-400">
                        <th className="px-3 py-3 font-medium">Entry</th>
                        <th className="px-3 py-3 font-medium">Exit</th>
                        <th className="px-3 py-3 font-medium">Side</th>
                        <th className="px-3 py-3 font-medium">Strike</th>
                        <th className="px-3 py-3 font-medium">Qty</th>
                        <th className="px-3 py-3 font-medium">Entry Px</th>
                        <th className="px-3 py-3 font-medium">Exit Px</th>
                        <th className="px-3 py-3 font-medium">PnL</th>
                        <th className="px-3 py-3 font-medium">PnL %</th>
                        <th className="px-3 py-3 font-medium">Bars Held</th>
                        <th className="px-3 py-3 font-medium">Exit Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtest.trades.map((trade) => (
                        <tr key={`${trade.entry_timestamp}-${trade.exit_timestamp}-${trade.side}-${trade.strike_price}`} className="border-b border-white/5">
                          <td className="px-3 py-3 text-slate-200">{formatDateTime(trade.entry_timestamp)}</td>
                          <td className="px-3 py-3 text-slate-200">{formatDateTime(trade.exit_timestamp)}</td>
                          <td className="px-3 py-3 text-white">{trade.side}</td>
                          <td className="px-3 py-3 text-slate-200">{trade.strike_price}</td>
                          <td className="px-3 py-3 text-slate-200">{trade.quantity}</td>
                          <td className="px-3 py-3 text-slate-200">{formatCurrency(trade.entry_price)}</td>
                          <td className="px-3 py-3 text-slate-200">{formatCurrency(trade.exit_price)}</td>
                          <td className={`px-3 py-3 font-medium ${trade.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatCurrency(trade.pnl)}</td>
                          <td className={`px-3 py-3 font-medium ${trade.pnl_pct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{trade.pnl_pct.toFixed(2)}%</td>
                          <td className="px-3 py-3 text-slate-200">{trade.bars_held}</td>
                          <td className="px-3 py-3 text-slate-200">{trade.exit_reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {errors.live ? (
          <Card className="border-rose-500/20 bg-rose-500/10">
            <CardContent className="p-4 text-sm text-rose-100">{errors.live}</CardContent>
          </Card>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{selectedContract ? `${selectedContract.label} Paper Entries` : "Paper Entries"}</CardTitle>
              <CardDescription>
                Trade the live option rows nearest to spot after you start the live feed. This MVP supports long CE and long PE entries with manual exits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedContract ? (
                <div className="overflow-x-auto">
                  <table className="min-w-[920px] text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-slate-400">
                        <th className="px-3 py-3 font-medium">Strike</th>
                        <th className="px-3 py-3 font-medium">Distance</th>
                        <th className="px-3 py-3 font-medium">Call LTP</th>
                        <th className="px-3 py-3 font-medium">Put LTP</th>
                        <th className="px-3 py-3 font-medium">PCR</th>
                        <th className="px-3 py-3 font-medium">CE Action</th>
                        <th className="px-3 py-3 font-medium">PE Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contractRows.map((row) => (
                        <tr key={`${selectedContract.id}-${row.strike_price}`} className="border-b border-white/5">
                          <td className="px-3 py-3 font-medium text-white">{row.strike_price}</td>
                          <td className="px-3 py-3 text-slate-300">{formatPoints(Math.abs(row.strike_price - selectedContract.spot_ltp))}</td>
                          <td className="px-3 py-3 text-slate-200">{formatCurrency(row.call_ltp)}</td>
                          <td className="px-3 py-3 text-slate-200">{formatCurrency(row.put_ltp)}</td>
                          <td className="px-3 py-3 text-slate-200">{row.pcr.toFixed(3)}</td>
                          <td className="px-3 py-3">
                            <Button size="sm" onClick={() => openPaperTrade("CE", row, "Manual CE entry")}>
                              Buy CE
                            </Button>
                          </td>
                          <td className="px-3 py-3">
                            <Button size="sm" variant="outline" onClick={() => openPaperTrade("PE", row, "Manual PE entry")}>
                              Buy PE
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-400">
                  {liveSessionEnabled ? "No live contract available yet." : "Live feed is paused. Start it when you want live option data."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trade Rules</CardTitle>
              <CardDescription>Use this first as a strict testing harness, not as a prediction engine.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <RuleRow title="Entry">
                Buy CE when PCR is firming, the latest PCR change is positive, and put support is stronger than call resistance.
              </RuleRow>
              <RuleRow title="Short-side proxy">
                Buy PE when PCR is weakening, the latest PCR change is negative, and call resistance is stronger than put support.
              </RuleRow>
              <RuleRow title="Target">
                Book profits when mark-to-market reaches roughly +12% from entry. You can close earlier if the signal weakens.
              </RuleRow>
              <RuleRow title="Stop">
                Exit around -6% or when the bias flips. No averaging down in this first version.
              </RuleRow>
              <RuleRow title="Sizing">
                Keep it to one or two lots until the idea shows stable expectancy across enough trades.
              </RuleRow>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Open Positions</CardTitle>
            <CardDescription>Current paper holdings marked against the latest live option prices.</CardDescription>
          </CardHeader>
          <CardContent>
            {account.positions.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-slate-400">
                      <th className="px-3 py-3 font-medium">Contract</th>
                      <th className="px-3 py-3 font-medium">Side</th>
                      <th className="px-3 py-3 font-medium">Qty</th>
                      <th className="px-3 py-3 font-medium">Entry</th>
                      <th className="px-3 py-3 font-medium">Current</th>
                      <th className="px-3 py-3 font-medium">PnL</th>
                      <th className="px-3 py-3 font-medium">PnL %</th>
                      <th className="px-3 py-3 font-medium">Target / Stop</th>
                      <th className="px-3 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.positions.map((position) => {
                      const mark = priceBook[positionKey(position.contractId, position.strikePrice, position.side)];
                      const pnl = mark == null ? null : roundToTwo((mark - position.entryPrice) * position.quantity - position.entryFees);
                      const pnlPct = mark == null || position.entryPrice <= 0 ? null : roundToTwo((mark - position.entryPrice) / position.entryPrice * 100);

                      return (
                        <tr key={position.id} className="border-b border-white/5">
                          <td className="px-3 py-3 text-white">{`${position.contractLabel} ${position.strikePrice}`}</td>
                          <td className="px-3 py-3 text-slate-200">{position.side}</td>
                          <td className="px-3 py-3 text-slate-200">{position.quantity}</td>
                          <td className="px-3 py-3 text-slate-200">{formatCurrency(position.entryPrice)}</td>
                          <td className="px-3 py-3 text-slate-200">{mark == null ? "--" : formatCurrency(mark)}</td>
                          <td className={`px-3 py-3 font-medium ${pnl == null || pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                            {pnl == null ? "--" : formatCurrency(pnl)}
                          </td>
                          <td className={`px-3 py-3 font-medium ${pnlPct == null || pnlPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                            {pnlPct == null ? "--" : `${pnlPct.toFixed(2)}%`}
                          </td>
                          <td className="px-3 py-3 text-slate-200">{`${(PROFIT_TARGET_PCT * 100).toFixed(0)}% / -${(STOP_LOSS_PCT * 100).toFixed(0)}%`}</td>
                          <td className="px-3 py-3">
                            <Button size="sm" variant="destructive" onClick={() => closePaperTrade(position, "Manual close")}>
                              Close
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No open paper positions yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trade Ledger</CardTitle>
            <CardDescription>Closed paper trades with entry and exit reasons.</CardDescription>
          </CardHeader>
          <CardContent>
            {account.closedTrades.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-slate-400">
                      <th className="px-3 py-3 font-medium">Closed</th>
                      <th className="px-3 py-3 font-medium">Contract</th>
                      <th className="px-3 py-3 font-medium">Side</th>
                      <th className="px-3 py-3 font-medium">Qty</th>
                      <th className="px-3 py-3 font-medium">Entry</th>
                      <th className="px-3 py-3 font-medium">Exit</th>
                      <th className="px-3 py-3 font-medium">PnL</th>
                      <th className="px-3 py-3 font-medium">PnL %</th>
                      <th className="px-3 py-3 font-medium">Source</th>
                      <th className="px-3 py-3 font-medium">Exit Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.closedTrades.map((trade) => (
                      <tr key={trade.id} className="border-b border-white/5">
                        <td className="px-3 py-3 text-slate-200">{formatDateTime(trade.closedAt)}</td>
                        <td className="px-3 py-3 text-white">{`${trade.contractLabel} ${trade.strikePrice}`}</td>
                        <td className="px-3 py-3 text-slate-200">{trade.side}</td>
                        <td className="px-3 py-3 text-slate-200">{trade.quantity}</td>
                        <td className="px-3 py-3 text-slate-200">{formatCurrency(trade.entryPrice)}</td>
                        <td className="px-3 py-3 text-slate-200">{formatCurrency(trade.exitPrice)}</td>
                        <td className={`px-3 py-3 font-medium ${trade.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {formatCurrency(trade.pnl)}
                        </td>
                        <td className={`px-3 py-3 font-medium ${trade.pnlPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {trade.pnlPct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-3 text-slate-200">{trade.source}</td>
                        <td className="px-3 py-3 text-slate-200">{trade.exitReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No closed paper trades yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function SummaryCard({
  title,
  rows
}: {
  title: string;
  rows: { label: string; value: string; positive?: boolean }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-slate-400">{row.label}</span>
            <span className={`text-sm font-semibold ${row.positive == null ? "text-white" : row.positive ? "text-emerald-300" : "text-rose-300"}`}>
              {row.value}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 font-[family-name:var(--font-mono)] text-sm text-slate-100">{value}</p>
    </div>
  );
}

function RuleRow({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <p className="font-semibold text-white">{title}</p>
      <p className="mt-1 text-slate-300">{children}</p>
    </div>
  );
}

function buildStrategySignal(
  overview: AnalyticsOverview | null,
  pcrCurrent: PCRCurrent | null,
  selectedContract: OptionChainContract | null
): StrategySignal {
  if (!overview || !pcrCurrent || !selectedContract) {
    return {
      action: "wait",
      confidence: "Low",
      summary: "Signal engine is waiting for live data.",
      detail: "Load a contract and current PCR state before taking any paper trade."
    };
  }

  const pcrChange = overview.pcr_change ?? 0;
  const callEdge = overview.call_oi_change;
  const putEdge = overview.put_oi_change;
  const edge = putEdge - callEdge;
  const windowPcr = overview.window_pcr;

  if (windowPcr >= 1.02 && pcrChange > 0 && edge > 0) {
    return {
      action: "buy_ce",
      confidence: edge > 250000 && windowPcr >= 1.08 ? "High" : "Medium",
      summary: `Bullish bias on ${selectedContract.underlying}: PCR is strengthening and put support is leading.`,
      detail: `Window PCR is ${windowPcr.toFixed(4)}, latest PCR change is ${signedFixed(pcrChange, 4)}, and put OI change is ahead of call OI change by ${formatCompact(edge)}.`
    };
  }

  if (windowPcr <= 0.98 && pcrChange < 0 && edge < 0) {
    return {
      action: "buy_pe",
      confidence: Math.abs(edge) > 250000 && windowPcr <= 0.92 ? "High" : "Medium",
      summary: `Bearish bias on ${selectedContract.underlying}: PCR is weakening and call resistance is building.`,
      detail: `Window PCR is ${windowPcr.toFixed(4)}, latest PCR change is ${signedFixed(pcrChange, 4)}, and call OI change is ahead of put OI change by ${formatCompact(Math.abs(edge))}.`
    };
  }

  return {
    action: "wait",
    confidence: "Low",
    summary: "No clean edge right now.",
    detail: `Window PCR ${windowPcr.toFixed(4)} and OI flows are not aligned enough for a disciplined CE or PE entry.`
  };
}

function buildPriceBook(contracts: OptionChainContract[]) {
  const book: Record<string, number> = {};

  for (const contract of contracts) {
    for (const row of contract.rows) {
      book[positionKey(contract.id, row.strike_price, "CE")] = row.call_ltp;
      book[positionKey(contract.id, row.strike_price, "PE")] = row.put_ltp;
    }
  }

  return book;
}

function buildAccountMetrics(account: PaperAccount, priceBook: Record<string, number>) {
  const openValue = account.positions.reduce((total, position) => {
    const mark = priceBook[positionKey(position.contractId, position.strikePrice, position.side)];
    return total + (mark != null ? mark * position.quantity : position.entryPrice * position.quantity);
  }, 0);

  const unrealizedPnl = account.positions.reduce((total, position) => {
    const mark = priceBook[positionKey(position.contractId, position.strikePrice, position.side)];
    if (mark == null) {
      return total;
    }
    return total + (mark - position.entryPrice) * position.quantity - position.entryFees;
  }, 0);

  const realizedPnl = account.closedTrades.reduce((total, trade) => total + trade.pnl, 0);
  const winningTrades = account.closedTrades.filter((trade) => trade.pnl > 0).length;

  return {
    totalEquity: roundToTwo(account.cash + openValue),
    openValue: roundToTwo(openValue),
    realizedPnl: roundToTwo(realizedPnl),
    unrealizedPnl: roundToTwo(unrealizedPnl),
    winRate: account.closedTrades.length ? winningTrades / account.closedTrades.length * 100 : 0
  };
}

function estimateFees(notional: number) {
  return roundToTwo(Math.max(12, notional * 0.0005));
}

function positionKey(contractId: string, strikePrice: number, side: PositionSide) {
  return `${contractId}:${strikePrice}:${side}`;
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function signalLabel(action: StrategySignal["action"]) {
  if (action === "buy_ce") {
    return "Buy CE";
  }
  if (action === "buy_pe") {
    return "Buy PE";
  }
  return "Wait";
}

function signalPillClasses(action: StrategySignal["action"]) {
  if (action === "buy_ce") {
    return "bg-emerald-400/20 text-emerald-200";
  }
  if (action === "buy_pe") {
    return "bg-rose-400/20 text-rose-200";
  }
  return "bg-white/10 text-slate-200";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

function formatPoints(value: number) {
  return `${Math.round(value)} pts`;
}

function signedFixed(value: number, digits: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "--";
  }
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

function formatBacktestTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampNumber(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}
