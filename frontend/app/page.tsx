"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchAnalyticsOverview,
  fetchAuthStatus,
  fetchLevels,
  fetchLiveOptionChain,
  fetchMarketStatus,
  fetchPCRCurrent,
  fetchPCRHistory,
  fetchProbabilityAnalytics,
  fetchSchedulerStatus,
  fetchSlabAnalytics,
  getLoginUrl,
  startScheduler,
  stopScheduler,
  updateSchedulerConfig,
  type AnalyticsOverview,
  type AuthStatus,
  type LevelsResponse,
  type LiveOptionChainResponse,
  type MarketStatus,
  type PCRCurrent,
  type PCRHistoryPoint,
  type ProbabilityAnalytics,
  type SchedulerStatus,
  type SlabAnalytics
} from "@/lib/api";
import { AuthStatusCard } from "@/app/components/AuthStatusCard";
import { GroupedSlabTable } from "@/app/components/GroupedSlabTable";
import { Header } from "@/app/components/Header";
import { LiveOptionContractTable } from "@/app/components/LiveOptionContractTable";
import { LoginCard } from "@/app/components/LoginCard";
import { MarketPulseCard } from "@/app/components/MarketPulseCard";
import { PCRCard } from "@/app/components/PCRCard";
import { PCRChart } from "@/app/components/PCRChart";
import { ProbabilityCard } from "@/app/components/ProbabilityCard";
import { SchedulerControl } from "@/app/components/SchedulerControl";
import { SlabMomentum } from "@/app/components/SlabMomentum";
import { SupportResistance } from "@/app/components/SupportResistance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DashboardErrors = Partial<
  Record<"live" | "scheduler" | "overview" | "pcr" | "history" | "slabs" | "probability" | "levels", string>
>;

