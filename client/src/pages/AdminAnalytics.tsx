import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAnalyticsOverview, useAnalyticsConversations } from "@/hooks/useAnalytics";
import { OverviewCards } from "@/components/analytics/OverviewCards";
import { ToolCallChart } from "@/components/analytics/ToolCallChart";
import { TokenUsageChart } from "@/components/analytics/TokenUsageChart";
import { WarningBreakdownChart } from "@/components/analytics/WarningBreakdownChart";
import { ConversationTable } from "@/components/analytics/ConversationTable";
import { ConversationTimeline } from "@/components/analytics/ConversationTimeline";

type TimeRange = "24h" | "7d" | "30d" | "all";

function getFromTimestamp(range: TimeRange): number {
  const now = Date.now();
  switch (range) {
    case "24h": return now - 24 * 60 * 60 * 1000;
    case "7d": return now - 7 * 24 * 60 * 60 * 1000;
    case "30d": return now - 30 * 24 * 60 * 60 * 1000;
    case "all": return 0;
  }
}

export default function AdminAnalytics() {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);

  const now = Date.now();
  const from = getFromTimestamp(timeRange);

  const { data: overview, isLoading: overviewLoading } = useAnalyticsOverview(from, now);
  const { data: convData, isLoading: convsLoading } = useAnalyticsConversations(from, now);

  const conversations = convData?.conversations ?? [];
  const topSources = overview?.topRequestedSources ?? [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="font-sans uppercase tracking-[0.2em] font-bold text-primary text-sm">
              WRITING HARNESS
            </h1>
            <div className="eva-status-active" />
          </div>
          <div className="flex items-center gap-1">
            {(["24h", "7d", "30d", "all"] as TimeRange[]).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? "default" : "outline"}
                size="sm"
                className="text-xs font-mono uppercase tracking-wider h-7 px-3"
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6 eva-grid-bg">
        <OverviewCards
          overview={overview}
          conversations={conversations}
          isLoading={overviewLoading}
        />

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ToolCallChart data={overview?.toolCallFrequency ?? []} />
          <TokenUsageChart data={overview?.tokenUsageByTurn ?? []} />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <WarningBreakdownChart data={overview?.warningLevelBreakdown ?? []} />

          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="eva-section-title">Top Requested Sources</CardTitle>
            </CardHeader>
            <CardContent>
              {topSources.length === 0 ? (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground font-mono text-sm">
                  No source data yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left py-1.5 px-2">Document</th>
                        <th className="text-left py-1.5 px-2">Tool</th>
                        <th className="text-right py-1.5 px-2">Pulls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topSources.slice(0, 10).map((src, i) => (
                        <tr key={i} className="border-b border-border/30">
                          <td className="py-1.5 px-2 text-primary truncate max-w-[180px]">
                            {src.documentId.slice(0, 16)}...
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">
                            {src.toolName.replace("get_", "")}
                          </td>
                          <td className="py-1.5 px-2 text-right text-chart-3">
                            {src.pullCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <ConversationTable
          conversations={conversations}
          isLoading={convsLoading}
          onSelect={setSelectedConversation}
        />

        <ConversationTimeline
          conversationId={selectedConversation}
          onClose={() => setSelectedConversation(null)}
        />
      </main>
    </div>
  );
}
