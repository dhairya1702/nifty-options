"use client";

import { ResponsiveContainer, LineChart, Line, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import type { PCRHistoryPoint } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PCRChartProps = {
  data: PCRHistoryPoint[];
  error?: string | null;
};

export function PCRChart({ data, error }: PCRChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>PCR Over Time</CardTitle>
      </CardHeader>
      <CardContent className="h-[320px]">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                stroke="#7c879f"
              />
              <YAxis domain={["auto", "auto"]} stroke="#7c879f" />
              <Tooltip
                contentStyle={{ background: "#151927", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                labelFormatter={(value) => new Date(value).toLocaleString()}
              />
              <Line type="monotone" dataKey="pcr" stroke="#00d4aa" strokeWidth={3} dot={{ fill: "#00d4aa" }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
