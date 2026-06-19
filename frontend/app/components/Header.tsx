"use client";

import { ExternalLink } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type HeaderProps = {
  lastUpdatedLabel: string;
  authMessage?: string | null;
  authActionLabel?: string | null;
  authActionUrl?: string | null;
  underlying?: string | null;
  title?: string;
  subtitle?: string;
};

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/simulator", label: "Simulator" }
] satisfies { href: Route; label: string }[];

export function Header({
  lastUpdatedLabel,
  authMessage,
  authActionLabel,
  authActionUrl,
  underlying,
  title,
  subtitle
}: HeaderProps) {
  const pathname = usePathname();
  const resolvedTitle = title ?? (underlying ? `${underlying} Options Dashboard` : "Options Dashboard");
  const resolvedSubtitle = subtitle ?? "Live OI & PCR Tracker";

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? "border-transparent bg-accent text-slate-950"
                      : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <p className="mt-4 font-[family-name:var(--font-heading)] text-3xl font-bold text-white">{resolvedTitle}</p>
          <p className="mt-1 text-sm text-slate-400">{resolvedSubtitle}</p>
          {authMessage ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-accent">{authMessage}</p>
              {authActionLabel && authActionUrl ? (
                <Button asChild size="sm">
                  <a href={authActionUrl}>
                    {authActionLabel}
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Last Updated</p>
          <p className="mt-2 font-[family-name:var(--font-mono)] text-sm text-slate-100">{lastUpdatedLabel}</p>
        </div>
      </CardContent>
    </Card>
  );
}
