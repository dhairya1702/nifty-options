"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { AnalyticsFlowPoint } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FlowChartProps = {
  data: AnalyticsFlowPoint[];
  error?: string | null;
};

export function FlowChart({ data, error }: FlowChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Total OI Flow</CardTitle>
      </CardHeader>
      <CardContent className="h-[320px]">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                stroke="#7c879f"
              />
              <YAxis tickFormatter={(value) => `${(value / 100000).toFixed(0)}L`} stroke="#7c879f" />
              <Tooltip
                contentStyle={{ background: "#151927", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                formatter={(value: number) => `${(value / 100000).toFixed(1)}L`}
                labelFormatter={(value) => new Date(value).toLocaleString()}
              />
              <Area type="monotone" dataKey="total_call_oi" stroke="#ff4757" fill="#ff4757" fillOpacity={0.18} />
              <Area type="monotone" dataKey="total_put_oi" stroke="#00d4aa" fill="#00d4aa" fillOpacity={0.16} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
