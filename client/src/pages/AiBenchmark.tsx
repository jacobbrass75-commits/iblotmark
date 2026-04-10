import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  useAddBenchmarkQuery,
  useAddBenchmarkQueriesBulk,
  useBenchmarkContentPlan,
  useBenchmarkQueries,
  useBenchmarkRuns,
  useLatestBenchmarkSummary,
  useMaterializeContentPlan,
} from "@/hooks/useAiBenchmark";

const PROVIDERS = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "google_search", label: "Google Search" },
] as const;

type ProviderId = typeof PROVIDERS[number]["id"];

export default function AiBenchmark() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: queries = [] } = useBenchmarkQueries();
  const { data: runs = [] } = useBenchmarkRuns();
  const { data: latestSummary } = useLatestBenchmarkSummary();
  const latestRunId = latestSummary?.run?.id as string | undefined;
  const { data: contentPlan = [] } = useBenchmarkContentPlan(latestRunId);
  const addQueryMutation = useAddBenchmarkQuery();
  const addBulkQueriesMutation = useAddBenchmarkQueriesBulk();
  const materializeMutation = useMaterializeContentPlan();

  const [selectedProviders, setSelectedProviders] = useState<Record<ProviderId, boolean>>({
    chatgpt: true,
    claude: true,
    gemini: true,
    google_search: true,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("Idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [newQuery, setNewQuery] = useState({
    category: "fishing",
    query: "",
    benchmarkGoal: "",
  });
  const [bulkQueries, setBulkQueries] = useState({
    category: "fishing",
    queries: "",
    benchmarkGoal: "",
    priority: 90,
  });

  const providerSelection = useMemo(
    () => Object.entries(selectedProviders).filter(([, enabled]) => enabled).map(([id]) => id),
    [selectedProviders],
  );

  const runBenchmark = async () => {
    if (providerSelection.length === 0) {
      toast({ title: "Select at least one provider", variant: "destructive" });
      return;
    }

    setIsRunning(true);
    setRunStatus("Launching AI benchmark...");
    setProgress({ current: 0, total: 0 });

    try {
      const res = await fetch("/api/blog/benchmark/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ providers: providerSelection }),
      });

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Streaming benchmark response was not available.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "message";
      let dataLines: string[] = [];

      const flushEvent = async () => {
        if (dataLines.length === 0) return;
        const data = JSON.parse(dataLines.join("\n"));

        if (eventName === "started" || eventName === "progress" || eventName === "completed") {
          if (data.message) setRunStatus(data.message);
          if (data.current !== undefined && data.total !== undefined) {
            setProgress({ current: data.current, total: data.total });
          }
        }

        if (eventName === "done" || eventName === "completed") {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["/api/blog/benchmark/latest"] }),
            queryClient.invalidateQueries({ queryKey: ["/api/blog/benchmark/runs?limit=8"] }),
            queryClient.invalidateQueries({
              predicate: (query) =>
                typeof query.queryKey[0] === "string" &&
                query.queryKey[0].startsWith("/api/blog/benchmark/content-plan"),
            }),
          ]);
        }

        eventName = "message";
        dataLines = [];
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) {
            await flushEvent();
            continue;
          }

          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
            continue;
          }

          if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          }
        }
      }

      await flushEvent();
      toast({ title: "Benchmark complete" });
    } catch (error: any) {
      toast({ title: "Benchmark failed", description: error.message, variant: "destructive" });
      setRunStatus(error.message);
    } finally {
      setIsRunning(false);
    }
  };

  const querySummaryById = new Map<string, any>(
    ((latestSummary?.querySummaries || []) as any[]).map((summary) => [summary.queryId, summary]),
  );

  const handleMaterialize = async (item: any, mode: "cluster" | "queue") => {
    try {
      const result = await materializeMutation.mutateAsync({
        item,
        queueForGeneration: mode === "queue",
      });

      if (mode === "queue" && result.queued) {
        toast({
          title: result.duplicate ? "Existing cluster queued" : "Cluster created and queued",
          description: item.title,
        });
        setLocation("/blog/generate");
        return;
      }

      toast({
        title: result.duplicate ? "Using existing cluster" : "Cluster created",
        description: item.title,
      });
    } catch (error: any) {
      toast({ title: "Action failed", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold">AI Search Benchmark</h1>
          </div>
          <Button size="sm" onClick={runBenchmark} disabled={isRunning}>
            {isRunning ? "Running..." : "Run Benchmark"}
          </Button>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weekly Tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              {PROVIDERS.map((provider) => (
                <label key={provider.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedProviders[provider.id]}
                    onChange={(e) => setSelectedProviders((current) => ({ ...current, [provider.id]: e.target.checked }))}
                  />
                  <span>{provider.label}</span>
                </label>
              ))}
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-sm font-medium">{runStatus}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {progress.total > 0 ? `${progress.current}/${progress.total} provider-query checks complete` : "Select providers, then run the benchmark."}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {(latestSummary?.providerSummaries || []).map((provider: any) => (
                <Card key={provider.provider} className="border-border/60">
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">{provider.provider.replace("_", " ")}</div>
                      <Badge variant="outline">{provider.avgScore}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">Mention rate: {provider.mentionRate}%</div>
                    <div className="text-xs text-muted-foreground">Citation rate: {provider.citationRate}%</div>
                    <div className="text-xs text-muted-foreground">Top 3 rate: {provider.topThreeRate}%</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Tracked Queries</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {queries.map((query: any) => {
                const summary = querySummaryById.get(query.id);
                return (
                  <div key={query.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-sm">{query.query}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {query.category} · priority {Math.round(query.priority || 0)}
                        </div>
                      </div>
                      <Badge variant={summary?.averageScore >= 70 ? "secondary" : "outline"}>
                        {summary?.averageScore ?? "—"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(summary?.results || []).map((result: any) => (
                        <Badge key={`${query.id}-${result.provider}`} variant={result.brandMentioned ? "secondary" : "outline"} className="text-xs">
                          {result.provider}: {result.coverageScore}
                        </Badge>
                      ))}
                    </div>
                    {query.benchmarkGoal && (
                      <div className="text-xs text-muted-foreground">{query.benchmarkGoal}</div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add Query</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={newQuery.category}
                onChange={(e) => setNewQuery((current) => ({ ...current, category: e.target.value }))}
              >
                <option value="fishing">Fishing</option>
                <option value="warehouse">Warehouse</option>
                <option value="fleet">Fleet</option>
                <option value="restaurant">Restaurant</option>
                <option value="comparison">Comparison</option>
                <option value="general">General</option>
              </select>
              <textarea
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[90px] resize-y"
                placeholder='Example: "best fish finder mount for jon boat"'
                value={newQuery.query}
                onChange={(e) => setNewQuery((current) => ({ ...current, query: e.target.value }))}
              />
              <textarea
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[90px] resize-y"
                placeholder="What should this query accomplish for iBolt?"
                value={newQuery.benchmarkGoal}
                onChange={(e) => setNewQuery((current) => ({ ...current, benchmarkGoal: e.target.value }))}
              />
              <Button
                className="w-full"
                disabled={addQueryMutation.isPending || !newQuery.query.trim()}
                onClick={async () => {
                  try {
                    await addQueryMutation.mutateAsync({
                      category: newQuery.category,
                      query: newQuery.query,
                      benchmarkGoal: newQuery.benchmarkGoal,
                    });
                    setNewQuery({ category: newQuery.category, query: "", benchmarkGoal: "" });
                    toast({ title: "Query added" });
                  } catch (error: any) {
                    toast({ title: "Failed to add query", description: error.message, variant: "destructive" });
                  }
                }}
              >
                Add Query
              </Button>
              <div className="text-xs text-muted-foreground">
                Use this for the subcategories you want to dominate next, especially fish finder and other long-tail commercial intents.
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bulk Add Subcategories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={bulkQueries.category}
                onChange={(e) => setBulkQueries((current) => ({ ...current, category: e.target.value }))}
              >
                <option value="fishing">Fishing</option>
                <option value="warehouse">Warehouse</option>
                <option value="fleet">Fleet</option>
                <option value="restaurant">Restaurant</option>
                <option value="comparison">Comparison</option>
                <option value="general">General</option>
              </select>
              <input
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                type="number"
                min={1}
                max={100}
                value={bulkQueries.priority}
                onChange={(e) => setBulkQueries((current) => ({ ...current, priority: Number(e.target.value) || 50 }))}
                placeholder="Priority"
              />
              <input
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={bulkQueries.benchmarkGoal}
                onChange={(e) => setBulkQueries((current) => ({ ...current, benchmarkGoal: e.target.value }))}
                placeholder="Shared benchmark goal"
              />
            </div>
            <textarea
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[180px] resize-y"
              placeholder={`Paste one subcategory per line, for example:\nbest fish finder mount for jon boat\nbest fish finder mount for aluminum boat\nbest fish finder mount for kayak tournament setup`}
              value={bulkQueries.queries}
              onChange={(e) => setBulkQueries((current) => ({ ...current, queries: e.target.value }))}
            />
            <Button
              className="w-full"
              disabled={addBulkQueriesMutation.isPending || !bulkQueries.queries.trim()}
              onClick={async () => {
                try {
                  const queries = bulkQueries.queries
                    .split(/\n+/)
                    .map((value) => value.trim())
                    .filter(Boolean);

                  const result = await addBulkQueriesMutation.mutateAsync({
                    category: bulkQueries.category,
                    queries,
                    benchmarkGoal: bulkQueries.benchmarkGoal,
                    priority: bulkQueries.priority,
                  });

                  setBulkQueries((current) => ({ ...current, queries: "", benchmarkGoal: "" }));
                  toast({ title: `Added ${result.createdCount} subcategories` });
                } catch (error: any) {
                  toast({ title: "Failed to add subcategories", description: error.message, variant: "destructive" });
                }
              }}
            >
              Add Subcategory Batch
            </Button>
            <div className="text-xs text-muted-foreground">
              This is the backlog input for the 100-plus long-tail queries you want to dominate. Paste one query per line, then rerun the benchmark.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Content Plan From Latest Gaps</CardTitle>
            <Badge variant="outline">{contentPlan.length} ideas</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {contentPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground">Run a benchmark to generate a fresh, non-duplicative content plan.</p>
            ) : (
              contentPlan.map((item: any) => (
                <div key={`${item.queryId}-${item.title}`} className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{item.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Primary keyword: {item.primaryKeyword}
                      </div>
                    </div>
                    <Badge variant="secondary">{item.gapScore}</Badge>
                  </div>
                  <div className="text-sm">{item.angle}</div>
                  <div className="text-xs text-muted-foreground">{item.whyNow}</div>
                  <div className="flex flex-wrap gap-2">
                    {(item.recommendedProviders || []).map((provider: string) => (
                      <Badge key={provider} variant="outline" className="text-xs">{provider}</Badge>
                    ))}
                    {(item.supportingProducts || []).slice(0, 3).map((product: string) => (
                      <Badge key={product} variant="outline" className="text-xs">{product}</Badge>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.uniquenessReason}
                    {item.closestExistingTitle ? ` Closest existing content: ${item.closestExistingTitle}.` : ""}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={materializeMutation.isPending}
                      onClick={() => handleMaterialize(item, "cluster")}
                    >
                      Create Cluster
                    </Button>
                    <Button
                      size="sm"
                      disabled={materializeMutation.isPending}
                      onClick={() => handleMaterialize(item, "queue")}
                    >
                      Create & Queue
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.map((run: any) => (
              <div key={run.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div>
                  <div className="font-medium">{run.name || "Untitled run"}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(run.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={run.status === "completed" ? "secondary" : "outline"}>{run.status}</Badge>
                  <span className="text-xs text-muted-foreground">{run.resultCount || 0} results</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
