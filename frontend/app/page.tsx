"use client";

import { useEffect, useMemo, useState } from "react";

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
import {
  DecisionTemplateCard,
  type DecisionTemplateSection,
  type ScoreMap
} from "@/app/components/DecisionTemplateCard";
import { GroupedSlabTable } from "@/app/components/GroupedSlabTable";
import { Header } from "@/app/components/Header";
import { LiveOptionContractTable } from "@/app/components/LiveOptionContractTable";
import { LoginCard } from "@/app/components/LoginCard";
import { MarketPulseCard } from "@/app/components/MarketPulseCard";
import { OptionReferenceCard } from "@/app/components/OptionReferenceCard";
import { PCRCard } from "@/app/components/PCRCard";
import { PCRChart } from "@/app/components/PCRChart";
import { ProbabilityCard } from "@/app/components/ProbabilityCard";
import { SchedulerControl } from "@/app/components/SchedulerControl";
import { SlabMomentum } from "@/app/components/SlabMomentum";
import { SupportResistance } from "@/app/components/SupportResistance";
import { TradeCallCard } from "@/app/components/TradeCallCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SCORE_STORAGE_KEY = "decision-template-scores-v1";
const TEMPLATE_SECTIONS: DecisionTemplateSection[] = [
  {
    id: "global",
    title: "Global Sentiment",
    groups: [
      {
        id: "geopolitical",
        title: "Geopolitical",
        factors: ["US-Russia", "Russia-Ukraine", "Israel-Iran", "Middle East", "US-China", "US-Europe", "US-Iran", "Indo-Pak"]
      },
      {
        id: "financial",
        title: "Financial",
        factors: ["US Bond Yield", "US Dollar Index", "Fed Interest Rate", "Employment Data", "CPI/PPI", "Crude Oil", "Gold"]
      },
      {
        id: "us_sentiment",
        title: "US Sentiment",
        factors: ["Election", "Tariff situation", "Recession fear", "Inflation"]
      },
      {
        id: "indices",
        title: "Global Indices",
        factors: ["Nasdaq", "Dow Jones", "S&P500", "DAX", "FTSE"]
      }
    ]
  },
  {
    id: "india",
    title: "India Sentiment",
    groups: [
      {
        id: "geopolitical",
        title: "Geopolitical",
        factors: ["Indo-Pak", "Indo-US", "Indo-China", "Indo-Canada", "Europe", "Middle East", "Asia"]
      },
      {
        id: "financial",
        title: "Financial",
        factors: ["GDP", "GST", "Inflation", "RBI MPC", "Interest Rate", "CRR", "Liquidity", "NPA", "Fiscal Deficit"]
      },
      {
        id: "sentiment",
        title: "Sentiment",
        factors: [
          "IMD Forecast",
          "Elections",
          "State Elections",
          "Corporate Earnings",
          "Infrastructure Spending",
          "Consumer Spending",
          "Rural Economy"
        ]
      },
      {
        id: "indices",
        title: "Indices",
        factors: ["Sensex", "Nifty", "BankNifty", "Nifty-IT", "Nifty-Auto", "Nifty-Metal", "Nifty-Pharma", "FMCG"]
      },
      {
        id: "trend",
        title: "Trend",
        factors: ["Weekly", "Monthly", "Half-Yearly", "Nifty 20DMA", "Nifty 50DMA", "BN 20DMA", "BN 50DMA"]
      },
      {
        id: "fii_dii",
        title: "FII/DII",
        factors: ["FII Buy/Sell", "DII", "F&O activity", "US Tariff impact"]
      }
    ]
  }
];

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
  const [scores, setScores] = useState<ScoreMap>(buildDefaultScores());
  const [selectedInterval, setSelectedInterval] = useState(15);
  const [selectedUnderlying, setSelectedUnderlying] = useState("NIFTY");
  const [refreshMinutes, setRefreshMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<DashboardErrors>({});

  useEffect(() => {
    const stored = window.localStorage.getItem(SCORE_STORAGE_KEY);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as ScoreMap;
      setScores((current) => ({ ...current, ...parsed }));
    } catch {
      // Ignore invalid storage payloads.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(scores));
  }, [scores]);

  async function refresh() {
    setBusy(true);
    const nextErrors: DashboardErrors = {};

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
      setSchedulerStatus(schedulerResult.value);
      setSelectedInterval(schedulerResult.value.interval_minutes);
      setSelectedUnderlying(schedulerResult.value.underlying);
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
    setBusy(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const delay = (marketStatus?.market_open ? refreshMinutes : 15) * 60 * 1000;
    const interval = window.setInterval(() => {
      refresh();
    }, delay);
    return () => window.clearInterval(interval);
  }, [marketStatus?.market_open, refreshMinutes]);

  const sectionScores = useMemo(() => buildSectionScores(TEMPLATE_SECTIONS, scores), [scores]);
  const compositeScore = useMemo(() => {
    const values = Object.values(sectionScores);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 5;
  }, [sectionScores]);
  const pcrDelta = useMemo(() => {
    if (pcrHistory.length < 2) {
      return 0;
    }
    return pcrHistory[pcrHistory.length - 1].pcr - pcrHistory[pcrHistory.length - 2].pcr;
  }, [pcrHistory]);
  const tradeCall = useMemo(() => deriveTradeCall(liveData?.contracts ?? [], compositeScore), [liveData, compositeScore]);

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

        {!authStatus?.authenticated ? <LoginCard loginUrl={getLoginUrl()} /> : null}
        {authStatus?.login_required && authStatus?.authenticated ? <AuthStatusCard loginUrl={getLoginUrl()} /> : null}

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

        <TradeCallCard
          label={tradeCall.label}
          reasoning={tradeCall.reasoning}
          compositeScore={compositeScore}
          concentrationSummary={tradeCall.concentrationSummary}
        />

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
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <SlabMomentum slabs={slabs} error={errors.slabs ?? null} />
          <SupportResistance levels={levels} error={errors.levels ?? null} />
        </section>

        <DecisionTemplateCard
          sections={TEMPLATE_SECTIONS}
          scores={scores}
          sectionScores={sectionScores}
          compositeScore={compositeScore}
          onScoreChange={(key, value) => {
            const cleaned = Number.isFinite(value) ? Math.min(10, Math.max(1, Math.round(value))) : 5;
            setScores((current) => ({ ...current, [key]: cleaned }));
          }}
        />

        <OptionReferenceCard />

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

function buildDefaultScores() {
  const defaults: ScoreMap = {};
  for (const section of TEMPLATE_SECTIONS) {
    for (const group of section.groups) {
      for (const factor of group.factors) {
        defaults[`${section.id}:${group.id}:${factor}`] = 5;
      }
    }
  }
  return defaults;
}

function buildSectionScores(sections: DecisionTemplateSection[], scores: ScoreMap) {
  const sectionScores: Record<string, number> = {};
  for (const section of sections) {
    const groupScores = section.groups.map((group) => {
      const values = group.factors.map((factor) => scores[`${section.id}:${group.id}:${factor}`] ?? 5);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    });
    sectionScores[section.id] = groupScores.reduce((sum, value) => sum + value, 0) / groupScores.length;
  }
  return sectionScores;
}

function deriveTradeCall(contracts: LiveOptionChainResponse["contracts"], compositeScore: number) {
  if (!contracts.length) {
    return {
      label: "Neutral / No Trade",
      reasoning: "Live option-chain data is not available yet, so there is no defensible trade call.",
      concentrationSummary: "Waiting for authenticated Zerodha data."
    };
  }

  const concentrations = {
    greenAbove: 0,
    greenBelow: 0,
    redAbove: 0,
    redBelow: 0
  };

  for (const contract of contracts) {
    for (const row of contract.rows) {
      const aboveSpot = row.strike_price >= contract.spot_ltp;
      if (row.cpa_difference > 0) {
        concentrations[aboveSpot ? "greenAbove" : "greenBelow"] += row.cpa_difference;
      } else if (row.cpa_difference < 0) {
        concentrations[aboveSpot ? "redAbove" : "redBelow"] += Math.abs(row.cpa_difference);
      }
    }
  }

  const primary = contracts[0];
  const strongestBucket = Object.entries(concentrations).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "mixed";
  const topCallOi = topStrikes(primary.rows, "call_oi");
  const topPutOi = topStrikes(primary.rows, "put_oi");
  const topGreenAbove = topSignalStrikes(contracts, "positive", true);
  const topGreenBelow = topSignalStrikes(contracts, "positive", false);
  const topRedAbove = topSignalStrikes(contracts, "negative", true);
  const topRedBelow = topSignalStrikes(contracts, "negative", false);

  let label = "Neutral / No Trade";
  let reasoning = `Signals are mixed. ${primary.label} PCR = ${primary.pcr.toFixed(2)}, sentiment score ${compositeScore.toFixed(
    1
  )}/10. Use PCR slope, OI flow, and slab migration before taking a directional position.`;

  if (compositeScore >= 6.5 && strongestBucket === "greenAbove") {
    label = "Call Buy";
    reasoning = `Green concentration is above spot at ${topGreenAbove}, PCR = ${primary.pcr.toFixed(
      2
    )}, sentiment score ${compositeScore.toFixed(1)}/10 -> bullish bias -> consider Call Buy.`;
  } else if (compositeScore <= 3.5 && strongestBucket === "redBelow") {
    label = "Put Buy";
    reasoning = `Red concentration is below spot at ${topRedBelow}, PCR = ${primary.pcr.toFixed(
      2
    )}, sentiment score ${compositeScore.toFixed(1)}/10 -> bearish bias -> consider Put Buy.`;
  } else if (compositeScore >= 6 && strongestBucket === "greenBelow") {
    label = "Put Sell";
    reasoning = `Green concentration is strongest below spot at ${topGreenBelow}, showing support-style put writing with ${compositeScore.toFixed(
      1
    )}/10 sentiment -> consider Put Sell.`;
  } else if (compositeScore <= 4 && strongestBucket === "redAbove") {
    label = "Call Sell";
    reasoning = `Red concentration is strongest above spot at ${topRedAbove}, showing resistance-style call writing with ${compositeScore.toFixed(
      1
    )}/10 sentiment -> consider Call Sell.`;
  }

  return {
    label,
    reasoning,
    concentrationSummary: `Primary call OI clusters: ${topCallOi}. Primary put OI clusters: ${topPutOi}. Green above ${formatCompact(
      concentrations.greenAbove
    )}, green below ${formatCompact(concentrations.greenBelow)}, red above ${formatCompact(
      concentrations.redAbove
    )}, red below ${formatCompact(concentrations.redBelow)}.`
  };
}

function topStrikes(rows: LiveOptionChainResponse["contracts"][number]["rows"], key: "call_oi" | "put_oi") {
  return [...rows]
    .sort((a, b) => b[key] - a[key])
    .slice(0, 2)
    .map((row) => String(row.strike_price))
    .join(" and ");
}

function topSignalStrikes(
  contracts: LiveOptionChainResponse["contracts"],
  direction: "positive" | "negative",
  aboveSpot: boolean
) {
  const matches = contracts.flatMap((contract) =>
    contract.rows
      .filter((row) => (aboveSpot ? row.strike_price >= contract.spot_ltp : row.strike_price < contract.spot_ltp))
      .filter((row) => (direction === "positive" ? row.cpa_difference > 0 : row.cpa_difference < 0))
      .map((row) => ({
        label: `${contract.label} ${row.strike_price}`,
        score: Math.abs(row.cpa_difference)
      }))
  );

  const top = matches.sort((a, b) => b.score - a.score).slice(0, 3);
  return top.length ? top.map((item) => item.label).join(", ") : "no dominant strikes";
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

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    notation: "compact"
  }).format(value);
}
