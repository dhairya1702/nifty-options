"use client";

import { Loader2, Play, Square } from "lucide-react";

import type { SchedulerStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type SchedulerControlProps = {
  status: SchedulerStatus | null;
  selectedInterval: number;
  selectedUnderlying: string;
  setSelectedInterval: (value: number) => void;
  setSelectedUnderlying: (value: string) => void;
  onStart: () => void;
  onStop: () => void;
  onUpdate: () => void;
  busy: boolean;
  error?: string | null;
};

export function SchedulerControl({
  status,
  selectedInterval,
  selectedUnderlying,
  setSelectedInterval,
  setSelectedUnderlying,
  onStart,
  onStop,
  onUpdate,
  busy,
  error
}: SchedulerControlProps) {
  const running = status?.running ?? false;
  const lastRunLabel = formatRelative(status?.last_run, "ago");
  const lastAttemptLabel = formatRelative(status?.last_attempt, "ago");
  const nextRunLabel = formatRelative(status?.next_run, "");
  const dataStatus = status?.data_status;
  const latestSnapshotLabel = formatTimestamp(dataStatus?.latest_snapshot_timestamp);
  const latestPcrLabel = formatTimestamp(dataStatus?.latest_pcr_timestamp);

  return (
    <Card className="border-white/10">
      <CardContent className="p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${running ? "bg-accent animate-pulse" : "bg-danger"}`} />
            <Badge variant={running ? "success" : "danger"}>{running ? "Running" : "Stopped"}</Badge>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onStart} disabled={busy || running}>
              {busy && !running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Start
            </Button>
            <Button variant="destructive" onClick={onStop} disabled={busy || !running}>
              {busy && running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
              Stop
            </Button>

            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <select
                className="rounded-lg border border-white/10 bg-[#121621] px-3 py-2 text-sm text-white outline-none"
                value={selectedUnderlying}
                onChange={(event) => setSelectedUnderlying(event.target.value)}
              >
                {(status?.supported_underlyings ?? ["NIFTY", "BANKNIFTY", "FINNIFTY"]).map((underlying) => (
                  <option key={underlying} value={underlying}>
                    {underlying}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg border border-white/10 bg-[#121621] px-3 py-2 text-sm text-white outline-none"
                value={selectedInterval}
                onChange={(event) => setSelectedInterval(Number(event.target.value))}
              >
                {[5, 10, 15, 30].map((interval) => (
                  <option key={interval} value={interval}>
                    {interval} min
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={onUpdate} disabled={busy}>
                Update
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 text-sm text-slate-400 md:flex-row md:justify-between">
          <p>Underlying: {status?.underlying ?? selectedUnderlying}</p>
          <p>Last attempt: {lastAttemptLabel}</p>
          <p>Last run: {lastRunLabel}</p>
          <p>Next run: {nextRunLabel}</p>
        </div>

        <div className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Latest Snapshot</p>
            <p className="mt-2 text-slate-100">{latestSnapshotLabel}</p>
            <p className="mt-1 text-slate-400">
              Contracts: {dataStatus?.snapshot_contracts ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Latest PCR Row</p>
            <p className="mt-2 text-slate-100">{latestPcrLabel}</p>
            <p className="mt-1 text-slate-400">
              PCR: {dataStatus?.latest_pcr != null ? dataStatus.latest_pcr.toFixed(2) : "--"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Latest Totals</p>
            <p className="mt-2 text-slate-100">
              Calls {formatThousands(dataStatus?.total_call_oi)}
            </p>
            <p className="mt-1 text-slate-400">
              Puts {formatThousands(dataStatus?.total_put_oi)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Expiry</p>
            <p className="mt-2 text-slate-100">{dataStatus?.expiry ?? "--"}</p>
            <p className="mt-1 text-slate-400">{formatOutcome(status?.last_outcome, running)}</p>
          </div>
        </div>

        {status?.last_error ? (
          <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            Scheduler error: {status.last_error}
          </p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function formatRelative(value: string | null | undefined, suffix: string) {
  if (!value) {
    return suffix === "ago" ? "Not yet" : "Not scheduled";
  }

  const diffMinutes = Math.max(0, Math.round((new Date(value).getTime() - Date.now()) / 60000));
  if (suffix === "ago") {
    const elapsed = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
    return `${elapsed} min${elapsed === 1 ? "" : "s"} ago`;
  }
  return `in ${diffMinutes} min${diffMinutes === 1 ? "" : "s"}`;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "No data yet";
  }
  return new Date(value).toLocaleString();
}

function formatThousands(value: number | null | undefined) {
  if (value == null) {
    return "--";
  }
  return `${(value / 1000).toFixed(1)}K`;
}

function formatOutcome(value: string | null | undefined, running: boolean) {
  if (value === "success") {
    return "Last job inserted data";
  }
  if (value === "skipped_market_closed") {
    return "Last job skipped: market closed";
  }
  if (value === "skipped_no_data") {
    return "Last job skipped: no option data";
  }
  if (value === "failed") {
    return "Last job failed";
  }
  if (value === "starting") {
    return "Starting collection";
  }
  if (value === "stopped") {
    return "Scheduler idle";
  }
  return running ? "Live collection armed" : "Scheduler idle";
}
