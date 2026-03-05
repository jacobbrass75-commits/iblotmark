import { formatDistanceToNow } from "date-fns";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { CheckCircle, XCircle, AlertTriangle, Gauge } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConversationTimeline, type TimelineEvent } from "@/hooks/useAnalytics";

interface ConversationTimelineProps {
  conversationId: string | null;
  onClose: () => void;
}

function ToolCallCard({ event }: { event: TimelineEvent }) {
  const success = event.success !== false;
  return (
    <div className={`border rounded-md p-3 text-xs font-mono space-y-1 ${success ? "border-chart-2/30 bg-chart-2/5" : "border-destructive/30 bg-destructive/5"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {success ? (
            <CheckCircle className="h-3.5 w-3.5 text-chart-2" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-destructive" />
          )}
          <span className="font-semibold text-foreground">
            {event.toolName?.replace("get_", "").replace(/_/g, " ")}
          </span>
        </div>
        <Badge variant="outline" className="text-[9px] px-1 py-0">
          R{event.escalationRound} T{event.turnNumber}
        </Badge>
      </div>
      {event.documentId && (
        <div className="text-muted-foreground truncate">doc: {event.documentId.slice(0, 16)}...</div>
      )}
      <div className="text-muted-foreground">
        {event.resultSizeChars?.toLocaleString()} chars
      </div>
    </div>
  );
}

function ContextSnapshotCard({ event }: { event: TimelineEvent }) {
  const level = event.warningLevel ?? "ok";
  const color = level === "critical" ? "text-destructive" : level === "caution" ? "text-yellow-500" : "text-chart-2";
  return (
    <div className="border border-border/50 rounded-md p-3 text-xs font-mono space-y-1 bg-card/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Gauge className={`h-3.5 w-3.5 ${color}`} />
          <span className="text-muted-foreground">Context Snapshot</span>
        </div>
        <Badge
          variant={level === "critical" ? "destructive" : "outline"}
          className="text-[9px] px-1 py-0"
        >
          {level.toUpperCase()}
        </Badge>
      </div>
      <div className={`text-lg font-bold ${color}`}>
        {((event.estimatedTokens ?? 0) / 1000).toFixed(1)}k tokens
      </div>
      {event.trigger && (
        <div className="text-muted-foreground">
          triggered by: {event.trigger}
        </div>
      )}
    </div>
  );
}

export function ConversationTimeline({ conversationId, onClose }: ConversationTimelineProps) {
  const { data, isLoading } = useConversationTimeline(conversationId);

  const tokenGrowthData = data?.timeline
    .filter((e) => e.type === "context_snapshot")
    .map((e, i) => ({
      index: i + 1,
      tokens: e.estimatedTokens ?? 0,
      level: e.warningLevel ?? "ok",
    })) ?? [];

  return (
    <Sheet open={!!conversationId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[500px] sm:w-[540px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle className="eva-section-title">
            Conversation Timeline
          </SheetTitle>
          {conversationId && (
            <div className="text-xs font-mono text-muted-foreground truncate">
              {conversationId}
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 px-6">
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground font-mono text-sm">
              Loading timeline...
            </div>
          ) : !data || data.timeline.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground font-mono text-sm">
              No events found for this conversation.
            </div>
          ) : (
            <div className="py-4 space-y-4">
              {tokenGrowthData.length > 1 && (
                <Card className="bg-card/50 border-border">
                  <CardContent className="pt-4 pb-2">
                    <div className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wider">
                      Token Growth
                    </div>
                    <ResponsiveContainer width="100%" height={100}>
                      <AreaChart data={tokenGrowthData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="index" hide />
                        <YAxis hide />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "6px",
                            fontSize: 11,
                          }}
                          formatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
                        />
                        <Area
                          type="monotone"
                          dataKey="tokens"
                          stroke="hsl(var(--chart-2))"
                          fill="url(#tokenGrad)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-2">
                {data.timeline.map((event, i) => (
                  <div key={i} className="relative">
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">
                      {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                    </div>
                    {event.type === "tool_call" ? (
                      <ToolCallCard event={event} />
                    ) : (
                      <ContextSnapshotCard event={event} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
