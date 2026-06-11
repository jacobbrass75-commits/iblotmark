import { useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, Edit3, ImagePlus, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch as ToggleSwitch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  usePhotos,
  usePhotoStats,
  useUploadPhotos,
  useAutoAssociate,
  useDeletePhoto,
  useUpdatePhoto,
  type PhotoMetadataUpdate,
} from "@/hooks/usePhotoBank";
import { useProducts } from "@/hooks/useProducts";
import { getActiveCompanyId, getRequiredCompanyScopedHeaders } from "@/lib/company";
import { queryClient } from "@/lib/queryClient";

type Filter = "all" | "needs_review" | "approved" | "unassigned" | "restricted" | "unanalyzed";

type PhotoEditForm = {
  productId: string;
  assetStatus: "needs_review" | "approved" | "archived";
  rightsStatus: "unknown" | "owned" | "licensed" | "restricted";
  usageRestrictions: string;
  useCases: string;
  altText: string;
  caption: string;
  notes: string;
  sourceType: "upload" | "directory" | "shopify" | "url" | "manual";
  sourceUrl: string;
  angleType: string;
  contextType: string;
  settingDescription: string;
  isHero: boolean;
  verticalRelevance: string;
};

const EMPTY_FORM: PhotoEditForm = {
  productId: "",
  assetStatus: "needs_review",
  rightsStatus: "unknown",
  usageRestrictions: "",
  useCases: "",
  altText: "",
  caption: "",
  notes: "",
  sourceType: "upload",
  sourceUrl: "",
  angleType: "",
  contextType: "",
  settingDescription: "",
  isHero: false,
  verticalRelevance: "",
};

