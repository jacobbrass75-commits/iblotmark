import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePhotos, usePhotoStats, useUploadPhotos, useAutoAssociate, useDeletePhoto } from "@/hooks/usePhotoBank";

export default function PhotoBank() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: photos = [], isLoading } = usePhotos();
  const { data: stats } = usePhotoStats();
  const uploadMutation = useUploadPhotos();
  const associateMutation = useAutoAssociate();
  const deleteMutation = useDeletePhoto();
  const [filter, setFilter] = useState<"all" | "analyzed" | "unanalyzed" | "unassigned">("all");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      const result = await uploadMutation.mutateAsync({ files });
      toast({ title: "Photos Uploaded", description: result.message });
    } catch (err: any) {
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleBatchAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeStatus("Starting vision analysis...");
    try {
      const res = await fetch("/api/blog/photos/batch-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
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
              if (data.message) setAnalyzeStatus(data.message);
            } catch {}
          }
        }
      }
      toast({ title: "Analysis Complete" });
    } catch (err: any) {
      toast({ title: "Analysis Failed", description: err.message, variant: "destructive" });
    }
    setAnalyzing(false);
    setAnalyzeStatus("");
  };

  const handleAutoAssociate = async () => {
    try {
      const result = await associateMutation.mutateAsync();
      toast({ title: "Auto-Associate Complete", description: result.message });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const filtered = photos.filter((p: any) => {
    if (filter === "analyzed") return p.analyzedAt;
    if (filter === "unanalyzed") return !p.analyzedAt;
    if (filter === "unassigned") return !p.productId;
    return true;
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold">Photo Bank</h1>
            {stats && (
              <span className="text-sm text-muted-foreground">
                {stats.total} photos ({stats.analyzed} analyzed, {stats.unassigned} unassigned)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
              Upload Photos
            </Button>
            <Button variant="outline" size="sm" onClick={handleAutoAssociate} disabled={associateMutation.isPending}>
              {associateMutation.isPending ? "Associating..." : "Auto-Associate"}
            </Button>
            <Button size="sm" onClick={handleBatchAnalyze} disabled={analyzing}>
              {analyzing ? analyzeStatus : `Analyze (${stats?.unanalyzed || 0})`}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-4">
        {/* Filter bar */}
        <div className="flex gap-1">
          {(["all", "analyzed", "unanalyzed", "unassigned"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {f} ({f === "all" ? photos.length : photos.filter((p: any) =>
                f === "analyzed" ? p.analyzedAt :
                f === "unanalyzed" ? !p.analyzedAt :
                !p.productId
              ).length})
            </button>
          ))}
        </div>

        {/* Photo grid */}
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No photos found.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filtered.slice(0, 120).map((photo: any) => (
              <Card key={photo.id} className="overflow-hidden group relative">
                <div className="aspect-square bg-muted">
                  <img
                    src={`/api/blog/photos/thumb/${photo.id}`}
                    alt={photo.originalFilename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).src = `/api/blog/photos/serve/${photo.id}`; }}
                  />
                </div>
                <CardContent className="p-2">
                  <p className="text-xs truncate font-medium">{photo.originalFilename}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {photo.analyzedAt ? (
                      <>
                        {photo.contextType && <Badge variant="outline" className="text-[10px] px-1 py-0">{photo.contextType}</Badge>}
                        {photo.qualityScore && <Badge variant="outline" className="text-[10px] px-1 py-0">{(photo.qualityScore * 100).toFixed(0)}%</Badge>}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-orange-500">Not analyzed</Badge>
                    )}
                    {!photo.productId && <Badge variant="outline" className="text-[10px] px-1 py-0 text-blue-500">Unassigned</Badge>}
                  </div>
                  {photo.settingDescription && (
                    <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{photo.settingDescription}</p>
                  )}
                </CardContent>
                <button
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-destructive text-destructive-foreground rounded-full w-5 h-5 text-xs flex items-center justify-center transition-opacity"
                  onClick={() => deleteMutation.mutate(photo.id)}
                >
                  x
                </button>
              </Card>
            ))}
          </div>
        )}
        {filtered.length > 120 && (
          <p className="text-center text-sm text-muted-foreground">Showing 120 of {filtered.length} photos</p>
        )}
      </main>
    </div>
  );
}
