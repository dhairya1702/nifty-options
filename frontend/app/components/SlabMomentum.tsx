"use client";

import type { SlabAnalytics, SlabPoint } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SlabMomentumProps = {
  slabs?: SlabAnalytics | null;
  error?: string | null;
};

export function SlabMomentum({ slabs, error }: SlabMomentumProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SlabCard title="Call Build-up" color="text-danger" items={slabs?.call_buildup ?? []} error={error} />
      <SlabCard title="Put Build-up" color="text-accent" items={slabs?.put_buildup ?? []} error={error} />
    </div>
  );
}

function SlabCard({
  title,
  color,
  items,
  error
}: {
  title: string;
  color: string;
  items: SlabPoint[];
  error?: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          items.map((item) => (
            <div key={`${item.side}-${item.strike_price}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{item.strike_price}</span>
                <span className={`font-semibold ${color}`}>{formatLakhs(item.delta_oi)}</span>
              </div>
              <p className="mt-1 text-sm text-slate-400">OI {formatLakhs(item.oi)} • strongest recent buildup</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function formatLakhs(value: number) {
  return `${(value / 100000).toFixed(1)}L`;
}
