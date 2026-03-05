import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsOverview } from "@/hooks/useAnalytics";

interface WarningBreakdownChartProps {
  data: AnalyticsOverview["warningLevelBreakdown"];
}

const WARNING_COLORS: Record<string, string> = {
  ok: "hsl(var(--chart-2))",
  caution: "hsl(var(--chart-5, 40 90% 50%))",
  critical: "hsl(var(--destructive))",
};

export function WarningBreakdownChart({ data }: WarningBreakdownChartProps) {
  const chartData = data.map((w) => ({
    name: w.warningLevel.toUpperCase(),
    value: w.hitCount,
    color: WARNING_COLORS[w.warningLevel] ?? "hsl(var(--muted-foreground))",
  }));

  return (
    <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
      <CardHeader className="pb-2">
        <CardTitle className="eva-section-title">Context Warning Levels</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground font-mono text-sm">
            No warning data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
                nameKey="name"
              >
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
