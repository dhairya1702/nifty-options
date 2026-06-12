"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type TradeCallCardProps = {
  label: string;
  reasoning: string;
  compositeScore: number;
  concentrationSummary: string;
};

export function TradeCallCard({ label, reasoning, compositeScore, concentrationSummary }: TradeCallCardProps) {
  const tone =
    label === "Call Buy"
      ? "text-emerald-300"
      : label === "Put Buy"
        ? "text-rose-300"
        : label === "Put Sell"
          ? "text-cyan-300"
          : label === "Call Sell"
            ? "text-amber-300"
            : "text-slate-200";

  return (
    <Card className="border-white/10 bg-slate-950/80">
      <CardHeader className="border-b border-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Final Decision Output</p>
            <CardTitle className={`mt-2 text-3xl ${tone}`}>{label}</CardTitle>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Sentiment</p>
            <p className="text-2xl font-semibold text-white">{compositeScore.toFixed(1)}/10</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-5">
        <p className="text-sm text-slate-300">{reasoning}</p>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          {concentrationSummary}
        </div>
      </CardContent>
    </Card>
  );
}
