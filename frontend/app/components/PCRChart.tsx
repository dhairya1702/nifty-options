"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";

import {
  fetchPCRScopedHistory,
  fetchPCRScopedSubgroups,
  type PCRHistoryPoint,
  type PCRScopedHistoryResponse,
  type PCRScopedSubgroupResponse
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PCRChartProps = {
  data: PCRHistoryPoint[];
  error?: string | null;
  underlying?: string;
  refreshToken?: string;
};

type StrikeMode = "full" | "atm" | "custom_atm" | "custom";
type TimeMode = "all" | "today" | "previous_day" | "last_2_days" | "custom_date" | "custom_range";
const DELTA_PCR_DISPLAY_CAP = 10;
const STORAGE_KEY = "options-dashboard:pcr-chart-preferences";

export function PCRChart({ data, error, underlying, refreshToken }: PCRChartProps) {
  const [strikeMode, setStrikeMode] = useState<StrikeMode>("full");
  const [timeMode, setTimeMode] = useState<TimeMode>("all");
  const [showSma, setShowSma] = useState(true);
  const [smaPeriod, setSmaPeriod] = useState(5);
  const [atmWidth, setAtmWidth] = useState(500);
  const [customAtm, setCustomAtm] = useState("");
  const [customAtmWidth, setCustomAtmWidth] = useState(500);
  const [strikeMin, setStrikeMin] = useState("");
  const [strikeMax, setStrikeMax] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [fromTimestamp, setFromTimestamp] = useState("");
  const [toTimestamp, setToTimestamp] = useState("");
  const [bucketSize, setBucketSize] = useState(200);
  const [scopedData, setScopedData] = useState<PCRScopedHistoryResponse | null>(null);
  const [scopedError, setScopedError] = useState<string | null>(null);
  const [scopedBusy, setScopedBusy] = useState(false);
  const [subgroupData, setSubgroupData] = useState<PCRScopedSubgroupResponse | null>(null);
  const [subgroupError, setSubgroupError] = useState<string | null>(null);
  const [subgroupBusy, setSubgroupBusy] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const storageScope = underlying ?? "default";

  useEffect(() => {
    setPreferencesReady(false);
    const preferences = readStoredPreferences(storageScope);
    setStrikeMode(preferences.strikeMode);
    setTimeMode(preferences.timeMode);
    setShowSma(preferences.showSma);
    setSmaPeriod(preferences.smaPeriod);
    setAtmWidth(preferences.atmWidth);
    setCustomAtm(preferences.customAtm);
    setCustomAtmWidth(preferences.customAtmWidth);
    setStrikeMin(preferences.strikeMin);
    setStrikeMax(preferences.strikeMax);
    setCustomDate(preferences.customDate);
    setFromTimestamp(preferences.fromTimestamp);
    setToTimestamp(preferences.toTimestamp);
    setBucketSize(preferences.bucketSize);
    setPreferencesReady(true);
  }, [storageScope]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }

    writeStoredPreferences(storageScope, {
      strikeMode,
      timeMode,
      showSma,
      smaPeriod,
      atmWidth,
      customAtm,
      customAtmWidth,
      strikeMin,
      strikeMax,
      customDate,
      fromTimestamp,
      toTimestamp,
      bucketSize
    });
  }, [
    preferencesReady,
    storageScope,
    strikeMode,
    timeMode,
    showSma,
    smaPeriod,
    atmWidth,
    customAtm,
    customAtmWidth,
    strikeMin,
    strikeMax,
    customDate,
    fromTimestamp,
    toTimestamp,
    bucketSize
  ]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }

    let cancelled = false;

    async function loadScopedHistory() {
      setScopedBusy(true);
      try {
        const response = await fetchPCRScopedHistory({
          strikeMode,
          timeMode,
          widthPoints: strikeMode === "atm" ? atmWidth : strikeMode === "custom_atm" ? customAtmWidth : undefined,
          customAtm: strikeMode === "custom_atm" ? Number(customAtm) : undefined,
          strikeMin: strikeMode === "custom" ? Number(strikeMin) : undefined,
          strikeMax: strikeMode === "custom" ? Number(strikeMax) : undefined,
          customDate: timeMode === "custom_date" ? customDate : undefined,
          fromTimestamp: timeMode === "custom_range" ? fromTimestamp : undefined,
          toTimestamp: timeMode === "custom_range" ? toTimestamp : undefined,
          limit: 128
        });

        if (!cancelled) {
          setScopedData(response);
          setScopedError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setScopedError(loadError instanceof Error ? loadError.message : "Failed to load scoped PCR history");
          setScopedData(null);
        }
      } finally {
        if (!cancelled) {
          setScopedBusy(false);
        }
      }
    }

    if (strikeMode === "custom") {
      if (!strikeMin.trim() || !strikeMax.trim()) {
        setScopedData(null);
        setScopedError("Enter both strike bounds for custom range mode.");
        return;
      }
      if (Number.isNaN(Number(strikeMin)) || Number.isNaN(Number(strikeMax))) {
        setScopedData(null);
        setScopedError("Strike bounds must be numeric.");
        return;
      }
    }

    if (strikeMode === "custom_atm") {
      if (!customAtm.trim()) {
        setScopedData(null);
        setScopedError("Enter a custom ATM strike.");
        return;
      }
      if (Number.isNaN(Number(customAtm))) {
        setScopedData(null);
        setScopedError("Custom ATM strike must be numeric.");
        return;
      }
    }

    if (timeMode === "custom_date" && !customDate) {
      setScopedData(null);
      setScopedError("Pick a custom date.");
      return;
    }

    if (timeMode === "custom_range") {
      if (!fromTimestamp || !toTimestamp) {
        setScopedData(null);
        setScopedError("Enter both start and end date-time values.");
        return;
      }
    }

    loadScopedHistory();
    return () => {
      cancelled = true;
    };
  }, [strikeMode, timeMode, atmWidth, customAtm, customAtmWidth, strikeMin, strikeMax, customDate, fromTimestamp, toTimestamp, underlying, refreshToken, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }

    let cancelled = false;

    async function loadSubgroups() {
      setSubgroupBusy(true);
      try {
        const response = await fetchPCRScopedSubgroups({
          strikeMode,
          timeMode,
          bucketSize,
          widthPoints: strikeMode === "atm" ? atmWidth : strikeMode === "custom_atm" ? customAtmWidth : undefined,
          customAtm: strikeMode === "custom_atm" ? Number(customAtm) : undefined,
          strikeMin: strikeMode === "custom" ? Number(strikeMin) : undefined,
          strikeMax: strikeMode === "custom" ? Number(strikeMax) : undefined,
          customDate: timeMode === "custom_date" ? customDate : undefined,
          fromTimestamp: timeMode === "custom_range" ? fromTimestamp : undefined,
          toTimestamp: timeMode === "custom_range" ? toTimestamp : undefined
        });
        if (!cancelled) {
          setSubgroupData(response);
          setSubgroupError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setSubgroupError(loadError instanceof Error ? loadError.message : "Failed to load subgroup breakdown");
          setSubgroupData(null);
        }
      } finally {
        if (!cancelled) {
          setSubgroupBusy(false);
        }
      }
    }

    if (strikeMode === "custom" && (!strikeMin.trim() || !strikeMax.trim() || Number.isNaN(Number(strikeMin)) || Number.isNaN(Number(strikeMax)))) {
      setSubgroupData(null);
      return;
    }
    if (strikeMode === "custom_atm" && (!customAtm.trim() || Number.isNaN(Number(customAtm)))) {
      setSubgroupData(null);
      return;
    }
    if (timeMode === "custom_date" && !customDate) {
      setSubgroupData(null);
      return;
    }
    if (timeMode === "custom_range" && (!fromTimestamp || !toTimestamp)) {
      setSubgroupData(null);
      return;
    }

    loadSubgroups();
    return () => {
      cancelled = true;
    };
  }, [strikeMode, timeMode, bucketSize, atmWidth, customAtm, customAtmWidth, strikeMin, strikeMax, customDate, fromTimestamp, toTimestamp, underlying, refreshToken, preferencesReady]);

  const chartData = scopedData?.points ?? (strikeMode === "full" && timeMode === "all" ? data : []);
  const pcrChartData = useMemo(
    () => addSimpleMovingAverage(chartData, Math.max(2, smaPeriod)),
    [chartData, smaPeriod]
  );
  const activeError = scopedError ?? (strikeMode === "full" && timeMode === "all" ? (error ?? null) : null);
  const subtitle = buildSubtitle(strikeMode, timeMode, scopedData, underlying);
  const subgroupHeat = useMemo(() => {
    const rows = subgroupData?.rows ?? [];
    const maxAbsDeltaCall = Math.max(1, ...rows.map((row) => Math.abs(row.delta_call_oi)));
    const maxAbsDeltaPut = Math.max(1, ...rows.map((row) => Math.abs(row.delta_put_oi)));
    const maxDeltaPcr = Math.max(1, ...rows.map((row) => clipDeltaPcr(row.delta_pcr)));
    return { maxAbsDeltaCall, maxAbsDeltaPut, maxDeltaPcr };
  }, [subgroupData]);
  const rangeAnchorPcrData = useMemo(() => {
    if (chartData.length === 0) {
      return [];
    }

    const firstPoint = chartData[0];
    const baseCallOi = "total_call_oi" in firstPoint ? Number(firstPoint.total_call_oi ?? 0) : 0;
    const basePutOi = "total_put_oi" in firstPoint ? Number(firstPoint.total_put_oi ?? 0) : 0;

    return chartData.map((point, index) => {
      const totalCallOi = "total_call_oi" in point ? Number(point.total_call_oi ?? 0) : 0;
      const totalPutOi = "total_put_oi" in point ? Number(point.total_put_oi ?? 0) : 0;
      const rangeCallChange = roundToTwo(totalCallOi - baseCallOi);
      const rangePutChange = roundToTwo(totalPutOi - basePutOi);
      const adjustedRangeCall = rangeCallChange <= 0 ? 1 : rangeCallChange;
      const adjustedRangePut = rangePutChange < 0 ? 1 : rangePutChange;

      return {
        timestamp: point.timestamp,
        total_call_oi: totalCallOi,
        total_put_oi: totalPutOi,
        range_call_change: rangeCallChange,
        range_put_change: rangePutChange,
        adjusted_call_oi: adjustedRangeCall,
        adjusted_put_oi: adjustedRangePut,
        range_delta_pcr: index === 0 ? 0 : clipDeltaPcr(roundToFour(Math.abs(adjustedRangePut / adjustedRangeCall)))
      };
    });
  }, [chartData]);
  const rangeAnchorPcrChartData = useMemo(
    () => addSimpleMovingAverage(rangeAnchorPcrData, Math.max(2, smaPeriod), "range_delta_pcr", "sma_range_delta_pcr"),
    [rangeAnchorPcrData, smaPeriod]
  );
  const rangeDeltaPcrAxisMax = useMemo(
    () => computeDeltaPcrAxisMax(rangeAnchorPcrData.map((point) => point.range_delta_pcr)),
    [rangeAnchorPcrData]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>PCR Over Time</CardTitle>
            <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant={strikeMode === "full" ? "default" : "outline"} onClick={() => setStrikeMode("full")}>
              Full Chain
            </Button>
            <Button type="button" variant={strikeMode === "atm" ? "default" : "outline"} onClick={() => setStrikeMode("atm")}>
              ATM Range
            </Button>
            <Button type="button" variant={strikeMode === "custom_atm" ? "default" : "outline"} onClick={() => setStrikeMode("custom_atm")}>
              Custom ATM
            </Button>
            <Button type="button" variant={strikeMode === "custom" ? "default" : "outline"} onClick={() => setStrikeMode("custom")}>
              Custom Bounds
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant={timeMode === "all" ? "default" : "outline"} onClick={() => setTimeMode("all")}>
            All
          </Button>
          <Button type="button" variant={timeMode === "today" ? "default" : "outline"} onClick={() => setTimeMode("today")}>
            Today
          </Button>
          <Button type="button" variant={timeMode === "previous_day" ? "default" : "outline"} onClick={() => setTimeMode("previous_day")}>
            Prev Day
          </Button>
          <Button type="button" variant={timeMode === "last_2_days" ? "default" : "outline"} onClick={() => setTimeMode("last_2_days")}>
            Last 2 Days
          </Button>
          <Button type="button" variant={timeMode === "custom_date" ? "default" : "outline"} onClick={() => setTimeMode("custom_date")}>
            Custom Date
          </Button>
          <Button type="button" variant={timeMode === "custom_range" ? "default" : "outline"} onClick={() => setTimeMode("custom_range")}>
            Date-Time
          </Button>
        </div>
        {strikeMode === "atm" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              ATM +/- points
              <input
                type="number"
                min={50}
                max={5000}
                step={50}
                value={atmWidth}
                onChange={(event) => setAtmWidth(Math.max(50, Number(event.target.value) || 500))}
                className="w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
              />
            </label>
            {scopedBusy ? <p className="text-sm text-slate-400">Loading scoped history...</p> : null}
          </div>
        ) : null}
        {strikeMode === "custom_atm" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              ATM strike
              <input
                type="number"
                step={50}
                value={customAtm}
                onChange={(event) => setCustomAtm(event.target.value)}
                className="w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              +/- points
              <input
                type="number"
                min={50}
                max={5000}
                step={50}
                value={customAtmWidth}
                onChange={(event) => setCustomAtmWidth(Math.max(50, Number(event.target.value) || 500))}
                className="w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
              />
            </label>
            {scopedBusy ? <p className="text-sm text-slate-400">Loading scoped history...</p> : null}
          </div>
        ) : null}
        {strikeMode === "custom" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              Strike min
              <input
                type="number"
                step={50}
                value={strikeMin}
                onChange={(event) => setStrikeMin(event.target.value)}
                className="w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              Strike max
              <input
                type="number"
                step={50}
                value={strikeMax}
                onChange={(event) => setStrikeMax(event.target.value)}
                className="w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
              />
            </label>
            {scopedBusy ? <p className="text-sm text-slate-400">Loading scoped history...</p> : null}
          </div>
        ) : null}
        {timeMode === "custom_date" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              IST date
              <input
                type="date"
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none"
              />
            </label>
            {scopedBusy ? <p className="text-sm text-slate-400">Loading scoped history...</p> : null}
          </div>
        ) : null}
        {timeMode === "custom_range" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              From IST
              <input
                type="datetime-local"
                value={fromTimestamp}
                onChange={(event) => setFromTimestamp(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              To IST
              <input
                type="datetime-local"
                value={toTimestamp}
                onChange={(event) => setToTimestamp(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none"
              />
            </label>
            {scopedBusy ? <p className="text-sm text-slate-400">Loading scoped history...</p> : null}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showSma}
              onChange={(event) => setShowSma(event.target.checked)}
              className="h-4 w-4 rounded border border-white/10 bg-slate-950 accent-[#ffd166]"
            />
            Show SMA
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            SMA points
            <input
              type="number"
              min={2}
              max={50}
              step={1}
              value={smaPeriod}
              onChange={(event) => setSmaPeriod(clampStoredNumber(Number(event.target.value), 5, 2, 50))}
              className="w-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
            />
          </label>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span className="h-0.5 w-5 rounded bg-[#00d4aa]" />
              PCR
            </span>
            {showSma ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-5 rounded bg-[#ffd166]" />
                {`SMA(${smaPeriod})`}
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        {activeError ? (
          <p className="text-sm text-danger">{activeError}</p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-slate-400">No PCR history available for the selected range.</p>
        ) : (
          <>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pcrChartData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(value) => formatChartTime(value)}
                    stroke="#7c879f"
                  />
                  <YAxis domain={["auto", "auto"]} stroke="#7c879f" />
                  <Tooltip
                    contentStyle={{ background: "#151927", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                    labelFormatter={(value) => formatFullDateTime(value)}
                    formatter={(value: number, name: string) => [
                      formatFixed(value, 4),
                      name === "sma" ? `SMA(${smaPeriod})` : "PCR"
                    ]}
                  />
                  <Line type="monotone" dataKey="pcr" stroke="#00d4aa" strokeWidth={3} dot={{ fill: "#00d4aa" }} />
                  {showSma ? (
                    <Line type="monotone" dataKey="sma" stroke="#ffd166" strokeWidth={2} dot={false} connectNulls />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div className="mb-3">
                <p className="text-sm font-semibold text-white">PCR of OI Change From Range Start</p>
                <p className="text-xs text-slate-400">Each point compares scoped call and put OI back to the first timestamp in the selected range.</p>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rangeAnchorPcrChartData}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(value) => formatChartTime(value)}
                      stroke="#7c879f"
                    />
                    <YAxis domain={[0, rangeDeltaPcrAxisMax]} stroke="#7c879f" />
                    <Tooltip
                      contentStyle={{ background: "#151927", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                      labelFormatter={(value) => formatFullDateTime(value)}
                      formatter={(value, name: string) => [
                        formatFixed(value, 4),
                        name === "sma_range_delta_pcr" ? `Range-Start Delta PCR SMA(${smaPeriod})` : "Range-Start Delta PCR"
                      ]}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                    <Line type="monotone" dataKey="range_delta_pcr" stroke="#7ae582" strokeWidth={3} dot={{ fill: "#7ae582" }} />
                    {showSma ? (
                      <Line type="monotone" dataKey="sma_range_delta_pcr" stroke="#f4a261" strokeWidth={2} dot={false} connectNulls />
                    ) : null}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function buildSubtitle(strikeMode: StrikeMode, timeMode: TimeMode, scopedData: PCRScopedHistoryResponse | null, underlying?: string) {
  const timeLabel = timeModeLabel(timeMode, scopedData);

  if (!scopedData) {
    if (strikeMode === "full") {
      return `${underlying ?? "Selected"} full-chain PCR history, ${timeLabel}`;
    }
    if (strikeMode === "atm") {
      return `ATM-centered strike band PCR history, ${timeLabel}`;
    }
    if (strikeMode === "custom_atm") {
      return `Custom ATM-centered strike band PCR history, ${timeLabel}`;
    }
    return `Custom strike-band PCR history, ${timeLabel}`;
  }

  if (scopedData.strike_mode === "full") {
    return `${scopedData.underlying} full-chain PCR history, ${timeLabel}`;
  }

  if (scopedData.strike_mode === "custom_atm" && scopedData.custom_atm != null) {
    return `${scopedData.underlying} custom ATM ${Math.round(scopedData.custom_atm)} with strikes ${Math.round(scopedData.strike_min ?? 0)}-${Math.round(scopedData.strike_max ?? 0)}, ${timeLabel}`;
  }

  if (scopedData.strike_mode === "atm" && scopedData.atm_strike != null) {
    return `${scopedData.underlying} auto ATM ${Math.round(scopedData.atm_strike)} with strikes ${Math.round(scopedData.strike_min ?? 0)}-${Math.round(scopedData.strike_max ?? 0)}, ${timeLabel}`;
  }

  return `${scopedData.underlying} strikes ${Math.round(scopedData.strike_min ?? 0)}-${Math.round(scopedData.strike_max ?? 0)}, ${timeLabel}`;
}

function timeModeLabel(timeMode: TimeMode, scopedData: PCRScopedHistoryResponse | null) {
  if (timeMode === "all") {
    return "all timestamps";
  }
  if (timeMode === "today") {
    return "today";
  }
  if (timeMode === "previous_day") {
    return "previous trading day";
  }
  if (timeMode === "last_2_days") {
    return "last 2 trading days";
  }
  if (scopedData?.from_timestamp && scopedData?.to_timestamp) {
    return `${formatShortDateTime(scopedData.from_timestamp)} to ${formatShortDateTime(scopedData.to_timestamp)}`;
  }
  if (timeMode === "custom_date") {
    return "custom date";
  }
  return "custom date-time range";
}

function asFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asValidDate(value: unknown) {
  const date = new Date(typeof value === "string" || typeof value === "number" ? value : "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatChartTime(value: unknown) {
  const date = asValidDate(value);
  if (!date) {
    return "--";
  }
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

function formatFullDateTime(value: unknown) {
  const date = asValidDate(value);
  if (!date) {
    return "--";
  }
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function formatShortDateTime(value: string) {
  const date = asValidDate(value);
  if (!date) {
    return "--";
  }
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function roundToFour(value: number) {
  return Math.round(value * 10000) / 10000;
}

function clipDeltaPcr(value: number) {
  const numeric = asFiniteNumber(value);
  if (numeric == null) {
    return 0;
  }
  return Math.min(Math.max(numeric, 0), DELTA_PCR_DISPLAY_CAP);
}

function computeDeltaPcrAxisMax(values: number[]) {
  const cappedMax = values.reduce((maxValue, value) => Math.max(maxValue, clipDeltaPcr(value)), 0);
  if (cappedMax <= 0) {
    return 1;
  }
  const padded = cappedMax * 1.12;
  return Math.min(DELTA_PCR_DISPLAY_CAP, Math.max(0.5, roundToTwo(padded)));
}

function formatFixed(value: unknown, digits: number) {
  const numeric = asFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  return numeric.toFixed(digits);
}

function formatCompact(value: number) {
  const numeric = asFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    notation: "compact"
  }).format(numeric);
}

function formatSignedCompact(value: number) {
  const numeric = asFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  const compact = formatCompact(Math.abs(numeric));
  return `${numeric >= 0 ? "+" : "-"}${compact}`;
}


type StoredPreferences = {
  strikeMode: StrikeMode;
  timeMode: TimeMode;
  showSma: boolean;
  smaPeriod: number;
  atmWidth: number;
  customAtm: string;
  customAtmWidth: number;
  strikeMin: string;
  strikeMax: string;
  customDate: string;
  fromTimestamp: string;
  toTimestamp: string;
  bucketSize: number;
};

function defaultPreferences(): StoredPreferences {
  return {
    strikeMode: "full",
    timeMode: "all",
    showSma: true,
    smaPeriod: 5,
    atmWidth: 500,
    customAtm: "",
    customAtmWidth: 500,
    strikeMin: "",
    strikeMax: "",
    customDate: "",
    fromTimestamp: "",
    toTimestamp: "",
    bucketSize: 200
  };
}

function readStoredPreferences(scope: string): StoredPreferences {
  if (typeof window === "undefined") {
    return defaultPreferences();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultPreferences();
    }

    const stored = JSON.parse(raw) as Record<string, Partial<StoredPreferences>>;
    const scoped = stored[scope];
    if (!scoped) {
      return defaultPreferences();
    }

    return {
      strikeMode: isStrikeMode(scoped.strikeMode) ? scoped.strikeMode : "full",
      timeMode: isTimeMode(scoped.timeMode) ? scoped.timeMode : "all",
      showSma: typeof scoped.showSma === "boolean" ? scoped.showSma : true,
      smaPeriod: clampStoredNumber(asStoredNumber(scoped.smaPeriod, 5), 5, 2, 50),
      atmWidth: asStoredNumber(scoped.atmWidth, 500),
      customAtm: typeof scoped.customAtm === "string" ? scoped.customAtm : "",
      customAtmWidth: asStoredNumber(scoped.customAtmWidth, 500),
      strikeMin: typeof scoped.strikeMin === "string" ? scoped.strikeMin : "",
      strikeMax: typeof scoped.strikeMax === "string" ? scoped.strikeMax : "",
      customDate: typeof scoped.customDate === "string" ? scoped.customDate : "",
      fromTimestamp: typeof scoped.fromTimestamp === "string" ? scoped.fromTimestamp : "",
      toTimestamp: typeof scoped.toTimestamp === "string" ? scoped.toTimestamp : "",
      bucketSize: asStoredNumber(scoped.bucketSize, 200)
    };
  } catch {
    return defaultPreferences();
  }
}

function writeStoredPreferences(scope: string, preferences: StoredPreferences) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, StoredPreferences>) : {};
    stored[scope] = preferences;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Ignore storage failures and keep the in-memory state usable.
  }
}

function isStrikeMode(value: unknown): value is StrikeMode {
  return value === "full" || value === "atm" || value === "custom_atm" || value === "custom";
}

function isTimeMode(value: unknown): value is TimeMode {
  return (
    value === "all" ||
    value === "today" ||
    value === "previous_day" ||
    value === "last_2_days" ||
    value === "custom_date" ||
    value === "custom_range"
  );
}

function asStoredNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampStoredNumber(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function addSimpleMovingAverage<T extends Record<string, unknown>>(
  rows: T[],
  period: number,
  sourceKey: keyof T = "pcr",
  targetKey = "sma"
) {
  if (rows.length === 0) {
    return [];
  }

  return rows.map((row, index) => {
    if (index + 1 < period) {
      return { ...row, [targetKey]: null };
    }

    let sum = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      sum += Number(rows[cursor]?.[sourceKey] ?? 0);
    }

    return {
      ...row,
      [targetKey]: roundToFour(sum / period)
    };
  });
}
