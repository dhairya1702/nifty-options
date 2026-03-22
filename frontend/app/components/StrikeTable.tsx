"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import type { OIChangeRow } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type StrikeTableProps = {
  rows: OIChangeRow[];
  spotLtp: number | null;
  error?: string | null;
};

export function StrikeTable({ rows, spotLtp, error }: StrikeTableProps) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Strike-wise OI</CardTitle>
        <p className="text-sm text-slate-400">
          {focusStrike ? focusLabel : "Latest strike-wise open interest snapshot"}
        </p>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
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
                        <td className="px-4 py-3 text-slate-200">{formatLakhs(row.call_oi)}</td>
                        <td className="px-4 py-3 text-slate-200">{formatLakhs(row.put_oi)}</td>
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
      {formatLakhs(Math.abs(value))}
    </div>
  );
}

function formatLakhs(value: number) {
  return `${(value / 100000).toFixed(1)}L`;
}
