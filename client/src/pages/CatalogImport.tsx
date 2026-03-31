import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCatalogImports, useCatalogExtractions } from "@/hooks/useCatalogImport";

export default function CatalogImport() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: imports = [] } = useCatalogImports();
  const [selectedImport, setSelectedImport] = useState("");
  const { data: extractions = [] } = useCatalogExtractions(selectedImport);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus("Uploading PDF...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/blog/catalog/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
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
              if (data.message) setUploadStatus(data.message);
            } catch {}
          }
        }
      }

      toast({ title: "Catalog Imported" });
    } catch (err: any) {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    }

    setUploading(false);
    setUploadStatus("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const matched = extractions.filter((e: any) => e.matchStatus === "matched");
  const unmatched = extractions.filter((e: any) => e.matchStatus === "new");
  const pending = extractions.filter((e: any) => e.matchStatus === "pending");

  const filtered = filterStatus
    ? extractions.filter((e: any) => e.matchStatus === filterStatus)
    : extractions;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold">Product Catalog Import</h1>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? uploadStatus : "Import PDF"}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Import history */}
          <div className="col-span-4 space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Import History</h2>
            {imports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No imports yet. Upload a PDF catalog to get started.</p>
            ) : (
              imports.map((imp: any) => (
                <Card
                  key={imp.id}
                  className={`cursor-pointer transition-colors ${selectedImport === imp.id ? "border-primary" : "hover:bg-muted/50"}`}
                  onClick={() => setSelectedImport(imp.id)}
                >
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">{imp.filename}</span>
                      <Badge variant={imp.status === "completed" ? "secondary" : "outline"}>{imp.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {imp.extractedProducts} extracted, {imp.matchedProducts} matched, {imp.newProducts} new
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Extractions */}
          <div className="col-span-8 space-y-4">
            {selectedImport ? (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium">Extracted Products ({extractions.length})</h2>
                  <div className="flex gap-1 ml-auto">
                    {[
                      { label: "All", value: "", count: extractions.length },
                      { label: "Matched", value: "matched", count: matched.length },
                      { label: "New", value: "new", count: unmatched.length },
                      { label: "Pending", value: "pending", count: pending.length },
                    ].map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setFilterStatus(f.value)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${filterStatus === f.value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      >
                        {f.label} ({f.count})
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                  {filtered.map((ext: any) => (
                    <div key={ext.id} className="flex items-start justify-between p-3 rounded-lg border text-sm">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{ext.extractedName}</span>
                        {ext.extractedDescription && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ext.extractedDescription}</p>
                        )}
                        {ext.pageNumber && <span className="text-xs text-muted-foreground ml-2">p.{ext.pageNumber}</span>}
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        <span className="text-xs text-muted-foreground">{(ext.confidence * 100).toFixed(0)}%</span>
                        <Badge
                          variant={ext.matchStatus === "matched" ? "secondary" : ext.matchStatus === "new" ? "default" : "outline"}
                          className="text-xs"
                        >
                          {ext.matchStatus}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center text-muted-foreground py-12">
                Select an import to view extracted products
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
