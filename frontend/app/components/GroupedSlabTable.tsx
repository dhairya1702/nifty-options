"use client";

import { useMemo } from "react";

import type { OptionChainContract } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GroupedSlabTableProps = {
  contract: OptionChainContract;
  bucketSize?: number;
};

type GroupedRow = {
  rangeLabel: string;
  callOi: number;
  putOi: number;
  callChange: number;
  putChange: number;
  pcr: number;
  cpaDifference: number;
};

export function GroupedSlabTable({ contract, bucketSize = 150 }: GroupedSlabTableProps) {
  const groupedRows = useMemo(() => {
    const grouped = new Map<number, GroupedRow>();

    for (const row of contract.rows) {
      const bucketStart = Math.floor(row.strike_price / bucketSize) * bucketSize;
      const bucket = grouped.get(bucketStart) ?? {
        rangeLabel: `${bucketStart}-${bucketStart + bucketSize}`,
        callOi: 0,
        putOi: 0,
        callChange: 0,
        putChange: 0,
        pcr: 0,
        cpaDifference: 0
      };
      bucket.callOi += row.call_oi;
      bucket.putOi += row.put_oi;
      bucket.callChange += row.call_change_in_oi;
      bucket.putChange += row.put_change_in_oi;
      bucket.cpaDifference += row.cpa_difference;
      grouped.set(bucketStart, bucket);
    }

    return [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => ({
        ...row,
        pcr: row.putOi / (row.callOi || 1)
      }));
  }, [bucketSize, contract.rows]);

  return (
    <Card className="border-white/10 bg-slate-950/70">
      <CardHeader>
        <CardTitle>{contract.label} • {bucketSize}-Point Slabs</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-slate-400">
              <th className="px-4 py-3">Slab</th>
              <th className="px-4 py-3">Call OI</th>
              <th className="px-4 py-3">Put OI</th>
              <th className="px-4 py-3">Δ Call OI</th>
              <th className="px-4 py-3">Δ Put OI</th>
              <th className="px-4 py-3">PCR</th>
              <th className="px-4 py-3">CPA Diff</th>
            </tr>
          </thead>
          <tbody>
            {groupedRows.map((row) => (
              <tr key={row.rangeLabel} className="border-b border-white/5">
                <td className="px-4 py-3 font-semibold text-white">{row.rangeLabel}</td>
                <td className="px-4 py-3 text-slate-200">{formatCompact(row.callOi)}</td>
                <td className="px-4 py-3 text-slate-200">{formatCompact(row.putOi)}</td>
                <td className={`px-4 py-3 ${row.callChange >= 0 ? "text-rose-300" : "text-emerald-300"}`}>
                  {formatSigned(row.callChange)}
                </td>
                <td className={`px-4 py-3 ${row.putChange >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {formatSigned(row.putChange)}
                </td>
                <td className="px-4 py-3 text-slate-200">{row.pcr.toFixed(2)}</td>
                <td className={`px-4 py-3 font-semibold ${row.cpaDifference >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {formatSigned(row.cpaDifference)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    notation: "compact"
  }).format(value);
}

function formatSigned(value: number) {
  const formatted = formatCompact(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}
