"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchAnalyticsFlow,
  fetchAnalyticsOverview,
  fetchAuthStatus,
  fetchLevels,
  fetchMarketStatus,
  fetchOIChange,
  fetchPCRCurrent,
  fetchPCRHistory,
  fetchProbabilityAnalytics,
  fetchSchedulerStatus,
  fetchSentiment,
  fetchSlabAnalytics,
  getLoginUrl,
  startScheduler,
  stopScheduler,
  updateSchedulerConfig,
  type AnalyticsFlowPoint,
  type AnalyticsOverview,
  type AuthStatus,
  type LevelsResponse,
  type MarketStatus,
  type OIChangeRow,
  type PCRCurrent,
  type PCRHistoryPoint,
  type ProbabilityAnalytics,
  type SchedulerStatus,
  type SlabAnalytics,
  type SentimentResponse
} from "@/lib/api";
import { AuthStatusCard } from "@/app/components/AuthStatusCard";
import { FlowChart } from "@/app/components/FlowChart";
import { Header } from "@/app/components/Header";
import { LoginCard } from "@/app/components/LoginCard";
import { MarketGuideCard } from "@/app/components/MarketGuideCard";
import { MarketPulseCard } from "@/app/components/MarketPulseCard";
import { PCRCard } from "@/app/components/PCRCard";
import { PCRChart } from "@/app/components/PCRChart";
import { ProbabilityCard } from "@/app/components/ProbabilityCard";
import { SchedulerControl } from "@/app/components/SchedulerControl";
import { SentimentCard } from "@/app/components/SentimentCard";
import { SlabMomentum } from "@/app/components/SlabMomentum";
import { StrikeTable } from "@/app/components/StrikeTable";
import { SupportResistance } from "@/app/components/SupportResistance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type DashboardErrors = Partial<
  Record<
    "pcr" | "history" | "oi" | "levels" | "sentiment" | "scheduler" | "overview" | "flow" | "slabs" | "probability" | "market",
    string
  >
>;

