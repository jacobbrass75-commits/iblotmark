import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getRequiredCompanyScopedHeaders } from "@/lib/company";
import {
  useAddBenchmarkQuery,
  useAddBenchmarkQueriesBulk,
  useBenchmarkContentPlan,
  useBenchmarkProviderStatus,
  useBenchmarkQueries,
  useBenchmarkRuns,
  useLatestBenchmarkSummary,
  useMaterializeContentPlan,
} from "@/hooks/useAiBenchmark";

const PROVIDERS = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini_plain", label: "Gemini" },
  { id: "gemini_google_search", label: "Gemini + Google Search" },
] as const;

type ProviderId = typeof PROVIDERS[number]["id"];

function getProviderLabel(providerId: string): string {
  return PROVIDERS.find((provider) => provider.id === providerId)?.label || providerId.replace(/_/g, " ");
}

function formatRunDate(value: unknown): string {
  const raw = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  const date = raw instanceof Date
    ? raw
    : typeof raw === "number"
      ? new Date(raw < 10_000_000_000 ? raw * 1000 : raw)
      : new Date(String(raw || ""));

  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export default function AiBenchmark() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: queries = [] } = useBenchmarkQueries();
  const { data: runs = [] } = useBenchmarkRuns();
  const { data: latestSummary } = useLatestBenchmarkSummary();
  const { data: providerStatus = {} } = useBenchmarkProviderStatus();
  const latestRunId = latestSummary?.run?.id as string | undefined;
  const { data: contentPlan = [] } = useBenchmarkContentPlan(latestRunId);
  const addQueryMutation = useAddBenchmarkQuery();
  const addBulkQueriesMutation = useAddBenchmarkQueriesBulk();
  const materializeMutation = useMaterializeContentPlan();

  const [selectedProviders, setSelectedProviders] = useState<Record<ProviderId, boolean>>({
    chatgpt: true,
    claude: true,
    gemini_plain: true,
    gemini_google_search: true,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("Idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [newQuery, setNewQuery] = useState({
    category: "general",
    query: "",
    benchmarkGoal: "",
    persona: "",
    painPoint: "",
    brandAngle: "",
    targetProducts: "",
  });
  const [bulkQueries, setBulkQueries] = useState({
    category: "general",
    queries: "",
    benchmarkGoal: "",
    priority: 90,
  });

  const providerSelection = useMemo(
    () => Object.entries(selectedProviders).filter(([, enabled]) => enabled).map(([id]) => id),
    [selectedProviders],
  );
  const selectedConfiguredProviders = providerSelection.filter((provider) => providerStatus[provider]);
  const providerSetupComplete = selectedConfiguredProviders.length > 0;

  const runBenchmark = async () => {
    if (providerSelection.length === 0) {
      toast({ title: "Select at least one provider", variant: "destructive" });
      return;
    }
    if (!providerSetupComplete) {
      toast({
        title: "Benchmark providers not configured",
        description: "Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY/GOOGLE_AI_API_KEY before running.",
        variant: "destructive",
      });
      setRunStatus("No configured provider keys. Add keys before running a live benchmark.");
      return;
    }

    setIsRunning(true);
    setRunStatus("Launching AI benchmark...");
    setProgress({ current: 0, total: 0 });

    try {
      const res = await fetch("/api/blog/benchmark/run", {
        method: "POST",
        headers: getRequiredCompanyScopedHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({ providers: providerSelection }),
      });

      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Streaming benchmark response was not available.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "message";
      let dataLines: string[] = [];
      let streamError: string | null = null;

      const flushEvent = async () => {
        if (dataLines.length === 0) return;
        const data = JSON.parse(dataLines.join("\n"));

        if (eventName === "started" || eventName === "progress" || eventName === "completed") {
          if (data.message) setRunStatus(data.message);
          if (data.current !== undefined && data.total !== undefined) {
            setProgress({ current: data.current, total: data.total });
          }
        }
        if (eventName === "error") {
          streamError = data.error || "Benchmark failed.";
          setRunStatus(streamError || "Benchmark failed.");
        }

        if (eventName === "done" || eventName === "completed") {
          await Promise.all([
            queryClient.invalidateQueries({
              predicate: (query) =>
                typeof query.queryKey[0] === "string" &&
                query.queryKey[0].startsWith("/api/blog/benchmark"),
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
      if (streamError) {
        throw new Error(streamError);
      }
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
          <Button size="sm" onClick={runBenchmark} disabled={isRunning || !providerSetupComplete}>
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
                  <Badge variant={providerStatus[provider.id] ? "secondary" : "outline"} className="text-[10px]">
                    {providerStatus[provider.id] ? "configured" : "no key"}
                  </Badge>
                </label>
              ))}
            </div>
            {!providerSetupComplete && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <div className="font-medium">Live benchmarks are not configured yet.</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Add at least one provider key on the server, then restart: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY/GOOGLE_AI_API_KEY.
                </div>
              </div>
            )}
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
                      <div className="font-medium text-sm">{getProviderLabel(provider.provider)}</div>
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
                        <Badge key={`${query.id}-${result.provider}`} variant={(result.targetBrandMentioned ?? result.brandMentioned) ? "secondary" : "outline"} className="text-xs">
                          {getProviderLabel(result.provider)}: {result.coverageScore}
                        </Badge>
                      ))}
                    </div>
                    {query.benchmarkGoal && (
                      <div className="text-xs text-muted-foreground">{query.benchmarkGoal}</div>
                    )}
                    {(query.persona || query.painPoint || query.brandAngle) && (
                      <div className="text-xs text-muted-foreground space-y-1">
                        {query.persona && <div>Persona: {query.persona}</div>}
                        {query.painPoint && <div>Pain: {query.painPoint}</div>}
                        {query.brandAngle && <div>Brand angle: {query.brandAngle}</div>}
                      </div>
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
                <option value="priority">Priority Category</option>
                <option value="product">Product</option>
                <option value="audience">Audience</option>
                <option value="use-case">Use Case</option>
                <option value="comparison">Comparison</option>
                <option value="general">General</option>
              </select>
              <textarea
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[90px] resize-y"
                placeholder='Example: "best commercial espresso grinder for small cafe"'
                value={newQuery.query}
                onChange={(e) => setNewQuery((current) => ({ ...current, query: e.target.value }))}
              />
              <textarea
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[90px] resize-y"
                placeholder="What should this query accomplish for the target brand?"
                value={newQuery.benchmarkGoal}
                onChange={(e) => setNewQuery((current) => ({ ...current, benchmarkGoal: e.target.value }))}
              />
              <textarea
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[70px] resize-y"
                placeholder="Persona: operations manager, category buyer, store owner..."
                value={newQuery.persona}
                onChange={(e) => setNewQuery((current) => ({ ...current, persona: e.target.value }))}
              />
              <textarea
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[70px] resize-y"
                placeholder="Pain: replacement cost, setup confusion, poor durability, compliance risk..."
                value={newQuery.painPoint}
                onChange={(e) => setNewQuery((current) => ({ ...current, painPoint: e.target.value }))}
              />
              <textarea
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[70px] resize-y"
                placeholder="Brand angle: specific product, proof point, compatibility, service, or policy..."
                value={newQuery.brandAngle}
                onChange={(e) => setNewQuery((current) => ({ ...current, brandAngle: e.target.value }))}
              />
              <input
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={newQuery.targetProducts}
                onChange={(e) => setNewQuery((current) => ({ ...current, targetProducts: e.target.value }))}
                placeholder="Target products, comma separated"
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
                      persona: newQuery.persona,
                      painPoint: newQuery.painPoint,
                      brandAngle: newQuery.brandAngle,
                      targetProducts: newQuery.targetProducts.split(",").map((value) => value.trim()).filter(Boolean),
                    });
                    setNewQuery({
                      category: newQuery.category,
                      query: "",
                      benchmarkGoal: "",
                      persona: "",
                      painPoint: "",
                      brandAngle: "",
                      targetProducts: "",
                    });
                    toast({ title: "Query added" });
                  } catch (error: any) {
                    toast({ title: "Failed to add query", description: error.message, variant: "destructive" });
                  }
                }}
              >
                Add Query
              </Button>
              <div className="text-xs text-muted-foreground">
                Use this for priority subcategories, competitor comparisons, and long-tail buyer questions you want to track over time.
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
                <option value="priority">Priority Category</option>
                <option value="product">Product</option>
                <option value="audience">Audience</option>
                <option value="use-case">Use Case</option>
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
                placeholder={`Paste one query per line, or use:\nquery | persona | pain | brand angle | target products\n\nbest commercial espresso grinder for small cafe\nbest replacement filters for hard water | facilities manager | frequent replacement cost | durable parts and clear compatibility | Filter A, Filter B`}
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
                    .filter(Boolean)
                    .map((line) => {
                      const parts = line.split("|").map((part) => part.trim());
                      if (parts.length < 4) return line;
                      return {
                        query: parts[0],
                        persona: parts[1] || null,
                        painPoint: parts[2] || null,
                        brandAngle: parts[3] || null,
                        targetProducts: (parts[4] || "").split(",").map((value) => value.trim()).filter(Boolean),
                      };
                    });

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
              This is the backlog input for the 100-plus long-tail queries you want to dominate. Add persona, pain, brand angle, and products with pipe separators when you have them.
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
                      <Badge key={provider} variant="outline" className="text-xs">{getProviderLabel(provider)}</Badge>
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
                    {formatRunDate(run.createdAt)}
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
