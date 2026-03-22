"use client";

import type { ProbabilityAnalytics } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ProbabilityCardProps = {
  probability?: ProbabilityAnalytics | null;
  error?: string | null;
};

export function ProbabilityCard({ probability, error }: ProbabilityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Strike Probability</CardTitle>
        <CardDescription>Heuristic estimate from ATM straddle, not a guaranteed forecast</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <>
            <div className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected Move</p>
                <p className="mt-2 text-lg font-semibold text-white">{probability?.expected_move?.toFixed(2) ?? "--"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Days To Expiry</p>
                <p className="mt-2 text-lg font-semibold text-white">{probability?.days_to_expiry ?? "--"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reference</p>
                <p className="mt-2 text-lg font-semibold text-white">{probability?.reference_strike ?? "--"}</p>
              </div>
            </div>
            <div className="space-y-3">
              {probability?.estimates.map((estimate) => (
                <div key={estimate.strike_price} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{estimate.strike_price}</p>
                    <p className="text-sm text-slate-400">Dist {estimate.distance_from_spot.toFixed(0)}</p>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <ProbabilityBar label="Touch probability" value={estimate.probability_touch} color="bg-accent" />
                    <ProbabilityBar
                      label="Expire near strike"
                      value={estimate.probability_expire_near}
                      color="bg-warning"
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProbabilityBar({ label, value, color }: { label: string; value: number; color: string }) {
  const percent = Math.max(0, Math.min(100, value * 100));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-white">{percent.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/8">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
    </div>
  );
}
