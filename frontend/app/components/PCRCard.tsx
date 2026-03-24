"use client";

import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PCRCardProps = {
  pcr?: number;
  windowPcr?: number;
  delta?: number;
  totalCallOI?: number;
  totalPutOI?: number;
  referenceStrike?: number | null;
  windowStrikeCount?: number;
  error?: string | null;
};

export function PCRCard({
  pcr,
  windowPcr,
  delta,
  totalCallOI,
  totalPutOI,
  referenceStrike,
  windowStrikeCount,
  error
}: PCRCardProps) {
  const rising = (delta ?? 0) >= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current PCR</CardTitle>
        <CardDescription>Put-Call Ratio</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-4xl font-bold text-white">{windowPcr?.toFixed(2) ?? pcr?.toFixed(2) ?? "--"}</span>
              <div className={`flex items-center gap-1 text-sm ${rising ? "text-accent" : "text-danger"}`}>
                {rising ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {(delta ?? 0).toFixed(2)}
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-400">
              Window around {referenceStrike ?? "--"} • {windowStrikeCount ?? "--"} strikes
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Full chain Calls {totalCallOI ? formatThousands(totalCallOI) : "--"} • Puts {totalPutOI ? formatThousands(totalPutOI) : "--"}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatThousands(value: number) {
  return `${(value / 1000).toFixed(1)}K`;
}
