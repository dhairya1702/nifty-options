"use client";

import { Card, CardContent } from "@/components/ui/card";

type HeaderProps = {
  lastUpdatedLabel: string;
  authMessage?: string | null;
  underlying?: string | null;
};

export function Header({ lastUpdatedLabel, authMessage, underlying }: HeaderProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-[family-name:var(--font-heading)] text-3xl font-bold text-white">
            {underlying ? `${underlying} Options Dashboard` : "Options Dashboard"}
          </p>
          <p className="mt-1 text-sm text-slate-400">Live OI &amp; PCR Tracker</p>
          {authMessage ? <p className="mt-3 text-sm text-accent">{authMessage}</p> : null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Last Updated</p>
          <p className="mt-2 font-[family-name:var(--font-mono)] text-sm text-slate-100">{lastUpdatedLabel}</p>
        </div>
      </CardContent>
    </Card>
  );
}