function joinValues(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

function splitValues(value: string): string[] | null {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

function photoUrl(kind: "thumb" | "serve", photoId: string): string {
  const companyId = getActiveCompanyId();
  const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  return `/api/blog/photos/${kind}/${photoId}${query}`;
}

export default function PhotoBank() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: photos = [], isLoading } = usePhotos();
  const { data: products = [] } = useProducts();
  const { data: stats } = usePhotoStats();
  const uploadMutation = useUploadPhotos();
  const associateMutation = useAutoAssociate();
  const updateMutation = useUpdatePhoto();
  const deleteMutation = useDeletePhoto();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [uploadProductId, setUploadProductId] = useState("");
  const [editingPhoto, setEditingPhoto] = useState<any | null>(null);
  const [form, setForm] = useState<PhotoEditForm>(EMPTY_FORM);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");

  const productById = useMemo(() => {
    return new Map(products.map((product: any) => [product.id, product]));
  }, [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return photos.filter((photo: any) => {
      if (filter === "needs_review" && photo.assetStatus !== "needs_review") return false;
      if (filter === "approved" && photo.assetStatus !== "approved") return false;
      if (filter === "restricted" && photo.rightsStatus !== "restricted") return false;
      if (filter === "unassigned" && photo.productId) return false;
      if (filter === "unanalyzed" && photo.analyzedAt) return false;
      if (!term) return true;
      const productTitle = productById.get(photo.productId)?.title || "";
      return [
        photo.originalFilename,
        photo.caption,
        photo.altText,
        photo.settingDescription,
        productTitle,
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [filter, photos, productById, search]);

  const openEditor = (photo: any) => {
    setEditingPhoto(photo);
    setForm({
      productId: photo.productId || "",
      assetStatus: photo.assetStatus || "needs_review",
      rightsStatus: photo.rightsStatus || "unknown",
      usageRestrictions: photo.usageRestrictions || "",
      useCases: joinValues(photo.useCases),
      altText: photo.altText || "",
      caption: photo.caption || "",
      notes: photo.notes || "",
      sourceType: photo.sourceType || "upload",
      sourceUrl: photo.sourceUrl || "",
      angleType: photo.angleType || "",
      contextType: photo.contextType || "",
      settingDescription: photo.settingDescription || "",
      isHero: Boolean(photo.isHero),
      verticalRelevance: joinValues(photo.verticalRelevance),
    });
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    try {
      const result = await uploadMutation.mutateAsync({
        files,
        productId: uploadProductId || undefined,
      });
      toast({ title: "Photos uploaded", description: result.message });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleBatchAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeStatus("Starting vision analysis...");
    try {
      const res = await fetch("/api/blog/photos/batch-analyze", {
        method: "POST",
        headers: getRequiredCompanyScopedHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ limit: 50 }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No analysis stream returned");
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
      toast({ title: "Analysis complete" });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/photos"),
      });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/products"),
      });
      setAnalyzing(false);
      setAnalyzeStatus("");
    }
  };

  const handleAutoAssociate = async () => {
    try {
      const result = await associateMutation.mutateAsync();
      toast({ title: "Auto-associate complete", description: result.message });
    } catch (err: any) {
      toast({ title: "Association failed", description: err.message, variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!editingPhoto) return;
    const updates: PhotoMetadataUpdate = {
      productId: form.productId || null,
      assetStatus: form.assetStatus,
      rightsStatus: form.rightsStatus,
      usageRestrictions: form.usageRestrictions || null,
      useCases: splitValues(form.useCases),
      altText: form.altText || null,
      caption: form.caption || null,
      notes: form.notes || null,
      sourceType: form.sourceType,
      sourceUrl: form.sourceUrl || null,
      angleType: form.angleType || null,
      contextType: form.contextType || null,
      settingDescription: form.settingDescription || null,
      isHero: form.isHero,
      verticalRelevance: splitValues(form.verticalRelevance),
    };
    try {
      await updateMutation.mutateAsync({ id: editingPhoto.id, updates });
      toast({ title: "Asset updated" });
      setEditingPhoto(null);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
  };

  const filterCounts: Record<Filter, number> = {
    all: photos.length,
    needs_review: stats?.needsReview || photos.filter((photo: any) => photo.assetStatus === "needs_review").length,
    approved: stats?.approved || photos.filter((photo: any) => photo.assetStatus === "approved").length,
    unassigned: stats?.unassigned || photos.filter((photo: any) => !photo.productId).length,
    restricted: stats?.restricted || photos.filter((photo: any) => photo.rightsStatus === "restricted").length,
    unanalyzed: stats?.unanalyzed || photos.filter((photo: any) => !photo.analyzedAt).length,
  };

  return (
    <main className="space-y-5 p-4 lg:p-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Asset Bank</h1>
          </div>
          {stats && (
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>{stats.total} assets</span>
              <span>{stats.analyzed} analyzed</span>
              <span>{stats.unassigned} unassigned</span>
              <span>{stats.restricted} restricted</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
          <Select value={uploadProductId || "__none"} onValueChange={(value) => setUploadProductId(value === "__none" ? "" : value)}>
            <SelectTrigger className="w-full sm:w-[260px]" aria-label="Assign uploaded photos to product">
              <SelectValue placeholder="Assign uploads to product" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Unassigned uploads</SelectItem>
              {products.map((product: any) => (
                <SelectItem key={product.id} value={product.id}>{product.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
            <ImagePlus className="h-4 w-4" />
            Upload
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleAutoAssociate} disabled={associateMutation.isPending}>
            <Wand2 className="h-4 w-4" />
            {associateMutation.isPending ? "Associating" : "Auto-Tag"}
          </Button>
          <Button className="gap-2" onClick={handleBatchAnalyze} disabled={analyzing || (stats?.unanalyzed || 0) === 0}>
            <Sparkles className="h-4 w-4" />
            {analyzing ? analyzeStatus || "Analyzing" : `Analyze ${stats?.unanalyzed || 0}`}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search assets" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "needs_review", "approved", "unassigned", "restricted", "unanalyzed"] as Filter[]).map((item) => (
            <Button
              key={item}
              variant={filter === item ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-2"
              onClick={() => setFilter(item)}
            >
              <span className="capitalize">{item.replace("_", " ")}</span>
              <Badge variant="outline" className="px-1.5">{filterCounts[item]}</Badge>
            </Button>
          ))}
        </div>
      </section>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading assets...</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No assets found.</div>
      ) : (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {filtered.slice(0, 180).map((photo: any) => {
            const product = productById.get(photo.productId);
            return (
              <Card key={photo.id} className="group overflow-hidden">
                <button className="block w-full text-left" onClick={() => openEditor(photo)}>
                  <div className="relative aspect-square bg-muted">
                    <img
                      src={photoUrl("thumb", photo.id)}
                      alt={photo.altText || photo.originalFilename}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = photoUrl("serve", photo.id);
                      }}
                    />
                    <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                      {photo.isHero && <Badge className="px-1.5 py-0 text-[10px]">Hero</Badge>}
                      {photo.assetStatus === "approved" && (
                        <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                          <CheckCircle2 className="h-3 w-3" />
                          Approved
                        </Badge>
                      )}
                      {photo.rightsStatus === "restricted" && <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">Restricted</Badge>}
                    </div>
                    <div className="absolute bottom-2 right-2 rounded-md bg-background/90 px-1.5 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                      <Edit3 className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </button>
                <CardContent className="space-y-2 p-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{photo.caption || photo.originalFilename}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{product?.title || "Unassigned"}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {photo.contextType && <Badge variant="outline" className="px-1 py-0 text-[10px]">{photo.contextType}</Badge>}
                    {photo.qualityScore && <Badge variant="outline" className="px-1 py-0 text-[10px]">{(photo.qualityScore * 100).toFixed(0)}%</Badge>}
                    {!photo.analyzedAt && <Badge variant="outline" className="px-1 py-0 text-[10px] text-orange-600">Not analyzed</Badge>}
                    {!photo.productId && <Badge variant="outline" className="px-1 py-0 text-[10px] text-blue-600">Unassigned</Badge>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Button variant="ghost" size="sm" className="h-7 flex-1 gap-1 px-2 text-xs" onClick={() => openEditor(photo)}>
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      aria-label={`Delete ${photo.originalFilename}`}
                      onClick={() => deleteMutation.mutate(photo.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {filtered.length > 180 && (
        <p className="text-center text-sm text-muted-foreground">Showing 180 of {filtered.length} assets</p>
      )}

      <Dialog open={Boolean(editingPhoto)} onOpenChange={(open) => !open && setEditingPhoto(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Asset</DialogTitle>
          </DialogHeader>
          {editingPhoto && (
            <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
              <div className="space-y-3">
                <div className="overflow-hidden rounded-md border bg-muted">
                  <img
                    src={photoUrl("serve", editingPhoto.id)}
                    alt={form.altText || editingPhoto.originalFilename}
                    className="max-h-[360px] w-full object-contain"
                  />
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="break-all font-medium text-foreground">{editingPhoto.originalFilename}</p>
                  <p>{editingPhoto.width || 0} x {editingPhoto.height || 0}px</p>
                  {editingPhoto.qualityScore && <p>Quality {(editingPhoto.qualityScore * 100).toFixed(0)}%</p>}
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Product</Label>
                    <Select value={form.productId || "__none"} onValueChange={(value) => setForm((prev) => ({ ...prev, productId: value === "__none" ? "" : value }))}>
                      <SelectTrigger aria-label="Asset product"><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Unassigned</SelectItem>
                        {products.map((product: any) => (
                          <SelectItem key={product.id} value={product.id}>{product.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={form.assetStatus} onValueChange={(value: PhotoEditForm["assetStatus"]) => setForm((prev) => ({ ...prev, assetStatus: value }))}>
                      <SelectTrigger aria-label="Asset status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="needs_review">Needs review</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Rights</Label>
                    <Select value={form.rightsStatus} onValueChange={(value: PhotoEditForm["rightsStatus"]) => setForm((prev) => ({ ...prev, rightsStatus: value }))}>
                      <SelectTrigger aria-label="Asset rights status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unknown">Unknown</SelectItem>
                        <SelectItem value="owned">Owned</SelectItem>
                        <SelectItem value="licensed">Licensed</SelectItem>
                        <SelectItem value="restricted">Restricted</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Source</Label>
                    <Select value={form.sourceType} onValueChange={(value: PhotoEditForm["sourceType"]) => setForm((prev) => ({ ...prev, sourceType: value }))}>
                      <SelectTrigger aria-label="Asset source"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upload">Upload</SelectItem>
                        <SelectItem value="directory">Directory</SelectItem>
                        <SelectItem value="shopify">Shopify</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <Label>Hero Candidate</Label>
                    <p className="text-xs text-muted-foreground">Available for article hero image selection.</p>
                  </div>
                  <ToggleSwitch checked={form.isHero} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isHero: checked }))} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Angle</Label>
                    <Input aria-label="Asset angle" value={form.angleType} onChange={(event) => setForm((prev) => ({ ...prev, angleType: event.target.value }))} placeholder="front, detail, in-use" />
                  </div>
                  <div className="space-y-2">
                    <Label>Context</Label>
                    <Input aria-label="Asset context" value={form.contextType} onChange={(event) => setForm((prev) => ({ ...prev, contextType: event.target.value }))} placeholder="studio, lifestyle, technical" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Setting</Label>
                  <Input aria-label="Asset setting" value={form.settingDescription} onChange={(event) => setForm((prev) => ({ ...prev, settingDescription: event.target.value }))} placeholder="In use at a customer workstation" />
                </div>
                <div className="space-y-2">
                  <Label>Use Cases</Label>
                  <Input aria-label="Asset use cases" value={form.useCases} onChange={(event) => setForm((prev) => ({ ...prev, useCases: event.target.value }))} placeholder="setup, maintenance, product detail" />
                </div>
                <div className="space-y-2">
                  <Label>Vertical Tags</Label>
                  <Input aria-label="Asset vertical tags" value={form.verticalRelevance} onChange={(event) => setForm((prev) => ({ ...prev, verticalRelevance: event.target.value }))} placeholder="primary-market, buyer-segment" />
                </div>
                <div className="space-y-2">
                  <Label>Alt Text</Label>
                  <Input aria-label="Asset alt text" value={form.altText} onChange={(event) => setForm((prev) => ({ ...prev, altText: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Caption</Label>
                  <Input aria-label="Asset caption" value={form.caption} onChange={(event) => setForm((prev) => ({ ...prev, caption: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Rights Restrictions</Label>
                  <Textarea aria-label="Asset rights restrictions" value={form.usageRestrictions} onChange={(event) => setForm((prev) => ({ ...prev, usageRestrictions: event.target.value }))} rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>Source URL</Label>
                  <Input aria-label="Asset source URL" value={form.sourceUrl} onChange={(event) => setForm((prev) => ({ ...prev, sourceUrl: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea aria-label="Asset notes" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} rows={3} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPhoto(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving" : "Save Asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
