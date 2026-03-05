import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsOverview } from "@/hooks/useAnalytics";

interface TokenUsageChartProps {
  data: AnalyticsOverview["tokenUsageByTurn"];
}

export function TokenUsageChart({ data }: TokenUsageChartProps) {
  const chartData = data.map((t) => ({
    turn: `Turn ${t.turnNumber}`,
    avg: Math.round(t.avgTokens),
    min: t.minTokens,
    max: t.maxTokens,
    samples: t.sampleCount,
  }));

  return (
    <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
      <CardHeader className="pb-2">
        <CardTitle className="eva-section-title">Token Usage by Turn</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground font-mono text-sm">
            No token usage data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="turn" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
                formatter={(value: number) => value.toLocaleString()}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="avg" stroke="hsl(var(--chart-2))" strokeWidth={2} name="Avg Tokens" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="min" stroke="hsl(var(--chart-3))" strokeDasharray="5 5" name="Min" dot={false} />
              <Line type="monotone" dataKey="max" stroke="hsl(var(--destructive))" strokeDasharray="5 5" name="Max" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
