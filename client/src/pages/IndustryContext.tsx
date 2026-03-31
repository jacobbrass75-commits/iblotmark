import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useVerticals, useContextEntries, useVerifyEntry, useDeleteEntry, useAddContextEntry, useResearchJobs } from "@/hooks/useVerticals";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function IndustryContext() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: verticals = [] } = useVerticals();
  const { data: jobs = [] } = useResearchJobs();
  const [selectedVertical, setSelectedVertical] = useState<string>("");
  const { data: entries = [] } = useContextEntries(selectedVertical);
  // AI vertical creator
  const [showCreator, setShowCreator] = useState(false);
  const [creatorInput, setCreatorInput] = useState("");
  const [creating, setCreating] = useState(false);
  // Manual entry add
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [newEntryCategory, setNewEntryCategory] = useState("use_case");
  const [newEntryContent, setNewEntryContent] = useState("");
  const addEntryMutation = useAddContextEntry();
  const verifyMutation = useVerifyEntry();
  const deleteMutation = useDeleteEntry();
  const [researchRunning, setResearchRunning] = useState(false);
  const [researchStatus, setResearchStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const categories = ["terminology", "use_case", "pain_point", "regulation", "trend", "competitor", "user_language"];

  const runResearch = async (verticalId: string) => {
    setResearchRunning(true);
    setResearchStatus("Launching research agents...");
    try {
      const res = await fetch(`/api/blog/context/research/vertical/${verticalId}`, {
        method: "POST",
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
              if (data.message) setResearchStatus(data.message);
              if (data.completed !== undefined) setResearchStatus(`${data.completed} agents done, ${data.results?.reduce((s: number, r: any) => s + r.entriesFound, 0) || 0} entries found`);
            } catch {}
          }
        }
      }
      toast({ title: "Research Complete" });
    } catch (err: any) {
      toast({ title: "Research Failed", description: err.message, variant: "destructive" });
    }
    setResearchRunning(false);
    setResearchStatus("");
  };

  const runFullResearch = async () => {
    setResearchRunning(true);
    setResearchStatus("Launching Reddit agents for all verticals...");
    try {
      const res = await fetch("/api/blog/context/research/reddit", { method: "POST", credentials: "include" });
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
              if (data.completed !== undefined) setResearchStatus(`${data.completed}/${data.totalAgents} agents complete`);
            } catch {}
          }
        }
      }
      toast({ title: "Full Research Complete" });
    } catch (err: any) {
      toast({ title: "Research Failed", description: err.message, variant: "destructive" });
    }
    setResearchRunning(false);
  };

  const filteredEntries = filterCategory
    ? entries.filter((e: any) => e.category === filterCategory)
    : entries;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold">Industry Context Banks</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowCreator(!showCreator)}>
            {showCreator ? "Hide Creator" : "AI Create Vertical"}
          </Button>
          <Button size="sm" onClick={runFullResearch} disabled={researchRunning}>
            {researchRunning ? researchStatus : "Research All Verticals"}
          </Button>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-4">
        {/* AI Vertical Creator */}
        {showCreator && (
          <Card className="border-primary/50">
            <CardHeader><CardTitle className="text-base">AI-Powered Vertical Creator</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Describe a new industry vertical in a few lines. AI will generate the full vertical with terminology,
                pain points, use cases, regulations, and initial context entries.
              </p>
              <textarea
                className="w-full min-h-[100px] text-sm bg-transparent border rounded-lg p-3 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="e.g., Healthcare and medical facilities where tablets and phones need secure, sanitizable mounting for patient check-in kiosks, nurse workstations, and telemedicine carts..."
                value={creatorInput}
                onChange={(e) => setCreatorInput(e.target.value)}
              />
              <Button onClick={async () => {
                if (!creatorInput.trim()) return;
                setCreating(true);
                try {
                  const res = await apiRequest("POST", "/api/blog/verticals/create-from-description", { description: creatorInput });
                  const vertical = await res.json();
                  toast({ title: "Vertical Created", description: `"${vertical.name}" with context entries seeded` });
                  setCreatorInput("");
                  setShowCreator(false);
                  queryClient.invalidateQueries({ queryKey: ["/api/blog/context/verticals"] });
                } catch (err: any) {
                  toast({ title: "Error", description: err.message, variant: "destructive" });
                }
                setCreating(false);
              }} disabled={creating || !creatorInput.trim()}>
                {creating ? "Generating..." : "Create Vertical with AI"}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-12 gap-6">
          {/* Vertical list */}
          <div className="col-span-4 space-y-2">
            {verticals.map((v: any) => (
              <Card
                key={v.id}
                className={`cursor-pointer transition-colors ${selectedVertical === v.id ? "border-primary" : "hover:bg-muted/50"}`}
                onClick={() => setSelectedVertical(v.id)}
              >
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{v.name}</span>
                    {selectedVertical === v.id && !researchRunning && (
                      <Button variant="ghost" size="sm" className="text-xs h-6" onClick={(e) => { e.stopPropagation(); runResearch(v.id); }}>
                        Research
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{v.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Context entries */}
          <div className="col-span-8 space-y-4">
            {selectedVertical ? (
              <>
                {/* Category filter */}
                <div className="flex gap-1 flex-wrap">
                  <button
                    onClick={() => setFilterCategory("")}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${!filterCategory ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    All ({entries.length})
                  </button>
                  {categories.map((cat) => {
                    const count = entries.filter((e: any) => e.category === cat).length;
                    if (count === 0) return null;
                    return (
                      <button
                        key={cat}
                        onClick={() => setFilterCategory(cat)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${filterCategory === cat ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      >
                        {cat.replace("_", " ")} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Manual add entry */}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowAddEntry(!showAddEntry)}>
                    {showAddEntry ? "Cancel" : "+ Add Entry"}
                  </Button>
                </div>

                {showAddEntry && (
                  <Card className="border-primary/30">
                    <CardContent className="pt-3 space-y-2">
                      <select
                        className="w-full text-sm border rounded px-2 py-1 bg-transparent"
                        value={newEntryCategory}
                        onChange={(e) => setNewEntryCategory(e.target.value)}
                      >
                        {categories.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                      </select>
                      <textarea
                        className="w-full text-sm border rounded p-2 bg-transparent min-h-[60px] resize-y"
                        placeholder="Enter context entry content..."
                        value={newEntryContent}
                        onChange={(e) => setNewEntryContent(e.target.value)}
                      />
                      <Button size="sm" onClick={async () => {
                        if (!newEntryContent.trim()) return;
                        try {
                          await addEntryMutation.mutateAsync({ verticalId: selectedVertical, category: newEntryCategory, content: newEntryContent });
                          setNewEntryContent("");
                          setShowAddEntry(false);
                          toast({ title: "Entry added" });
                        } catch (err: any) {
                          toast({ title: "Error", description: err.message, variant: "destructive" });
                        }
                      }} disabled={addEntryMutation.isPending}>
                        Add Entry
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Entries */}
                <div className="space-y-2">
                  {filteredEntries.map((entry: any) => (
                    <Card key={entry.id} className={!entry.isVerified ? "border-orange-500/30" : ""}>
                      <CardContent className="pt-3 pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs">{entry.category.replace("_", " ")}</Badge>
                              <Badge variant="outline" className="text-xs">{entry.sourceType}</Badge>
                              {!entry.isVerified && <Badge variant="outline" className="text-xs text-orange-500 border-orange-500/30">Unverified</Badge>}
                              <span className="text-xs text-muted-foreground">conf: {entry.confidence?.toFixed(2)}</span>
                            </div>
                            <p className="text-sm">{entry.content}</p>
                          </div>
                          <div className="flex gap-1">
                            {!entry.isVerified && (
                              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => verifyMutation.mutate({ id: entry.id, verified: true })}>
                                Verify
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive" onClick={() => deleteMutation.mutate(entry.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center text-muted-foreground py-12">Select a vertical to view its context entries</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
