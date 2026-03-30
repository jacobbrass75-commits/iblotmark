import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useClusters } from "@/hooks/useKeywords";
import { useBlogPipeline } from "@/hooks/useBlogPipeline";

export default function BatchGenerator() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: clusters = [] } = useClusters();
  const pipeline = useBlogPipeline();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, results: [] as any[] });

  const pendingClusters = clusters.filter((c: any) => c.status === "pending");
  const generatedClusters = clusters.filter((c: any) => c.status === "generated");

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    setSelected(new Set(pendingClusters.map((c: any) => c.id)));
  };

  const generateSingle = async (clusterId: string) => {
    await pipeline.generate(clusterId);
    if (pipeline.blogPost) {
      toast({ title: "Post Generated", description: `"${pipeline.blogPost.title}" scored ${pipeline.blogPost.overallScore}/100` });
    }
  };

  const generateBatch = async () => {
    if (selected.size === 0) return;
    setBatchRunning(true);
    setBatchProgress({ current: 0, total: selected.size, results: [] });

    const ids = Array.from(selected);
    for (let i = 0; i < ids.length; i++) {
      setBatchProgress((prev) => ({ ...prev, current: i + 1 }));
      try {
        await pipeline.generate(ids[i]);
        setBatchProgress((prev) => ({
          ...prev,
          results: [...prev.results, { clusterId: ids[i], status: "ok", title: pipeline.blogPost?.title }],
        }));
      } catch {
        setBatchProgress((prev) => ({
          ...prev,
          results: [...prev.results, { clusterId: ids[i], status: "failed" }],
        }));
      }
      pipeline.reset();
    }

    setBatchRunning(false);
    toast({ title: "Batch Complete", description: `Generated ${batchProgress.results.filter((r) => r.status === "ok").length}/${ids.length} posts` });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold">Generate Blog Posts</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectAllPending} disabled={batchRunning}>
              Select All Pending ({pendingClusters.length})
            </Button>
            <Button size="sm" onClick={generateBatch} disabled={selected.size === 0 || batchRunning}>
              {batchRunning ? `Generating ${batchProgress.current}/${batchProgress.total}...` : `Generate ${selected.size} Posts`}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-4">
        {/* Pipeline status */}
        {pipeline.isRunning && (
          <Card className="border-primary/50">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{pipeline.phase}</span>
                <span className="text-xs text-muted-foreground">{pipeline.message}</span>
              </div>
              <Progress value={pipeline.phase === "planner" ? 25 : pipeline.phase === "writer" ? 50 : pipeline.phase === "stitcher" ? 75 : pipeline.phase === "verifier" ? 90 : 100} />
              {pipeline.plan && (
                <p className="text-xs text-muted-foreground mt-2">Generating: "{pipeline.plan.title}"</p>
              )}
            </CardContent>
          </Card>
        )}

        {pipeline.error && (
          <Card className="border-destructive/50">
            <CardContent className="pt-4 text-sm text-destructive">{pipeline.error}</CardContent>
          </Card>
        )}

        {/* Batch progress */}
        {batchRunning && (
          <Card>
            <CardContent className="pt-4">
              <Progress value={(batchProgress.current / batchProgress.total) * 100} className="mb-2" />
              <p className="text-xs text-muted-foreground">{batchProgress.current} of {batchProgress.total} clusters</p>
            </CardContent>
          </Card>
        )}

        {/* Cluster selection */}
        <div className="space-y-2">
          {clusters.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0)).map((cluster: any) => {
            const isSelected = selected.has(cluster.id);
            const isGenerated = cluster.status === "generated";

            return (
              <Card
                key={cluster.id}
                className={`cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : ""} ${isGenerated ? "opacity-60" : ""}`}
                onClick={() => !batchRunning && !isGenerated && toggleSelect(cluster.id)}
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
                          Primary: "{cluster.primaryKeyword}" &middot; {cluster.keywords?.length || 0} keywords &middot; Volume: {cluster.totalVolume?.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isGenerated ? "secondary" : "outline"}>{cluster.status}</Badge>
                      {!isGenerated && !batchRunning && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); generateSingle(cluster.id); }}
                          disabled={pipeline.isRunning}
                        >
                          Generate
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
