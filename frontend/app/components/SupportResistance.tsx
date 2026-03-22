"use client";

import type { LevelsResponse } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SupportResistanceProps = {
  levels?: LevelsResponse | null;
  error?: string | null;
};

export function SupportResistance({ levels, error }: SupportResistanceProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <LevelCard
        title="Resistance Zones"
        color="bg-danger"
        items={
          levels?.resistance.map((row) => ({ strike_price: row.strike_price, value: row.call_oi, score: row.score })) ?? []
        }
        error={error}
      />
      <LevelCard
        title="Support Zones"
        color="bg-accent"
        items={levels?.support.map((row) => ({ strike_price: row.strike_price, value: row.put_oi, score: row.score })) ?? []}
        error={error}
      />
    </div>
  );
}

function LevelCard({
  title,
  items,
  color,
  error
}: {
  title: string;
  items: { strike_price: number; value: number; score: number }[];
  color: string;
  error?: string | null;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          items.map((item) => (
            <div key={item.strike_price}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-white">{item.strike_price}</span>
                <span className="text-right text-slate-300">
                  {(item.value / 100000).toFixed(1)}L
                  <span className="ml-2 text-xs text-slate-500">score {item.score.toFixed(0)}</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/8">
                <div
                  className={`h-2 rounded-full ${color}`}
                  style={{ width: `${Math.max((item.value / max) * 100, 10)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
