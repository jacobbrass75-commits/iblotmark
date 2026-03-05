import { formatDistanceToNow } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ConversationSummary } from "@/hooks/useAnalytics";

interface ConversationTableProps {
  conversations: ConversationSummary[];
  isLoading: boolean;
  onSelect: (conversationId: string) => void;
}

export function ConversationTable({ conversations, isLoading, onSelect }: ConversationTableProps) {
  return (
    <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
      <CardHeader className="pb-2">
        <CardTitle className="eva-section-title">Conversation History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono">Loading conversations...</div>
        ) : conversations.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono py-8 text-center">
            No conversation data yet. Use the writing chat to generate analytics.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left py-2 px-2">Conversation</th>
                  <th className="text-left py-2 px-2">Last Activity</th>
                  <th className="text-right py-2 px-2">Tools</th>
                  <th className="text-right py-2 px-2">Fails</th>
                  <th className="text-right py-2 px-2">Turns</th>
                  <th className="text-right py-2 px-2">Peak Tokens</th>
                  <th className="text-center py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conv) => (
                  <tr
                    key={conv.conversationId}
                    className="border-b border-border/50 hover:bg-primary/5 cursor-pointer transition-colors"
                    onClick={() => onSelect(conv.conversationId)}
                  >
                    <td className="py-2.5 px-2">
                      <div className="text-primary truncate max-w-[200px]">
                        {conv.title || conv.conversationId.slice(0, 12) + "..."}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-muted-foreground text-xs">
                      {formatDistanceToNow(new Date(conv.lastActivity), { addSuffix: true })}
                    </td>
                    <td className="py-2.5 px-2 text-right text-chart-3">{conv.toolCallCount}</td>
                    <td className="py-2.5 px-2 text-right">
                      <span className={conv.failureCount > 0 ? "text-destructive" : "text-muted-foreground"}>
                        {conv.failureCount}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-chart-2">{conv.maxTurn}</td>
                    <td className="py-2.5 px-2 text-right">
                      {conv.peakTokens ? (conv.peakTokens / 1000).toFixed(0) + "k" : "-"}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {conv.hitCritical ? (
                        <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                          <AlertTriangle className="h-3 w-3 mr-0.5" />
                          CRITICAL
                        </Badge>
                      ) : conv.failureCount > 0 ? (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-yellow-500 border-yellow-500/50">
                          WARN
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-chart-2 border-chart-2/50">
                          OK
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
