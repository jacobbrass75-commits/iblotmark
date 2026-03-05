import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsOverview } from "@/hooks/useAnalytics";

interface ToolCallChartProps {
  data: AnalyticsOverview["toolCallFrequency"];
}

export function ToolCallChart({ data }: ToolCallChartProps) {
  const chartData = data.map((t) => ({
    name: t.toolName.replace("get_", "").replace(/_/g, " "),
    success: t.callCount - t.failureCount,
    failures: t.failureCount,
    avgSize: Math.round(t.avgResultSize),
  }));

  return (
    <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
      <CardHeader className="pb-2">
        <CardTitle className="eva-section-title">Tool Call Frequency</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground font-mono text-sm">
            No tool call data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="success" stackId="a" fill="hsl(var(--chart-2))" name="Success" />
              <Bar dataKey="failures" stackId="a" fill="hsl(var(--destructive))" name="Failures" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
