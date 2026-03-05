import { Activity, AlertTriangle, MessageSquare, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsOverview, ConversationSummary } from "@/hooks/useAnalytics";

interface OverviewCardsProps {
  overview: AnalyticsOverview | undefined;
  conversations: ConversationSummary[];
  isLoading: boolean;
}

export function OverviewCards({ overview, conversations, isLoading }: OverviewCardsProps) {
  const totalToolCalls = overview?.totals.toolCalls ?? 0;
  const totalConversations = overview?.totals.uniqueConversations ?? 0;

  const totalFailures = overview?.toolCallFrequency.reduce((sum, t) => sum + t.failureCount, 0) ?? 0;
  const failureRate = totalToolCalls > 0 ? ((totalFailures / totalToolCalls) * 100).toFixed(1) : "0";

  const avgPeakTokens =
    conversations.length > 0
      ? Math.round(
          conversations.reduce((sum, c) => sum + (c.peakTokens ?? 0), 0) / conversations.length
        )
      : 0;

  const placeholder = isLoading ? "..." : "0";

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm eva-section-title flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Conversations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-3xl text-chart-2">
            {isLoading ? placeholder : totalConversations}
          </div>
        </CardContent>
      </Card>

      <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm eva-section-title flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Tool Calls
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-3xl text-chart-3">
            {isLoading ? placeholder : totalToolCalls}
          </div>
        </CardContent>
      </Card>

      <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm eva-section-title flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            Failure Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`font-mono text-3xl ${Number(failureRate) > 10 ? "text-destructive" : "text-chart-2"}`}>
            {isLoading ? placeholder : `${failureRate}%`}
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-1">
            {totalFailures} / {totalToolCalls} calls
          </div>
        </CardContent>
      </Card>

      <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm eva-section-title flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Avg Peak Tokens
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-3xl text-primary">
            {isLoading ? placeholder : avgPeakTokens.toLocaleString()}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
