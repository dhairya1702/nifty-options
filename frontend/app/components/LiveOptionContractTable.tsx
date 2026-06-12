"use client";

import type { OptionChainContract, OptionChainStrikeRow } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LiveOptionContractTableProps = {
  contract: OptionChainContract;
};

const COLUMNS: { key: keyof OptionChainStrikeRow; label: string; kind?: "ratio" | "money" }[] = [
  { key: "call_oi", label: "Call OI" },
  { key: "call_change_in_oi", label: "Call Chg OI" },
  { key: "call_volume", label: "Call Vol" },
  { key: "call_iv", label: "Call IV", kind: "ratio" },
  { key: "call_ltp", label: "Call LTP" },
  { key: "call_bid_qty", label: "Call Bid Qty" },
  { key: "call_bid_price", label: "Call Bid Px" },
  { key: "call_ask_price", label: "Call Ask Px" },
  { key: "call_ask_qty", label: "Call Ask Qty" },
  { key: "strike_price", label: "Strike" },
  { key: "put_bid_qty", label: "Put Bid Qty" },
  { key: "put_bid_price", label: "Put Bid Px" },
  { key: "put_ask_price", label: "Put Ask Px" },
  { key: "put_ask_qty", label: "Put Ask Qty" },
  { key: "put_ltp", label: "Put LTP" },
  { key: "put_iv", label: "Put IV", kind: "ratio" },
  { key: "put_volume", label: "Put Vol" },
  { key: "put_change_in_oi", label: "Put Chg OI" },
  { key: "put_oi", label: "Put OI" },
  { key: "call_amount", label: "Call Amount", kind: "money" },
  { key: "put_amount", label: "Put Amount", kind: "money" },
  { key: "pcr", label: "PCR", kind: "ratio" },
  { key: "cpr", label: "CPR", kind: "ratio" },
  { key: "pca_ratio", label: "PCA Ratio", kind: "ratio" },
  { key: "cpa_ratio", label: "CPA Ratio", kind: "ratio" },
  { key: "pca_total", label: "PCA Total", kind: "money" },
  { key: "cpa_difference", label: "CPA Diff", kind: "money" },
  { key: "pcr_total", label: "PCR Total", kind: "ratio" },
  { key: "cpa_total", label: "CPA Total", kind: "ratio" },
  { key: "st50", label: "ST50" }
];

export function LiveOptionContractTable({ contract }: LiveOptionContractTableProps) {
  const rows = [...contract.rows].sort((a, b) => a.strike_price - b.strike_price);

  return (
    <Card className="border-white/10 bg-slate-950/70">
      <CardHeader className="border-b border-white/10">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>{contract.label}</CardTitle>
            <p className="mt-1 text-sm text-slate-400">
              Expiry {formatDate(contract.expiry)} • Lot size {contract.lot_size} • Spot {contract.spot_ltp.toFixed(2)} • PCR{" "}
              {contract.pcr.toFixed(2)}
            </p>
          </div>
          <div className="text-sm text-slate-400">
            CPA range {formatCompact(contract.cpa_difference_min)} to {formatCompact(contract.cpa_difference_max)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-[2100px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-950">
            <tr className="border-b border-white/10 text-left text-slate-400">
              {COLUMNS.map((column) => (
                <th key={column.label} className="px-3 py-3 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${contract.id}-${row.strike_price}`} style={{ backgroundColor: rowColor(row.cpa_difference, contract) }}>
                {COLUMNS.map((column) => (
                  <td
                    key={`${contract.id}-${row.strike_price}-${column.label}`}
                    className={`border-b border-black/10 px-3 py-2 ${
                      column.key === "strike_price" ? "font-semibold text-slate-950" : "text-slate-900"
                    }`}
                  >
                    {formatValue(row[column.key], column.kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function rowColor(value: number, contract: OptionChainContract) {
  const min = contract.cpa_difference_min;
  const max = contract.cpa_difference_max;
  if (value > 0 && max > 0) {
    return mix([255, 255, 255], [34, 197, 94], Math.min(value / max, 1));
  }
  if (value < 0 && min < 0) {
    return mix([255, 255, 255], [239, 68, 68], Math.min(Math.abs(value / min), 1));
  }
  return "rgb(255,255,255)";
}

function mix(from: [number, number, number], to: [number, number, number], ratio: number) {
  const blend = from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio));
  return `rgb(${blend[0]}, ${blend[1]}, ${blend[2]})`;
}

function formatValue(value: number, kind?: "ratio" | "money") {
  if (kind === "ratio") {
    return value.toFixed(2);
  }
  if (kind === "money") {
    return formatCompact(value);
  }
  if (Math.abs(value) >= 1000) {
    return formatCompact(value);
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    notation: "compact"
  }).format(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  });
}
