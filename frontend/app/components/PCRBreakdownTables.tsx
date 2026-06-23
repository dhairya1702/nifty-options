"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchPCRScopedHistory,
  fetchPCRScopedSubgroups,
  type PCRScopedHistoryResponse,
  type PCRScopedSubgroupResponse
} from "@/lib/api";

type PCRBreakdownTablesProps = {
  underlying?: string;
  refreshToken?: string;
};

type StrikeMode = "full" | "atm" | "custom_atm" | "custom";
type TimeMode = "all" | "today" | "previous_day" | "last_2_days" | "custom_date" | "custom_range";

const STORAGE_KEY = "options-dashboard:pcr-chart-preferences";

export function PCRBreakdownTables({ underlying, refreshToken }: PCRBreakdownTablesProps) {
  const [bucketSize, setBucketSize] = useState(200);
  const [scopedData, setScopedData] = useState<PCRScopedHistoryResponse | null>(null);
  const [subgroupData, setSubgroupData] = useState<PCRScopedSubgroupResponse | null>(null);
  const [subgroupError, setSubgroupError] = useState<string | null>(null);
  const [subgroupBusy, setSubgroupBusy] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [prefs, setPrefs] = useState(defaultPreferences());
  const storageScope = underlying ?? "default";

  useEffect(() => {
    setPreferencesReady(false);
    const next = readStoredPreferences(storageScope);
    setPrefs(next);
    setBucketSize(next.bucketSize);
    setPreferencesReady(true);
  }, [storageScope, refreshToken]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }

    let cancelled = false;

    async function loadScopedHistory() {
      try {
        const response = await fetchPCRScopedHistory({
          strikeMode: prefs.strikeMode,
          timeMode: prefs.timeMode,
          widthPoints: prefs.strikeMode === "atm" ? prefs.atmWidth : prefs.strikeMode === "custom_atm" ? prefs.customAtmWidth : undefined,
          customAtm: prefs.strikeMode === "custom_atm" ? Number(prefs.customAtm) : undefined,
          strikeMin: prefs.strikeMode === "custom" ? Number(prefs.strikeMin) : undefined,
          strikeMax: prefs.strikeMode === "custom" ? Number(prefs.strikeMax) : undefined,
          customDate: prefs.timeMode === "custom_date" ? prefs.customDate : undefined,
          fromTimestamp: prefs.timeMode === "custom_range" ? prefs.fromTimestamp : undefined,
          toTimestamp: prefs.timeMode === "custom_range" ? prefs.toTimestamp : undefined,
          limit: 128
        });
        if (!cancelled) {
          setScopedData(response);
        }
      } catch {
        if (!cancelled) {
          setScopedData(null);
        }
      }
    }

    if (!isValidPreferences(prefs)) {
      setScopedData(null);
      return;
    }

    loadScopedHistory();
    return () => {
      cancelled = true;
    };
  }, [preferencesReady, prefs, refreshToken]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }

    let cancelled = false;

    async function loadSubgroups() {
      setSubgroupBusy(true);
      try {
        const response = await fetchPCRScopedSubgroups({
          strikeMode: prefs.strikeMode,
          timeMode: prefs.timeMode,
          bucketSize,
          widthPoints: prefs.strikeMode === "atm" ? prefs.atmWidth : prefs.strikeMode === "custom_atm" ? prefs.customAtmWidth : undefined,
          customAtm: prefs.strikeMode === "custom_atm" ? Number(prefs.customAtm) : undefined,
          strikeMin: prefs.strikeMode === "custom" ? Number(prefs.strikeMin) : undefined,
          strikeMax: prefs.strikeMode === "custom" ? Number(prefs.strikeMax) : undefined,
          customDate: prefs.timeMode === "custom_date" ? prefs.customDate : undefined,
          fromTimestamp: prefs.timeMode === "custom_range" ? prefs.fromTimestamp : undefined,
          toTimestamp: prefs.timeMode === "custom_range" ? prefs.toTimestamp : undefined
        });
        if (!cancelled) {
          setSubgroupData(response);
          setSubgroupError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setSubgroupData(null);
          setSubgroupError(loadError instanceof Error ? loadError.message : "Failed to load subgroup breakdown");
        }
      } finally {
        if (!cancelled) {
          setSubgroupBusy(false);
        }
      }
    }

    if (!isValidPreferences(prefs)) {
      setSubgroupData(null);
      return;
    }

    loadSubgroups();
    return () => {
      cancelled = true;
    };
  }, [bucketSize, preferencesReady, prefs, refreshToken]);

  const rangeAnchorPcrData = useMemo(() => {
    const chartData = scopedData?.points ?? [];
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
  }, [scopedData]);

  const subgroupHeat = useMemo(() => {
    const rows = subgroupData?.rows ?? [];
    const maxAbsDeltaCall = Math.max(1, ...rows.map((row) => Math.abs(row.delta_call_oi)));
    const maxAbsDeltaPut = Math.max(1, ...rows.map((row) => Math.abs(row.delta_put_oi)));
    const maxDeltaPcr = Math.max(1, ...rows.map((row) => clipDeltaPcr(row.delta_pcr)));
    return { maxAbsDeltaCall, maxAbsDeltaPut, maxDeltaPcr };
  }, [subgroupData]);

  if (!rangeAnchorPcrData.length && !subgroupData?.rows?.length) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3">
          <p className="text-sm font-semibold text-white">Range Baseline Breakdown</p>
          <p className="text-xs text-slate-400">Real scoped values used for the cumulative delta PCR calculation.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <th className="px-3 py-3 font-medium">Time</th>
                <th className="px-3 py-3 font-medium">Call OI In Range</th>
                <th className="px-3 py-3 font-medium">Put OI In Range</th>
                <th className="px-3 py-3 font-medium">Delta Call Vs Start</th>
                <th className="px-3 py-3 font-medium">Delta Put Vs Start</th>
                <th className="px-3 py-3 font-medium">Adjusted Call</th>
                <th className="px-3 py-3 font-medium">Adjusted Put</th>
                <th className="px-3 py-3 font-medium">Delta PCR</th>
              </tr>
            </thead>
            <tbody>
              {rangeAnchorPcrData.map((row) => (
                <tr key={`range-breakdown-${row.timestamp}`} className="border-b border-white/5">
                  <td className="px-3 py-3 text-slate-100">{formatChartTime(row.timestamp)}</td>
                  <td className="px-3 py-3 text-slate-200">{formatCompact(row.total_call_oi)}</td>
                  <td className="px-3 py-3 text-slate-200">{formatCompact(row.total_put_oi)}</td>
                  <td className={`px-3 py-3 ${row.range_call_change >= 0 ? "text-slate-200" : "text-rose-300"}`}>{formatSignedCompact(row.range_call_change)}</td>
                  <td className={`px-3 py-3 ${row.range_put_change >= 0 ? "text-slate-200" : "text-rose-300"}`}>{formatSignedCompact(row.range_put_change)}</td>
                  <td className="px-3 py-3 text-slate-200">{formatCompact(row.adjusted_call_oi)}</td>
                  <td className="px-3 py-3 text-slate-200">{formatCompact(row.adjusted_put_oi)}</td>
                  <td className="px-3 py-3 font-medium text-white">{formatFixed(row.range_delta_pcr, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Fixed Subgroup Breakdown</p>
            <p className="text-xs text-slate-400">Bucketed view of the same selected strike and time scope.</p>
            {subgroupData ? (
              <p className="mt-1 text-xs text-slate-500">
                Baseline {formatShortDateTime(subgroupData.baseline_timestamp)} • Latest {formatShortDateTime(subgroupData.latest_timestamp)}
              </p>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            Bucket size
            <input
              type="number"
              min={50}
              max={5000}
              step={50}
              value={bucketSize}
              onChange={(event) => setBucketSize(Math.max(50, Number(event.target.value) || 200))}
              className="w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
            />
          </label>
        </div>
        {subgroupError ? <p className="mb-3 text-sm text-danger">{subgroupError}</p> : null}
        {subgroupBusy ? <p className="mb-3 text-sm text-slate-400">Loading subgroup breakdown...</p> : null}
        {subgroupData && subgroupData.rows.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1400px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-slate-400">
                  <th className="px-3 py-3 font-medium">Subgroup</th>
                  <th className="px-3 py-3 font-medium">Baseline Call OI</th>
                  <th className="px-3 py-3 font-medium">Baseline Put OI</th>
                  <th className="px-3 py-3 font-medium">Current Call OI</th>
                  <th className="px-3 py-3 font-medium">Current Put OI</th>
                  <th className="px-3 py-3 font-medium">Delta Call</th>
                  <th className="px-3 py-3 font-medium">Delta Put</th>
                  <th className="px-3 py-3 font-medium">Adjusted Call</th>
                  <th className="px-3 py-3 font-medium">Adjusted Put</th>
                  <th className="px-3 py-3 font-medium">Baseline PCR</th>
                  <th className="px-3 py-3 font-medium">Current PCR</th>
                  <th className="px-3 py-3 font-medium">Delta PCR</th>
                </tr>
              </thead>
              <tbody>
                {subgroupData.rows.map((row) => (
                  <tr key={`subgroup-${row.range}`} className="border-b border-white/5">
                    <td className="px-3 py-3 font-medium text-white">{row.range}</td>
                    <td className="px-3 py-3 text-slate-200">{formatCompact(row.baseline_call_oi)}</td>
                    <td className="px-3 py-3 text-slate-200">{formatCompact(row.baseline_put_oi)}</td>
                    <td className="px-3 py-3 text-slate-200">{formatCompact(row.current_call_oi)}</td>
                    <td className="px-3 py-3 text-slate-200">{formatCompact(row.current_put_oi)}</td>
                    <td className={`px-3 py-3 ${row.delta_call_oi >= 0 ? "text-slate-100" : "text-rose-100"}`} style={{ backgroundColor: heatColor(row.delta_call_oi, subgroupHeat.maxAbsDeltaCall, "call") }}>
                      {formatSignedCompact(row.delta_call_oi)}
                    </td>
                    <td className={`px-3 py-3 ${row.delta_put_oi >= 0 ? "text-slate-100" : "text-rose-100"}`} style={{ backgroundColor: heatColor(row.delta_put_oi, subgroupHeat.maxAbsDeltaPut, "put") }}>
                      {formatSignedCompact(row.delta_put_oi)}
                    </td>
                    <td className="px-3 py-3 text-slate-100" style={{ backgroundColor: heatColor(row.adjusted_call_oi, subgroupHeat.maxAbsDeltaCall, "call") }}>{formatCompact(row.adjusted_call_oi)}</td>
                    <td className="px-3 py-3 text-slate-100" style={{ backgroundColor: heatColor(row.adjusted_put_oi, subgroupHeat.maxAbsDeltaPut, "put") }}>{formatCompact(row.adjusted_put_oi)}</td>
                    <td className="px-3 py-3 text-slate-200">{formatFixed(row.baseline_pcr, 4)}</td>
                    <td className="px-3 py-3 text-slate-200">{formatFixed(row.current_pcr, 4)}</td>
                    <td className="px-3 py-3 font-medium text-slate-950" style={{ backgroundColor: heatColor(clipDeltaPcr(row.delta_pcr), subgroupHeat.maxDeltaPcr, "ratio") }}>
                      {formatFixed(clipDeltaPcr(row.delta_pcr), 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
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
      smaPeriod: 5,
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

function isValidPreferences(prefs: StoredPreferences) {
  if (prefs.strikeMode === "custom" && (!prefs.strikeMin.trim() || !prefs.strikeMax.trim() || Number.isNaN(Number(prefs.strikeMin)) || Number.isNaN(Number(prefs.strikeMax)))) {
    return false;
  }
  if (prefs.strikeMode === "custom_atm" && (!prefs.customAtm.trim() || Number.isNaN(Number(prefs.customAtm)))) {
    return false;
  }
  if (prefs.timeMode === "custom_date" && !prefs.customDate) {
    return false;
  }
  if (prefs.timeMode === "custom_range" && (!prefs.fromTimestamp || !prefs.toTimestamp)) {
    return false;
  }
  return true;
}

function isStrikeMode(value: unknown): value is StrikeMode {
  return value === "full" || value === "atm" || value === "custom_atm" || value === "custom";
}

function isTimeMode(value: unknown): value is TimeMode {
  return value === "all" || value === "today" || value === "previous_day" || value === "last_2_days" || value === "custom_date" || value === "custom_range";
}

function asStoredNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatChartTime(value: unknown) {
  const date = new Date(typeof value === "string" || typeof value === "number" ? value : "");
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

function formatShortDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
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
  return Math.min(Math.max(numeric, 0), 10);
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
  return `${numeric >= 0 ? "+" : "-"}${formatCompact(Math.abs(numeric))}`;
}

function heatColor(value: number, maxValue: number, kind: "call" | "put" | "ratio") {
  const safeValue = asFiniteNumber(value) ?? 0;
  const safeMax = Math.max(1, asFiniteNumber(maxValue) ?? 1);
  const intensity = Math.max(0.08, Math.min(Math.abs(safeValue) / safeMax, 1));

  if (kind === "ratio") {
    return `rgba(255, 209, 102, ${0.12 + intensity * 0.38})`;
  }
  if (kind === "put") {
    return safeValue > 0 ? `rgba(0, 212, 170, ${0.12 + intensity * 0.36})` : "rgba(255,255,255,0.04)";
  }
  return safeValue > 0 ? `rgba(255, 93, 115, ${0.12 + intensity * 0.34})` : "rgba(255,255,255,0.04)";
}