export default function DashboardPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [liveData, setLiveData] = useState<LiveOptionChainResponse | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [pcrCurrent, setPcrCurrent] = useState<PCRCurrent | null>(null);
  const [pcrHistory, setPcrHistory] = useState<PCRHistoryPoint[]>([]);
  const [slabs, setSlabs] = useState<SlabAnalytics | null>(null);
  const [probability, setProbability] = useState<ProbabilityAnalytics | null>(null);
  const [levels, setLevels] = useState<LevelsResponse | null>(null);
  const [selectedInterval, setSelectedInterval] = useState(15);
  const [selectedUnderlying, setSelectedUnderlying] = useState("NIFTY");
  const [refreshMinutes, setRefreshMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<DashboardErrors>({});
  const [dataRefreshToken, setDataRefreshToken] = useState("initial");
  const refreshInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const schedulerSignatureRef = useRef<string | null>(null);

  async function refresh() {
    if (refreshInFlightRef.current) {
      queuedRefreshRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    setBusy(true);
    const nextErrors: DashboardErrors = {};

    try {
      const [authResult, marketResult, liveResult, schedulerResult, overviewResult, pcrResult, historyResult, slabsResult, probabilityResult, levelsResult] =
        await Promise.allSettled([
          fetchAuthStatus(),
          fetchMarketStatus(),
          fetchLiveOptionChain(),
          fetchSchedulerStatus(),
          fetchAnalyticsOverview(),
          fetchPCRCurrent(),
          fetchPCRHistory(64),
          fetchSlabAnalytics(),
          fetchProbabilityAnalytics(),
          fetchLevels()
        ]);

      if (authResult.status === "fulfilled") {
        setAuthStatus(authResult.value);
      }

      if (marketResult.status === "fulfilled") {
        setMarketStatus(marketResult.value);
      }

      if (liveResult.status === "fulfilled") {
        setLiveData(liveResult.value);
        setRefreshMinutes((current) => (current === 5 ? liveResult.value.refresh_minutes_default : current));
      } else {
        nextErrors.live = liveResult.reason instanceof Error ? liveResult.reason.message : "Failed to load live option chain";
      }

      if (schedulerResult.status === "fulfilled") {
        syncSchedulerState(schedulerResult.value);
      } else {
        nextErrors.scheduler = schedulerResult.reason instanceof Error ? schedulerResult.reason.message : "Failed to load scheduler";
      }

      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value);
      } else {
        nextErrors.overview = overviewResult.reason instanceof Error ? overviewResult.reason.message : "Failed to load overview";
      }

      if (pcrResult.status === "fulfilled") {
        setPcrCurrent(pcrResult.value);
      } else {
        nextErrors.pcr = pcrResult.reason instanceof Error ? pcrResult.reason.message : "Failed to load PCR";
      }

      if (historyResult.status === "fulfilled") {
        setPcrHistory(historyResult.value);
      } else {
        nextErrors.history = historyResult.reason instanceof Error ? historyResult.reason.message : "Failed to load PCR history";
      }

      if (slabsResult.status === "fulfilled") {
        setSlabs(slabsResult.value);
      } else {
        nextErrors.slabs = slabsResult.reason instanceof Error ? slabsResult.reason.message : "Failed to load slab movement";
      }

      if (probabilityResult.status === "fulfilled") {
        setProbability(probabilityResult.value);
      } else {
        nextErrors.probability =
          probabilityResult.reason instanceof Error ? probabilityResult.reason.message : "Failed to load probabilities";
      }

      if (levelsResult.status === "fulfilled") {
        setLevels(levelsResult.value);
      } else {
        nextErrors.levels = levelsResult.reason instanceof Error ? levelsResult.reason.message : "Failed to load levels";
      }

      setErrors(nextErrors);
    } finally {
      refreshInFlightRef.current = false;
      setBusy(false);

      if (queuedRefreshRef.current) {
        queuedRefreshRef.current = false;
        void refresh();
      }
    }
  }

  function syncSchedulerState(status: SchedulerStatus) {
    setSchedulerStatus(status);
    setSelectedInterval(status.interval_minutes);
    setSelectedUnderlying(status.underlying);

    const nextSignature = buildSchedulerDataSignature(status);
    if (nextSignature && schedulerSignatureRef.current !== nextSignature) {
      schedulerSignatureRef.current = nextSignature;
      setDataRefreshToken(nextSignature);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const activeMinutes = schedulerStatus?.running
      ? Math.min(refreshMinutes, schedulerStatus.interval_minutes)
      : refreshMinutes;
    const delay = (marketStatus?.market_open ? activeMinutes : 15) * 60 * 1000;
    const interval = window.setInterval(() => {
      void refresh();
    }, delay);
    return () => window.clearInterval(interval);
  }, [marketStatus?.market_open, refreshMinutes, schedulerStatus?.running, schedulerStatus?.interval_minutes]);

  useEffect(() => {
    if (!schedulerStatus?.running) {
      return;
    }

    const interval = window.setInterval(async () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const status = await fetchSchedulerStatus();
        const nextSignature = buildSchedulerDataSignature(status);
        const hasNewData = Boolean(nextSignature && schedulerSignatureRef.current && nextSignature !== schedulerSignatureRef.current);
        syncSchedulerState(status);

        if (hasNewData) {
          void refresh();
        }
      } catch {
        // Let the main refresh loop surface API errors.
      }
    }, 30000);

    return () => window.clearInterval(interval);
  }, [schedulerStatus?.running]);

  useEffect(() => {
    function handleVisibilityOrFocus() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, []);

  const pcrDelta = useMemo(() => {
    if (pcrHistory.length < 2) {
      return 0;
    }
    return pcrHistory[pcrHistory.length - 1].pcr - pcrHistory[pcrHistory.length - 2].pcr;
  }, [pcrHistory]);
  async function handleSchedulerAction(action: "start" | "stop" | "update") {
    setBusy(true);
    try {
      const response =
        action === "start"
          ? await updateSchedulerConfig(selectedInterval, selectedUnderlying).then(() => startScheduler())
          : action === "stop"
            ? await stopScheduler()
            : await updateSchedulerConfig(selectedInterval, selectedUnderlying);
      setSchedulerStatus(response);
      setErrors((current) => ({ ...current, scheduler: undefined }));
      await refresh();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        scheduler: error instanceof Error ? error.message : "Scheduler request failed"
      }));
      setBusy(false);
    }
  }

  return (
    <main className="grid-sheen min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
        <Header
          lastUpdatedLabel={liveData?.fetched_at ? formatDateTime(liveData.fetched_at) : "Waiting for live data"}
          underlying="NIFTY / BANKNIFTY"
        />

        {authStatus && !authStatus.authenticated ? <LoginCard loginUrl={getLoginUrl()} /> : null}
        {authStatus?.authenticated && authStatus.login_required ? <AuthStatusCard loginUrl={getLoginUrl()} /> : null}

        <Card className="border-white/10 bg-slate-950/70">
          <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">{marketStatus?.phase ?? "loading"} market</p>
              <p className="mt-2 text-sm text-slate-300">
                Live tables use current Zerodha quotes. Historical PCR/OI panels use your scheduled snapshot history, ideally every 15 minutes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                Live refresh
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={refreshMinutes}
                  onChange={(event) => setRefreshMinutes(Math.max(1, Number(event.target.value) || 5))}
                  className="w-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                />
              </label>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                {marketStatus?.market_open ? `Closes ${formatDateTime(marketStatus.next_close)}` : `Opens ${formatDateTime(marketStatus?.next_open)}`}
              </div>
              <Button type="button" onClick={() => refresh()} disabled={busy}>
                {busy ? "Refreshing..." : "Refresh Now"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <SchedulerControl
          status={schedulerStatus}
          selectedInterval={selectedInterval}
          selectedUnderlying={selectedUnderlying}
          setSelectedInterval={setSelectedInterval}
          setSelectedUnderlying={setSelectedUnderlying}
          onStart={() => handleSchedulerAction("start")}
          onStop={() => handleSchedulerAction("stop")}
          onUpdate={() => handleSchedulerAction("update")}
          busy={busy}
          error={errors.scheduler ?? null}
        />

        {errors.live ? (
          <Card className="border-rose-500/20 bg-rose-500/10">
            <CardContent className="p-4 text-sm text-rose-100">{errors.live}</CardContent>
          </Card>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-3">
          <PCRCard
            pcr={pcrCurrent?.pcr}
            windowPcr={pcrCurrent?.window_pcr}
            delta={pcrDelta}
            totalCallOI={pcrCurrent?.total_call_oi}
            totalPutOI={pcrCurrent?.total_put_oi}
            referenceStrike={pcrCurrent?.reference_strike}
            windowStrikeCount={pcrCurrent?.window_strike_count}
            error={errors.pcr ?? null}
          />
          <MarketPulseCard overview={overview} error={errors.overview ?? null} />
          <ProbabilityCard probability={probability} error={errors.probability ?? null} />
        </section>

        <section className="grid gap-6">
          <PCRChart
            data={pcrHistory}
            error={errors.history ?? null}
            underlying={schedulerStatus?.underlying ?? selectedUnderlying}
            refreshToken={dataRefreshToken}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <SlabMomentum slabs={slabs} error={errors.slabs ?? null} />
          <SupportResistance levels={levels} error={errors.levels ?? null} />
        </section>

        <section className="grid gap-6">
          {(liveData?.contracts ?? []).map((contract) => (
            <div key={contract.id} className="grid gap-6">
              <LiveOptionContractTable contract={contract} />
              <GroupedSlabTable contract={contract} bucketSize={150} />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
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

function buildSchedulerDataSignature(status: SchedulerStatus | null) {
  if (!status) {
    return null;
  }

  const latestSnapshot = status.data_status?.latest_snapshot_timestamp ?? "no-snapshot";
  const latestPcr = status.data_status?.latest_pcr_timestamp ?? "no-pcr";
  const lastRun = status.last_run ?? "no-run";
  return `${status.underlying}:${latestSnapshot}:${latestPcr}:${lastRun}`;
}
