"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import type { OIChangeRow, OIGroupedRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type StrikeTableProps = {
  rows: OIChangeRow[];
  groupedRows: OIGroupedRow[];
  spotLtp: number | null;
  view: "grouped" | "raw";
  onViewChange: (value: "grouped" | "raw") => void;
  bucketSize: number;
  onBucketSizeChange: (value: number) => void;
  error?: string | null;
};

export function StrikeTable({
  rows,
  groupedRows,
  spotLtp,
  view,
  onViewChange,
  bucketSize,
  onBucketSizeChange,
  error
}: StrikeTableProps) {
  const sortedRows = [...rows].sort((a, b) => a.strike_price - b.strike_price);
  const focusStrike = sortedRows.length
    ? spotLtp
      ? sortedRows.reduce((closest, row) =>
          Math.abs(row.strike_price - spotLtp) < Math.abs(closest - spotLtp) ? row.strike_price : closest,
        sortedRows[0].strike_price)
      : sortedRows.reduce((best, row) =>
          row.call_oi + row.put_oi > best.call_oi + best.put_oi ? row : best,
        sortedRows[0]).strike_price
    : null;
  const focusIndex = focusStrike ? sortedRows.findIndex((row) => row.strike_price === focusStrike) : -1;
  const windowStart = focusIndex >= 0 ? Math.max(0, focusIndex - 10) : 0;
  const windowEnd = focusIndex >= 0 ? Math.min(sortedRows.length, focusIndex + 11) : sortedRows.length;
  const visibleRows = sortedRows.slice(windowStart, windowEnd);
  const focusLabel = spotLtp ? `ATM focus around ${focusStrike}` : `High-OI focus around ${focusStrike}`;
  const showingGrouped = view === "grouped";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>{showingGrouped ? "Grouped OI" : "Strike-wise OI"}</CardTitle>
            <p className="text-sm text-slate-400">
              {showingGrouped
                ? `Grouped around ATM with ${bucketSize}-point buckets`
                : focusStrike
                  ? focusLabel
                  : "Latest strike-wise open interest snapshot"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              <Button
                type="button"
                variant={showingGrouped ? "default" : "outline"}
                size="sm"
                onClick={() => onViewChange("grouped")}
              >
                Grouped View
              </Button>
              <Button
                type="button"
                variant={!showingGrouped ? "default" : "outline"}
                size="sm"
                onClick={() => onViewChange("raw")}
              >
                Raw View
              </Button>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
              Bucket
              <input
                type="number"
                min={50}
                step={50}
                value={bucketSize}
                onChange={(event) => onBucketSizeChange(Math.max(50, Number(event.target.value) || 150))}
                className="w-24 rounded-lg border border-white/10 bg-[#121621] px-3 py-2 text-sm text-white outline-none"
              />
            </label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : showingGrouped ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-slate-400">
                  <th className="px-4 py-3">Range</th>
                  <th className="px-4 py-3">Call OI</th>
                  <th className="px-4 py-3">Put OI</th>
                  <th className="px-4 py-3">PCR</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((row, index) => (
                  <tr key={row.range} className={index % 2 === 0 ? "bg-white/[0.02]" : ""}>
                    <td className="px-4 py-3 font-semibold text-white">{row.range}</td>
                    <td className="px-4 py-3 text-slate-200">{formatThousands(row.call_oi)}</td>
                    <td className="px-4 py-3 text-slate-200">{formatThousands(row.put_oi)}</td>
                    <td className="px-4 py-3 font-semibold text-white">{row.pcr.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-slate-400">
                  <th className="px-4 py-3">Strike</th>
                  <th className="px-4 py-3">Call OI</th>
                  <th className="px-4 py-3">Put OI</th>
                  <th className="px-4 py-3">ΔCall OI</th>
                  <th className="px-4 py-3">ΔPut OI</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => {
                    const isATM = focusStrike === row.strike_price;
                    return (
                      <tr
                        key={row.strike_price}
                        className={`${index % 2 === 0 ? "bg-white/[0.02]" : ""} ${isATM ? "bg-accent/10" : ""}`}
                      >
                        <td className="px-4 py-3 font-semibold text-white">{row.strike_price}</td>
                        <td className="px-4 py-3 text-slate-200">{formatThousands(row.call_oi)}</td>
                        <td className="px-4 py-3 text-slate-200">{formatThousands(row.put_oi)}</td>
                        <td className="px-4 py-3">{renderDelta(row.delta_call_oi)}</td>
                        <td className="px-4 py-3">{renderDelta(row.delta_put_oi)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function renderDelta(value: number) {
  const positive = value >= 0;
  return (
    <div className={`inline-flex items-center gap-1 ${positive ? "text-accent" : "text-danger"}`}>
      {positive ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      {formatThousands(Math.abs(value))}
    </div>
  );
}

function formatThousands(value: number) {
  return `${(value / 1000).toFixed(1)}K`;
}
