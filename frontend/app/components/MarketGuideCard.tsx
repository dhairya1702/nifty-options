"use client";

import type { AuthStatus, MarketStatus, SchedulerStatus } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

type MarketGuideCardProps = {
  marketStatus?: MarketStatus | null;
  authStatus?: AuthStatus | null;
  schedulerStatus?: SchedulerStatus | null;
  hasData: boolean;
};

export function MarketGuideCard({ marketStatus, authStatus, schedulerStatus, hasData }: MarketGuideCardProps) {
  if (!marketStatus) return null;

  const recommendation = getRecommendation(marketStatus, authStatus, schedulerStatus, hasData);
  const tone =
    marketStatus.phase === "live"
      ? "text-accent"
      : marketStatus.phase === "preopen"
        ? "text-warning"
        : "text-slate-200";

  return (
    <Card className={marketStatus.phase === "live" ? "border-accent/20" : "border-warning/20"}>
      <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p className={`text-sm font-semibold uppercase tracking-[0.18em] ${tone}`}>{marketStatus.phase}</p>
          <p className="mt-2 text-sm text-slate-300">{recommendation.primary}</p>
          <p className="mt-1 text-sm text-slate-400">{recommendation.secondary}</p>
        </div>
        <div className="text-sm text-slate-400">
          {marketStatus.market_open
            ? `Closes ${formatTime(marketStatus.next_close)} IST`
            : `Opens ${formatTime(marketStatus.next_open)} IST`}
        </div>
      </CardContent>
    </Card>
  );
}

function getRecommendation(
  marketStatus: MarketStatus,
  authStatus: AuthStatus | null | undefined,
  schedulerStatus: SchedulerStatus | null | undefined,
  hasData: boolean
) {
  if (!authStatus?.authenticated || authStatus.login_required) {
    return {
      primary: "Log in to Zerodha first so the dashboard can fetch live option chain data.",
      secondary: "After login, start the scheduler during market hours to collect real snapshots and build your own history."
    };
  }

  if (marketStatus.phase === "preopen") {
    return {
      primary: "Market is in pre-open. Backfill real recent history if the charts are empty, then click Start just before 9:15 AM IST.",
      secondary: schedulerStatus?.running
        ? "Scheduler is already armed. The next live collection will follow your selected interval."
        : "Best practice: log in early, choose the underlying, and press Start when regular trading begins. The app fills missing recent history automatically."
    };
  }

  if (marketStatus.phase === "live") {
    if (schedulerStatus?.running) {
      return {
        primary: "Market is live and the scheduler is running. Let it collect intraday snapshots automatically.",
        secondary: "Watch PCR drift, total OI flow, slab build-up, and support/resistance migration as the day develops."
      };
    }
    return {
      primary: "Market is live. Click Start now to begin live intraday collection for the selected underlying.",
      secondary: hasData
        ? "You already have history on screen, so Start will append live points immediately."
        : "If the dashboard is empty, press Start. The app will fetch available recent active-contract history first, then continue live collection."
    };
  }

  return {
    primary: "Market is closed. Keep the dashboard ready for the next session or review the real history already stored.",
    secondary: schedulerStatus?.running
      ? "The scheduler can stay on, but the next truly useful live snapshot will be during trading hours."
      : "Recommended flow: log in, choose the underlying, then start the scheduler when the next market session begins. Missing recent history is filled automatically."
  };
}

function formatTime(value: string | null) {
  if (!value) return "--";
  return new Date(value).toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata"
  });
}
