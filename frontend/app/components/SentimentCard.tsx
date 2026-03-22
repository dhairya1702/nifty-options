"use client";

import type { SentimentResponse } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SentimentCardProps = {
  sentiment?: SentimentResponse | null;
  error?: string | null;
};

export function SentimentCard({ sentiment, error }: SentimentCardProps) {
  const tone =
    sentiment?.sentiment === "Bullish"
      ? "text-accent"
      : sentiment?.sentiment === "Bearish"
        ? "text-danger"
        : "text-warning";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sentiment</CardTitle>
        <CardDescription>Standard PCR interpretation</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <>
            <p className={`text-4xl font-bold uppercase ${tone}`}>{sentiment?.sentiment ?? "--"}</p>
            <p className="mt-3 text-sm text-slate-400">
              Trend: {sentiment?.pcr_trend ?? "--"} • Window PCR {sentiment?.window_pcr?.toFixed(2) ?? "--"}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Confidence: {sentiment?.confidence ?? "--"} • Ref strike {sentiment?.reference_strike ?? "--"}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
