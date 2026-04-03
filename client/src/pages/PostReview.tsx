import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useBlogPost, useUpdateBlogPost } from "@/hooks/useBlogPosts";
import { usePublishToShopify, useShopifyStatus, useShopifyBlogs } from "@/hooks/useShopifyPublish";

export default function PostReview() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: post, isLoading } = useBlogPost(params.id || "");
  const updateMutation = useUpdateBlogPost();
  const publishMutation = usePublishToShopify();
  const { data: shopifyStatus, isLoading: statusLoading } = useShopifyStatus(params.id || "");
  const { data: shopifyBlogsData } = useShopifyBlogs();
  const [tab, setTab] = useState<"preview" | "markdown" | "html">("preview");
  const [editedMarkdown, setEditedMarkdown] = useState<string | null>(null);
  const [selectedBlogId, setSelectedBlogId] = useState<number | undefined>(undefined);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!post) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Post not found</div>;

  const markdown = editedMarkdown ?? post.markdown ?? "";
  const notes = post.verificationNotes ? JSON.parse(post.verificationNotes) : null;

  const handleApprove = async () => {
    try {
      await updateMutation.mutateAsync({ id: post.id, status: "approved" });
      toast({ title: "Post Approved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleSaveEdits = async () => {
    if (editedMarkdown === null) return;
    try {
      await updateMutation.mutateAsync({ id: post.id, markdown: editedMarkdown });
      setEditedMarkdown(null);
      toast({ title: "Changes Saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleCopyHtml = () => {
    window.open(`/api/blog/posts/${post.id}/html`, "_blank");
  };

  const handlePublishToShopify = async () => {
    try {
      const result = await publishMutation.mutateAsync({
        postId: post.id,
        blogId: selectedBlogId,
      });
      if (result.success) {
        toast({
          title: `${result.action === "created" ? "Published" : "Updated"} on Shopify`,
          description: `Article #${result.shopifyArticleId} ${result.action} as draft`,
        });
      } else {
        toast({
          title: "Shopify Publish Failed",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Shopify Publish Error",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold truncate max-w-md">{post.title}</h1>
            <Badge variant={post.status === "review" ? "default" : post.status === "approved" ? "secondary" : "outline"}>
              {post.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {editedMarkdown !== null && (
              <Button variant="outline" size="sm" onClick={handleSaveEdits} disabled={updateMutation.isPending}>Save Edits</Button>
            )}
            <Button variant="outline" size="sm" onClick={handleCopyHtml}>View HTML</Button>
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/blog/posts/${post.id}/preview`, "_blank")}>Preview</Button>
            {post.status !== "approved" && (
              <Button size="sm" onClick={handleApprove} disabled={updateMutation.isPending}>Approve</Button>
            )}
            <Button
              size="sm"
              variant={shopifyStatus?.isSynced ? "outline" : "default"}
              onClick={handlePublishToShopify}
              disabled={publishMutation.isPending || (!post.markdown && !post.html)}
            >
              {publishMutation.isPending
                ? "Publishing..."
                : shopifyStatus?.isSynced
                ? "Re-sync to Shopify"
                : "Publish to Shopify"}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-4">
        {/* SEO meta */}
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Meta Title: </span>
                <span className="font-medium">{post.metaTitle}</span>
                <span className="text-xs text-muted-foreground ml-2">({post.metaTitle?.length || 0} chars)</span>
              </div>
              <div>
                <span className="text-muted-foreground">Slug: </span>
                <span className="font-mono text-xs">/{post.slug}</span>
              </div>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Meta Description: </span>
              <span>{post.metaDescription}</span>
              <span className="text-xs text-muted-foreground ml-2">({post.metaDescription?.length || 0} chars)</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Word Count: </span>
              <span className="font-medium">{post.wordCount}</span>
            </div>
          </CardContent>
        </Card>

        {/* Shopify sync status + blog selector */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-3">
              Shopify Integration
              {statusLoading ? (
                <Badge variant="outline">Loading...</Badge>
              ) : shopifyStatus?.isSynced ? (
                <Badge variant="secondary">Synced</Badge>
              ) : (
                <Badge variant="outline">Not synced</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm text-muted-foreground block mb-1">Target Blog</label>
                <select
                  className="w-full border rounded-md px-3 py-1.5 text-sm bg-background"
                  value={selectedBlogId || ""}
                  onChange={(e) => setSelectedBlogId(e.target.value ? Number(e.target.value) : undefined)}
                >
                  <option value="">Default (News)</option>
                  {shopifyBlogsData?.blogs?.map((blog) => (
                    <option key={blog.id} value={blog.id}>
                      {blog.title}
                    </option>
                  ))}
                </select>
              </div>
              {shopifyStatus?.isSynced && (
                <div className="flex-1 text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Article ID: </span>
                    <span className="font-mono">{shopifyStatus.shopifyArticleId}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    <Badge variant={shopifyStatus.shopifyStatus === "published" ? "default" : "outline"} className="text-xs">
                      {shopifyStatus.shopifyStatus || "unknown"}
                    </Badge>
                  </div>
                  {shopifyStatus.shopifySyncedAt && (
                    <div>
                      <span className="text-muted-foreground">Last synced: </span>
                      <span className="text-xs">{new Date(shopifyStatus.shopifySyncedAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Verification scores */}
        {post.overallScore && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-3">
                Verification Scores
                <span className={`text-2xl font-bold ${post.overallScore >= 70 ? "text-green-500" : "text-orange-500"}`}>
                  {post.overallScore}/100
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Brand Consistency", value: post.brandConsistency },
                { label: "SEO Optimization", value: post.seoOptimization },
                { label: "Natural Language", value: post.naturalLanguage },
                { label: "Factual Accuracy", value: post.factualAccuracy },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-sm w-40">{label}</span>
                  <Progress value={value || 0} className="flex-1" />
                  <span className="text-sm font-mono w-8 text-right">{value}</span>
                </div>
              ))}

              {notes?.issues?.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Issues:</p>
                  <ul className="text-xs space-y-1">
                    {notes.issues.map((issue: string, i: number) => (
                      <li key={i} className="text-orange-600">- {issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {notes?.suggestions?.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Suggestions:</p>
                  <ul className="text-xs space-y-1">
                    {notes.suggestions.map((sug: string, i: number) => (
                      <li key={i} className="text-blue-600">- {sug}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Content tabs */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          {(["preview", "markdown", "html"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === t ? "bg-background shadow font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "preview" && (
          <Card>
            <CardContent className="pt-6 prose prose-sm max-w-none dark:prose-invert">
              <div dangerouslySetInnerHTML={{ __html: post.html || "<p>No HTML rendered yet.</p>" }} />
            </CardContent>
          </Card>
        )}

        {tab === "markdown" && (
          <Card>
            <CardContent className="pt-4">
              <textarea
                className="w-full min-h-[600px] font-mono text-sm bg-transparent border rounded-lg p-4 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                value={markdown}
                onChange={(e) => setEditedMarkdown(e.target.value)}
              />
            </CardContent>
          </Card>
        )}

        {tab === "html" && (
          <Card>
            <CardContent className="pt-4">
              <pre className="text-xs font-mono bg-muted p-4 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-[600px] overflow-y-auto">
                {post.html || "No HTML rendered yet."}
              </pre>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
