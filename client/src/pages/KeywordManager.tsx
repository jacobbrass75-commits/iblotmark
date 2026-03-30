import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useKeywords, useClusters, useImports, useImportKeywords, useClusterKeywords } from "@/hooks/useKeywords";

export default function KeywordManager() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"keywords" | "clusters" | "imports">("clusters");

  const { data: keywords = [] } = useKeywords();
  const { data: clusters = [] } = useClusters();
  const { data: imports = [] } = useImports();
  const importMutation = useImportKeywords();
  const clusterMutation = useClusterKeywords();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importMutation.mutateAsync(file);
      toast({ title: "Keywords Imported", description: result.message });
    } catch (err: any) {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleCluster = async () => {
    try {
      const result = await clusterMutation.mutateAsync();
      toast({ title: "Clustering Complete", description: result.message });
    } catch (err: any) {
      toast({ title: "Clustering Failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold">Keyword Manager</h1>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={importMutation.isPending}>
              {importMutation.isPending ? "Importing..." : "Import CSV"}
            </Button>
            <Button size="sm" onClick={handleCluster} disabled={clusterMutation.isPending}>
              {clusterMutation.isPending ? "Clustering..." : "AI Cluster"}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-4">
        {/* Tab bar */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          {(["clusters", "keywords", "imports"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === t ? "bg-background shadow font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "clusters" ? `Clusters (${clusters.length})` : t === "keywords" ? `Keywords (${keywords.length})` : `Imports (${imports.length})`}
            </button>
          ))}
        </div>

        {tab === "clusters" && (
          <div className="space-y-3">
            {clusters.map((cluster: any) => (
              <Card key={cluster.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium">{cluster.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Primary: "{cluster.primaryKeyword}" &middot; Volume: {cluster.totalVolume?.toLocaleString()} &middot; Avg Difficulty: {Math.round(cluster.avgDifficulty)}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {cluster.keywords?.map((kw: any) => (
                          <Badge key={kw.id} variant="outline" className="text-xs">
                            {kw.keyword} <span className="ml-1 opacity-50">{kw.volume}</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Badge variant={cluster.status === "generated" ? "secondary" : "default"}>
                      {cluster.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "keywords" && (
          <Card>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Keyword</th>
                      <th className="pb-2 pr-4 text-right">Volume</th>
                      <th className="pb-2 pr-4 text-right">Difficulty</th>
                      <th className="pb-2 pr-4 text-right">Opportunity</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keywords.sort((a: any, b: any) => (b.opportunityScore || 0) - (a.opportunityScore || 0)).map((kw: any) => (
                      <tr key={kw.id} className="border-b border-border/50">
                        <td className="py-2 pr-4 font-medium">{kw.keyword}</td>
                        <td className="py-2 pr-4 text-right">{kw.volume?.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right">{kw.difficulty}</td>
                        <td className="py-2 pr-4 text-right font-mono">{kw.opportunityScore?.toFixed(1)}</td>
                        <td className="py-2">
                          <Badge variant="outline" className="text-xs">{kw.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "imports" && (
          <div className="space-y-2">
            {imports.map((imp: any) => (
              <Card key={imp.id}>
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{imp.filename}</span>
                    <span className="text-xs text-muted-foreground ml-3">
                      {imp.totalKeywords} total, {imp.newKeywords} new, {imp.duplicateKeywords} dupes
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(imp.importedAt).toLocaleDateString()}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
