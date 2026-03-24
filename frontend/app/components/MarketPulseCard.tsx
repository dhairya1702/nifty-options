"use client";

import type { AnalyticsOverview } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type MarketPulseCardProps = {
  overview?: AnalyticsOverview | null;
  error?: string | null;
};

export function MarketPulseCard({ overview, error }: MarketPulseCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Pulse</CardTitle>
        <CardDescription>Today vs yesterday with stretch and positioning context</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Today PCR</span>
              <span className="font-semibold text-white">{overview?.today_pcr?.toFixed(2) ?? "--"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Yesterday PCR</span>
              <span className="font-semibold text-white">{overview?.yesterday_pcr?.toFixed(2) ?? "--"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Call OI change</span>
              <span className="font-semibold text-danger">{formatThousands(overview?.call_oi_change)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Put OI change</span>
              <span className="font-semibold text-accent">{formatThousands(overview?.put_oi_change)}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Stretch</p>
              <p className="mt-2 text-base font-semibold text-warning">{overview?.stretch_signal ?? "--"}</p>
              <p className="mt-2 text-sm text-slate-300">{overview?.directional_bias ?? "--"}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatThousands(value?: number | null) {
  if (value == null) return "--";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(value) / 1000).toFixed(1)}K`;
}
