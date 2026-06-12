"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OptionReferenceCard() {
  return (
    <Card className="border-white/10 bg-slate-950/70">
      <CardHeader>
        <CardTitle>Option Analysis Reference</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-200">Bullish signals</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            <li>Buy ITM Call + increasing OI &amp; Volume → fresh long buying</li>
            <li>Buy OTM Call + increasing OI &amp; Volume → aggressive bullish positioning</li>
            <li>Write/Sell OTM Put + increasing OI → put writers expect market to hold</li>
            <li>Square off ITM Put (decreasing OI on put side) → shorts covering</li>
          </ul>
        </section>
        <section className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-200">Bearish signals</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            <li>Buy ITM Put + increasing OI &amp; Volume → fresh short buying</li>
            <li>Buy OTM Put + increasing OI &amp; Volume → aggressive bearish positioning</li>
            <li>Write/Sell OTM Call + increasing OI → call writers expect market to fall</li>
            <li>Square off ITM Call (decreasing OI on call side) → longs covering</li>
          </ul>
        </section>
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-200">Synthetic strategy map</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            <li>Future Buy + Put Buy = Synthetic Call Buy (hedge downtrend)</li>
            <li>Future Buy + Call Sell = Synthetic Put Sell (hedge downtrend)</li>
            <li>Future Sell + Call Buy = Synthetic Put Buy (hedge uptrend)</li>
            <li>Future Sell + Put Sell = Synthetic Call Sell (hedge uptrend)</li>
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
