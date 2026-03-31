import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useClusters } from "@/hooks/useKeywords";
import { apiRequest } from "@/lib/queryClient";

export default function BatchGenerator() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: clusters = [] } = useClusters();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<any[]>([]);
  const [tab, setTab] = useState<"clusters" | "queue" | "competitor">("queue");
  const [competitorUrls, setCompetitorUrls] = useState("");
  const [competitorRunning, setCompetitorRunning] = useState(false);
  const [competitorStatus, setCompetitorStatus] = useState("");
  const [competitorResults, setCompetitorResults] = useState<any[]>([]);

  // SSE stream for queue updates
  useEffect(() => {
    const evtSource = new EventSource("/api/blog/queue/stream");
    evtSource.onmessage = (e) => {
      try { setQueue(JSON.parse(e.data)); } catch {}
    };
    return () => evtSource.close();
  }, []);

  // Refresh queue on mount
  useEffect(() => {
    fetch("/api/blog/queue", { credentials: "include" })
      .then((r) => r.json())
      .then(setQueue)
      .catch(() => {});
  }, []);

  const pendingClusters = clusters.filter((c: any) => c.status === "pending");
  const queueRunning = queue.filter((j: any) => j.status === "running");
  const queueCompleted = queue.filter((j: any) => j.status === "completed");
  const queueFailed = queue.filter((j: any) => j.status === "failed");

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addToQueue = async () => {
    if (selected.size === 0) return;
    const items = Array.from(selected).map((id) => {
      const cluster = clusters.find((c: any) => c.id === id);
      return { clusterId: id, label: cluster?.name || "Blog post" };
    });
    await apiRequest("POST", "/api/blog/queue/add-batch", { items });
    setSelected(new Set());
    toast({ title: `Added ${items.length} posts to queue` });
  };

  const addSingleToQueue = async (clusterId: string, label: string) => {
    await apiRequest("POST", "/api/blog/queue/add", { clusterId, label });
    toast({ title: "Added to queue" });
  };

  const clearCompleted = async () => {
    await apiRequest("POST", "/api/blog/queue/clear");
  };

  // Competitor scraper
  const runCompetitorAnalysis = async () => {
    const urls = competitorUrls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    setCompetitorRunning(true);
    setCompetitorStatus("Analyzing competitor posts...");
    setCompetitorResults([]);

    try {
      const res = await fetch("/api/blog/competitor/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
        credentials: "include",
      });

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.message) setCompetitorStatus(data.message);
              if (data.results) setCompetitorResults(data.results);
            } catch {}
          }
        }
      }

      toast({ title: "Competitor Analysis Complete" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setCompetitorRunning(false);
  };

  const fetchSitemap = async (domain: string) => {
    try {
      const res = await apiRequest("POST", "/api/blog/competitor/sitemap", { domain });
      const data = await res.json();
      setCompetitorUrls((prev) => prev + (prev ? "\n" : "") + data.urls.join("\n"));
      toast({ title: `Found ${data.count} blog URLs from ${domain}` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold">Generate Blog Posts</h1>
            {queueRunning.length > 0 && (
              <Badge variant="default">{queueRunning.length} generating</Badge>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-4">
        {/* Tab bar */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          {[
            { key: "queue", label: `Queue (${queue.length})` },
            { key: "clusters", label: `Clusters (${pendingClusters.length} pending)` },
            { key: "competitor", label: "Competitor Scraper" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === t.key ? "bg-background shadow font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* QUEUE TAB */}
        {tab === "queue" && (
          <div className="space-y-3">
            {queue.length > 0 && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={clearCompleted}>Clear Completed</Button>
              </div>
            )}

            {queue.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  Queue is empty. Add clusters from the Clusters tab or paste competitor URLs.
                </CardContent>
              </Card>
            ) : (
              queue.map((job: any) => (
                <Card key={job.id} className={job.status === "running" ? "border-primary/50" : job.status === "failed" ? "border-destructive/50" : ""}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={
                          job.status === "running" ? "default" :
                          job.status === "completed" ? "secondary" :
                          job.status === "failed" ? "destructive" : "outline"
                        }>
                          {job.status}
                        </Badge>
                        <span className="font-medium text-sm">{job.label}</span>
                        {job.score && (
                          <span className={`text-sm font-mono font-bold ${job.score >= 70 ? "text-green-500" : "text-orange-500"}`}>
                            {job.score}/100
                          </span>
                        )}
                      </div>
                      {job.postId && (
                        <Button variant="ghost" size="sm" onClick={() => setLocation(`/blog/posts/${job.postId}`)}>View</Button>
                      )}
                    </div>
                    {job.status === "running" && (
                      <>
                        <Progress value={
                          job.phase === "planner" ? 15 :
                          job.phase === "writer" ? 40 :
                          job.phase === "stitcher" ? 70 :
                          job.phase === "verifier" ? 85 :
                          job.phase === "save" ? 95 : 5
                        } className="mb-1" />
                        <p className="text-xs text-muted-foreground">{job.progress}</p>
                      </>
                    )}
                    {job.error && <p className="text-xs text-destructive mt-1">{job.error}</p>}
                    {job.postTitle && <p className="text-xs text-muted-foreground mt-1">{job.postTitle}</p>}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {/* CLUSTERS TAB */}
        {tab === "clusters" && (
          <div className="space-y-3">
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set(pendingClusters.map((c: any) => c.id)))}>
                Select All Pending ({pendingClusters.length})
              </Button>
              <Button size="sm" onClick={addToQueue} disabled={selected.size === 0}>
                Add {selected.size} to Queue
              </Button>
            </div>

            {clusters.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0)).map((cluster: any) => {
              const isSelected = selected.has(cluster.id);
              const isGenerated = cluster.status === "generated";
              return (
                <Card
                  key={cluster.id}
                  className={`cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : ""} ${isGenerated ? "opacity-60" : ""}`}
                  onClick={() => !isGenerated && toggleSelect(cluster.id)}
                >
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"}`}>
                          {isSelected && "✓"}
                        </div>
                        <div>
                          <h3 className="font-medium text-sm">{cluster.name}</h3>
                          <p className="text-xs text-muted-foreground">
                            "{cluster.primaryKeyword}" | {cluster.keywords?.length || 0} kws | vol: {cluster.totalVolume?.toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={isGenerated ? "secondary" : "outline"}>{cluster.status}</Badge>
                        {!isGenerated && (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); addSingleToQueue(cluster.id, cluster.name); }}>
                            Queue
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* COMPETITOR TAB */}
        {tab === "competitor" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Competitor Blog Scraper</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Paste competitor blog URLs (one per line). AI will analyze each, filter for iBOLT relevance,
                  and automatically queue generation for posts that apply to our products.
                </p>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fetchSitemap("rammount.com")}>Load RAM Mount Blog URLs</Button>
                  <Button variant="outline" size="sm" onClick={() => fetchSitemap("arkon.com")}>Load Arkon Blog URLs</Button>
                </div>

                <textarea
                  className="w-full min-h-[200px] font-mono text-xs bg-transparent border rounded-lg p-3 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Paste competitor blog URLs here (one per line)..."
                  value={competitorUrls}
                  onChange={(e) => setCompetitorUrls(e.target.value)}
                />

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {competitorUrls.split("\n").filter(Boolean).length} URLs loaded
                  </span>
                  <Button onClick={runCompetitorAnalysis} disabled={competitorRunning || !competitorUrls.trim()}>
                    {competitorRunning ? competitorStatus : "Analyze & Queue Relevant Posts"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Competitor results */}
            {competitorResults.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Analysis Results ({competitorResults.filter((r: any) => r.isRelevant).length} relevant / {competitorResults.length} total)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {competitorResults.map((result: any, i: number) => (
                      <div key={i} className={`p-3 rounded-lg border text-sm ${result.isRelevant ? "border-green-500/30" : "border-muted"}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{result.title}</span>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{result.url}</p>
                            <p className="text-xs mt-1">{result.relevanceReason}</p>
                            {result.isRelevant && result.suggestedTitle && (
                              <p className="text-xs text-green-600 mt-1">iBOLT post: {result.suggestedTitle}</p>
                            )}
                          </div>
                          <Badge variant={result.isRelevant ? "default" : "outline"} className="ml-2">
                            {result.isRelevant ? "Queued" : "Skipped"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
