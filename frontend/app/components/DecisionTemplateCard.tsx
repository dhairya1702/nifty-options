"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type DecisionTemplateSection = {
  id: string;
  title: string;
  groups: {
    id: string;
    title: string;
    factors: string[];
  }[];
};

export type ScoreMap = Record<string, number>;

type DecisionTemplateCardProps = {
  sections: DecisionTemplateSection[];
  scores: ScoreMap;
  sectionScores: Record<string, number>;
  compositeScore: number;
  onScoreChange: (key: string, value: number) => void;
};

export function DecisionTemplateCard({
  sections,
  scores,
  sectionScores,
  compositeScore,
  onScoreChange
}: DecisionTemplateCardProps) {
  return (
    <Card className="border-white/10 bg-slate-950/70">
      <CardHeader className="border-b border-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Decision Template</CardTitle>
            <CardDescription>Editable 1-10 factor scores with live weighted section averages.</CardDescription>
          </div>
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/70">Composite Score</p>
            <p className="mt-1 text-3xl font-semibold text-white">{compositeScore.toFixed(1)}/10</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 p-5 xl:grid-cols-2">
        {sections.map((section) => (
          <div key={section.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">{section.title}</p>
                <p className="text-sm text-slate-400">Section weighted average</p>
              </div>
              <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-right">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Score</p>
                <p className="text-xl font-semibold text-white">{sectionScores[section.id].toFixed(1)}</p>
              </div>
            </div>
            <div className="space-y-4">
              {section.groups.map((group) => (
                <div key={group.id}>
                  <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">{group.title}</p>
                  <div className="grid gap-2">
                    {group.factors.map((factor) => {
                      const key = `${section.id}:${group.id}:${factor}`;
                      return (
                        <label
                          key={key}
                          className="grid grid-cols-[1fr_72px] items-center gap-3 rounded-xl border border-white/8 bg-slate-900/70 px-3 py-2 text-sm text-slate-200"
                        >
                          <span>{factor}</span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            value={scores[key] ?? 5}
                            onChange={(event) => onScoreChange(key, Number(event.target.value))}
                            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-right text-white outline-none"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