export default function DashboardPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [flowData, setFlowData] = useState<AnalyticsFlowPoint[]>([]);
  const [slabAnalytics, setSlabAnalytics] = useState<SlabAnalytics | null>(null);
  const [probability, setProbability] = useState<ProbabilityAnalytics | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [pcrCurrent, setPcrCurrent] = useState<PCRCurrent | null>(null);
  const [pcrHistory, setPcrHistory] = useState<PCRHistoryPoint[]>([]);
  const [oiRows, setOiRows] = useState<OIChangeRow[]>([]);
  const [spotLtp, setSpotLtp] = useState<number | null>(null);
  const [levels, setLevels] = useState<LevelsResponse | null>(null);
  const [sentiment, setSentiment] = useState<SentimentResponse | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [selectedInterval, setSelectedInterval] = useState(15);
  const [selectedUnderlying, setSelectedUnderlying] = useState("NIFTY");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<DashboardErrors>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  async function refresh() {
    const nextErrors: DashboardErrors = {};

    const [
      authResult,
      overviewResult,
      flowResult,
      slabsResult,
      probabilityResult,
      marketResult,
      pcrResult,
      historyResult,
      oiResult,
      levelsResult,
      sentimentResult,
      schedulerResult
    ] =
      await Promise.allSettled([
        fetchAuthStatus(),
        fetchAnalyticsOverview(),
        fetchAnalyticsFlow(32),
        fetchSlabAnalytics(),
        fetchProbabilityAnalytics(),
        fetchMarketStatus(),
        fetchPCRCurrent(),
        fetchPCRHistory(50),
        fetchOIChange(),
        fetchLevels(),
        fetchSentiment(),
        fetchSchedulerStatus()
      ]);

    if (authResult.status === "fulfilled") {
      setAuthStatus(authResult.value);
    }

    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
    } else {
      nextErrors.overview = overviewResult.reason instanceof Error ? overviewResult.reason.message : "Failed to load overview";
    }

    if (flowResult.status === "fulfilled") {
      setFlowData(flowResult.value);
    } else {
      nextErrors.flow = flowResult.reason instanceof Error ? flowResult.reason.message : "Failed to load OI flow";
    }

    if (slabsResult.status === "fulfilled") {
      setSlabAnalytics(slabsResult.value);
    } else {
      nextErrors.slabs = slabsResult.reason instanceof Error ? slabsResult.reason.message : "Failed to load slab flow";
    }

    if (probabilityResult.status === "fulfilled") {
      setProbability(probabilityResult.value);
    } else {
      nextErrors.probability =
        probabilityResult.reason instanceof Error ? probabilityResult.reason.message : "Failed to load probabilities";
    }

    if (marketResult.status === "fulfilled") {
      setMarketStatus(marketResult.value);
    } else {
      nextErrors.market = marketResult.reason instanceof Error ? marketResult.reason.message : "Failed to load market status";
    }

    if (pcrResult.status === "fulfilled") {
      setPcrCurrent(pcrResult.value);
    } else {
      nextErrors.pcr = pcrResult.reason instanceof Error ? pcrResult.reason.message : "Failed to load PCR";
    }

    if (historyResult.status === "fulfilled") {
      setPcrHistory(historyResult.value);
    } else {
      nextErrors.history = historyResult.reason instanceof Error ? historyResult.reason.message : "Failed to load history";
    }

    if (oiResult.status === "fulfilled") {
      setOiRows(oiResult.value.rows);
      setSpotLtp(oiResult.value.spot_ltp);
    } else {
      nextErrors.oi = oiResult.reason instanceof Error ? oiResult.reason.message : "Failed to load OI";
    }

    if (levelsResult.status === "fulfilled") {
      setLevels(levelsResult.value);
    } else {
      nextErrors.levels =
        levelsResult.reason instanceof Error ? levelsResult.reason.message : "Failed to load support/resistance";
    }

    if (sentimentResult.status === "fulfilled") {
      setSentiment(sentimentResult.value);
    } else {
      nextErrors.sentiment =
        sentimentResult.reason instanceof Error ? sentimentResult.reason.message : "Failed to load sentiment";
    }

    if (schedulerResult.status === "fulfilled") {
      setSchedulerStatus(schedulerResult.value);
      if (!schedulerStatus) {
        setSelectedInterval(schedulerResult.value.interval_minutes);
        setSelectedUnderlying(schedulerResult.value.underlying);
      }
    } else {
      nextErrors.scheduler =
        schedulerResult.reason instanceof Error ? schedulerResult.reason.message : "Failed to load scheduler";
    }

    setErrors(nextErrors);
    setLastUpdated(new Date().toISOString());
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const auth = searchParams.get("auth");
    const message = searchParams.get("message");
    if (auth === "success" && message) {
      setAuthMessage(message);
      window.history.replaceState({}, "", window.location.pathname);
    }

    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, []);

  const pcrDelta = useMemo(() => {
    if (pcrHistory.length < 2) {
      return 0;
    }
    return pcrHistory[pcrHistory.length - 1].pcr - pcrHistory[pcrHistory.length - 2].pcr;
  }, [pcrHistory]);
  const lastCatchUp = schedulerStatus?.last_catch_up;
  const isSeededMode = authStatus?.authenticated && spotLtp == null && oiRows.length > 0;
  const marketModeCard = !authStatus?.authenticated
    ? null
    : isSeededMode
      ? {
          title: "Seeded / Off-Market Mode",
          description: "Spot quote is unavailable, so the dashboard is rendering stored snapshots without live ATM detection."
        }
      : {
          title: "Live Quote Mode",
          description: "Spot quote is available, so ATM highlighting and analytics are based on the latest market reference."
        };

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
      if (action === "start" && response.last_catch_up) {
        const catchUp = response.last_catch_up;
        setAuthMessage(
          catchUp.catch_up_performed
            ? `Start completed. Added ${catchUp.pcr_points_inserted} historical PCR points and ${catchUp.snapshots_inserted} option snapshots before live tracking.`
            : "Start completed. No missing history was found, so live tracking resumed immediately."
        );
      }
      setErrors((current) => ({ ...current, scheduler: undefined }));
      await refresh();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        scheduler: error instanceof Error ? error.message : "Scheduler request failed"
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid-sheen min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <Header
          lastUpdatedLabel={lastUpdated ? new Date(lastUpdated).toLocaleString() : "Waiting for first refresh"}
          authMessage={authMessage}
          underlying={schedulerStatus?.underlying ?? selectedUnderlying}
        />

        {!authStatus?.authenticated ? <LoginCard loginUrl={getLoginUrl()} /> : null}
        {authStatus?.login_required && authStatus?.authenticated ? <AuthStatusCard loginUrl={getLoginUrl()} /> : null}
        <MarketGuideCard
          marketStatus={marketStatus}
          authStatus={authStatus}
          schedulerStatus={schedulerStatus}
          hasData={pcrHistory.length > 0}
        />

        {marketModeCard ? (
          <Card className={isSeededMode ? "border-warning/25" : "border-accent/20"}>
            <CardContent className="flex flex-col gap-2 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <p className={`text-sm font-semibold ${isSeededMode ? "text-warning" : "text-accent"}`}>
                  {marketModeCard.title}
                </p>
                <p className="mt-1 text-sm text-slate-300">{marketModeCard.description}</p>
              </div>
              <p className="text-sm text-slate-400">
                {spotLtp ? `Spot ${spotLtp.toFixed(2)}` : "Spot unavailable"}
              </p>
            </CardContent>
          </Card>
        ) : null}

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
        {lastCatchUp ? (
          <Card className="border-white/10 bg-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">Auto Catch-Up</CardTitle>
              <CardDescription>
                Start fills any missing stored history for the selected underlying before live snapshots continue.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-slate-300 md:grid-cols-4">
              <p>Window start: {lastCatchUp.from_timestamp ? new Date(lastCatchUp.from_timestamp).toLocaleString() : "Fresh backfill"}</p>
              <p>Window end: {new Date(lastCatchUp.to_timestamp).toLocaleString()}</p>
              <p>Snapshots added: {lastCatchUp.snapshots_inserted}</p>
              <p>PCR points added: {lastCatchUp.pcr_points_inserted}</p>
            </CardContent>
          </Card>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-3">
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
          <Card>
            <CardHeader>
              <CardTitle>Total Call OI</CardTitle>
              <CardDescription>Latest aggregated call open interest</CardDescription>
            </CardHeader>
            <CardContent>
              {errors.pcr ? (
                <p className="text-sm text-danger">{errors.pcr}</p>
              ) : (
                <p className="text-4xl font-bold text-white">
                  {pcrCurrent ? `${(pcrCurrent.total_call_oi / 100000).toFixed(1)}L` : "--"}
                </p>
              )}
            </CardContent>
          </Card>
          <SentimentCard sentiment={sentiment} error={errors.sentiment ?? null} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <FlowChart data={flowData} error={errors.flow ?? null} />
          <MarketPulseCard overview={overview} error={errors.overview ?? null} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <PCRChart data={pcrHistory} error={errors.history ?? null} />
          <ProbabilityCard probability={probability} error={errors.probability ?? null} />
        </section>
        <StrikeTable rows={oiRows} spotLtp={spotLtp} error={errors.oi ?? null} />
        <SlabMomentum slabs={slabAnalytics} error={errors.slabs ?? null} />
        <SupportResistance levels={levels} error={errors.levels ?? null} />
      </div>
    </main>
  );
}
