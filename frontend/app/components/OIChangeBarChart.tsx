"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchOIIntradayChange, type OIIntradayChangeResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type OIChangeBarChartProps = {
  underlying: string;
  refreshToken?: string | number;
  error?: string | null;
};

type StrikeMode = "atm" | "custom_atm" | "custom";
type TimeMode = "today" | "previous_day" | "last_30_minutes" | "last_1_hour" | "last_2_hours" | "custom_date" | "custom_range";

export function OIChangeBarChart({ underlying, refreshToken, error }: OIChangeBarChartProps) {
  const [strikeMode, setStrikeMode] = useState<StrikeMode>("atm");
  const [timeMode, setTimeMode] = useState<TimeMode>("today");
  const [atmWidth, setAtmWidth] = useState(500);
  const [customAtm, setCustomAtm] = useState("");
  const [customAtmWidth, setCustomAtmWidth] = useState(500);
  const [strikeMin, setStrikeMin] = useState("");
  const [strikeMax, setStrikeMax] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [fromTimestamp, setFromTimestamp] = useState("");
  const [toTimestamp, setToTimestamp] = useState("");
  const [response, setResponse] = useState<OIIntradayChangeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const next = await fetchOIIntradayChange({
          strikeMode,
          timeMode,
          widthPoints: strikeMode === "atm" ? atmWidth : strikeMode === "custom_atm" ? customAtmWidth : undefined,
          customAtm: strikeMode === "custom_atm" ? Number(customAtm) : undefined,
          strikeMin: strikeMode === "custom" ? Number(strikeMin) : undefined,
          strikeMax: strikeMode === "custom" ? Number(strikeMax) : undefined,
          customDate: timeMode === "custom_date" ? customDate : undefined,
          fromTimestamp: timeMode === "custom_range" ? fromTimestamp : undefined,
          toTimestamp: timeMode === "custom_range" ? toTimestamp : undefined
        });

        if (!cancelled) {
          setResponse(next);
          setLoadError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setResponse(null);
          setLoadError(requestError instanceof Error ? requestError.message : "Failed to load intraday OI change");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (strikeMode === "custom_atm" && (!customAtm.trim() || Number.isNaN(Number(customAtm)))) {
      setResponse(null);
      setLoadError("Enter a numeric custom ATM strike.");
      return;
    }

    if (strikeMode === "custom" && (!strikeMin.trim() || !strikeMax.trim() || Number.isNaN(Number(strikeMin)) || Number.isNaN(Number(strikeMax)))) {
      setResponse(null);
      setLoadError("Enter numeric strike bounds.");
      return;
    }

    if (timeMode === "custom_date" && !customDate) {
      setResponse(null);
      setLoadError("Pick a custom date.");
      return;
    }

    if (timeMode === "custom_range" && (!fromTimestamp || !toTimestamp)) {
      setResponse(null);
      setLoadError("Enter both start and end date-time values.");
      return;
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [atmWidth, customAtm, customAtmWidth, customDate, fromTimestamp, refreshToken, strikeMax, strikeMin, strikeMode, timeMode, toTimestamp, underlying]);

  const chartData = useMemo(
    () =>
      (response?.rows ?? []).map((row) => ({
        strike: String(Math.round(row.strike_price)),
        strike_price: row.strike_price,
        delta_call_oi: row.delta_call_oi,
        delta_put_oi: row.delta_put_oi
      })),
    [response]
  );

  const domainMax = useMemo(() => {
    const magnitudes = chartData.flatMap((row) => [Math.abs(row.delta_call_oi), Math.abs(row.delta_put_oi)]);
    return Math.max(1, roundToTwo(Math.max(...magnitudes, 1) * 1.15));
  }, [chartData]);

  const summary = useMemo(() => {
    if (!chartData.length) {
      return null;
    }

    const totalCall = chartData.reduce((sum, row) => sum + row.delta_call_oi, 0);
    const totalPut = chartData.reduce((sum, row) => sum + row.delta_put_oi, 0);
    return { totalCall, totalPut };
  }, [chartData]);

  const activeError = error ?? loadError;
  const oiChartData = useMemo(
    () =>
      (response?.rows ?? []).map((row) => ({
        strike: String(Math.round(row.strike_price)),
        strike_price: row.strike_price,
        current_call_oi: row.current_call_oi,
        current_put_oi: row.current_put_oi
      })),
    [response]
  );
  const oiDomainMax = useMemo(() => {
    const magnitudes = oiChartData.flatMap((row) => [Math.abs(row.current_call_oi), Math.abs(row.current_put_oi)]);
    return Math.max(1, roundToTwo(Math.max(...magnitudes, 1) * 1.15));
  }, [oiChartData]);
  const oiSummary = useMemo(() => {
    if (!oiChartData.length) {
      return null;
    }

    const totalCall = oiChartData.reduce((sum, row) => sum + row.current_call_oi, 0);
    const totalPut = oiChartData.reduce((sum, row) => sum + row.current_put_oi, 0);
    return { totalCall, totalPut };
  }, [oiChartData]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>OI Change By Strike</CardTitle>
            <p className="mt-1 text-sm text-slate-400">
              Intraday call and put OI change for {underlying}, measured from the first snapshot in the selected day or time range.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300">
            {response ? `${formatShortDateTime(response.baseline_timestamp)} to ${formatShortDateTime(response.latest_timestamp)}` : "Waiting for snapshots"}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant={timeMode === "today" ? "default" : "outline"} onClick={() => setTimeMode("today")}>
            Today
          </Button>
          <Button type="button" variant={timeMode === "previous_day" ? "default" : "outline"} onClick={() => setTimeMode("previous_day")}>
            Prev Day
          </Button>
          <Button type="button" variant={timeMode === "last_30_minutes" ? "default" : "outline"} onClick={() => setTimeMode("last_30_minutes")}>
            Last 30 mins
          </Button>
          <Button type="button" variant={timeMode === "last_1_hour" ? "default" : "outline"} onClick={() => setTimeMode("last_1_hour")}>
            Last 1 hr
          </Button>
          <Button type="button" variant={timeMode === "last_2_hours" ? "default" : "outline"} onClick={() => setTimeMode("last_2_hours")}>
            Last 2 hrs
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
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span>Spot {response?.spot_ltp != null ? response.spot_ltp.toFixed(2) : "--"}</span>
          <span>Reference strike {response?.reference_strike != null ? Math.round(response.reference_strike) : "--"}</span>
          <span>
            Visible range {response?.strike_min != null && response?.strike_max != null ? `${Math.round(response.strike_min)}-${Math.round(response.strike_max)}` : "--"}
          </span>
          <span>Last OI snapshot: {response ? formatTimeOnly(response.latest_timestamp) : "--"}</span>
          {loading ? <span>Loading intraday OI change...</span> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeError ? (
          <p className="text-sm text-danger">{activeError}</p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-slate-400">No intraday OI data available for the selected range.</p>
        ) : (
          <>
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barCategoryGap="22%">
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="strike" stroke="#7c879f" angle={-35} textAnchor="end" height={64} interval={0} />
                  <YAxis domain={[-domainMax, domainMax]} tickFormatter={(value) => formatCompact(value)} stroke="#7c879f" />
                  <Tooltip
                    contentStyle={{ background: "#151927", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                    labelFormatter={(value) => `Strike ${value}`}
                    formatter={(value: number, name: string) => [formatCompact(value), name === "delta_put_oi" ? "Put OI Change" : "Call OI Change"]}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                  {response?.reference_strike != null ? (
                    <ReferenceLine x={String(Math.round(response.reference_strike))} stroke="#ffd166" strokeDasharray="4 4" />
                  ) : null}
                  <Bar dataKey="delta_put_oi" fill="#7ae582" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="delta_call_oi" fill="#f28482" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="pt-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-white">OI By Strike</p>
                <p className="text-xs text-slate-400">
                  Current open interest at the latest snapshot inside the same selected time window.
                </p>
              </div>
              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oiChartData} barCategoryGap="22%">
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="strike" stroke="#7c879f" angle={-35} textAnchor="end" height={64} interval={0} />
                    <YAxis domain={[0, oiDomainMax]} tickFormatter={(value) => formatCompact(value)} stroke="#7c879f" />
                    <Tooltip
                      contentStyle={{ background: "#151927", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                      labelFormatter={(value) => `Strike ${value}`}
                      formatter={(value: number, name: string) => [formatCompact(value), name === "current_put_oi" ? "Put OI" : "Call OI"]}
                    />
                    {response?.reference_strike != null ? (
                      <ReferenceLine x={String(Math.round(response.reference_strike))} stroke="#ffd166" strokeDasharray="4 4" />
                    ) : null}
                    <Bar dataKey="current_put_oi" fill="#00d4aa" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="current_call_oi" fill="#ff7b7b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {summary ? (
              <div className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Call OI Change</p>
                  <p className="mt-1 text-lg font-semibold text-rose-200">{formatSignedCompact(summary.totalCall)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Put OI Change</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-200">{formatSignedCompact(summary.totalPut)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Net Put Minus Call</p>
                  <p className="mt-1 text-lg font-semibold text-white">{formatSignedCompact(summary.totalPut - summary.totalCall)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Visible Strikes</p>
                  <p className="mt-1 text-lg font-semibold text-white">{chartData.length}</p>
                </div>
              </div>
            ) : null}
            {oiSummary ? (
              <div className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Call OI</p>
                  <p className="mt-1 text-lg font-semibold text-rose-200">{formatCompact(oiSummary.totalCall)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Put OI</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-200">{formatCompact(oiSummary.totalPut)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">PCR</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {oiSummary.totalCall > 0 ? (oiSummary.totalPut / oiSummary.totalCall).toFixed(4) : "--"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Latest Snapshot</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {response ? formatShortDateTime(response.latest_timestamp) : "--"}
                  </p>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    notation: "compact"
  }).format(value);
}

function formatSignedCompact(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatCompact(Math.abs(value))}`;
}

function formatShortDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

function formatTimeOnly(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}
