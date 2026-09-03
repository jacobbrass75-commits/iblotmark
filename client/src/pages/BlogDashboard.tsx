import { useLocation } from "wouter";
import { ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBlogPosts } from "@/hooks/useBlogPosts";
import { useShopifyArticles } from "@/hooks/useShopifyPublish";
import { useClusters } from "@/hooks/useKeywords";
import { useVerticals } from "@/hooks/useVerticals";
import { companyScopedUrl } from "@/lib/company";

export default function BlogDashboard() {
  const [, setLocation] = useLocation();
  const { data: posts = [] } = useBlogPosts();
  const { data: shopifyArticlesData } = useShopifyArticles();
  const { data: companyContext } = useQuery<any>({
    queryKey: [companyScopedUrl("/api/blog/company/context")],
  });
  const { data: clusters = [] } = useClusters();
  const { data: verticals = [] } = useVerticals();

  const reviewPosts = posts.filter((p: any) => p.status === "review");
  const liveShopifyPosts = (shopifyArticlesData?.articles || [])
    .filter((article) => article.published_at || article.published)
    .slice(0, 10);
  const shopifyIntegration = companyContext?.integrations?.shopify;
  const storeUrl = String(
    shopifyIntegration?.publicStoreUrl
      || companyContext?.brandProfile?.websiteUrl
      || companyContext?.company?.websiteUrl
      || (shopifyIntegration?.shop ? `https://${shopifyIntegration.shop}.myshopify.com` : ""),
  ).replace(/\/$/, "");
  const defaultBlogId = shopifyIntegration?.defaultBlogId;
  const blogHandle = shopifyIntegration?.blogTargets?.find((target: any) => target.id === defaultBlogId)?.handle
    || shopifyIntegration?.blogTargets?.[0]?.handle
    || "news";
  const pendingClusters = clusters.filter((c: any) => c.status === "pending");
  const avgScore = posts.length > 0
    ? Math.round(posts.reduce((s: number, p: any) => s + (p.overallScore || 0), 0) / posts.length)
    : 0;

  return (
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Blog Dashboard</h1>
            <p className="text-sm text-muted-foreground">Generation, review, context, assets, and visibility</p>
          </div>
          <Badge variant="outline" className="w-fit text-xs">Pipeline v4</Badge>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold">{posts.length}</div>
              <div className="text-xs text-muted-foreground mt-1">Total Posts</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold">{reviewPosts.length}</div>
              <div className="text-xs text-muted-foreground mt-1">Ready for Review</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold">{pendingClusters.length}</div>
              <div className="text-xs text-muted-foreground mt-1">Clusters Pending</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold">{avgScore || "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">Avg Score</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold">{verticals.length}</div>
              <div className="text-xs text-muted-foreground mt-1">Context Banks</div>
            </CardContent>
          </Card>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Button className="h-auto py-3 flex flex-col gap-1" onClick={() => setLocation("/blog/generate")}>
            <span className="text-sm font-medium">Generate Posts</span>
            <span className="text-xs opacity-70">Batch generate</span>
          </Button>
          <Button variant="outline" className="h-auto py-3 flex flex-col gap-1" onClick={() => setLocation("/blog/keywords")}>
            <span className="text-sm font-medium">Keywords</span>
            <span className="text-xs opacity-70">Import & cluster</span>
          </Button>
          <Button variant="outline" className="h-auto py-3 flex flex-col gap-1" onClick={() => setLocation("/blog/context")}>
            <span className="text-sm font-medium">Context Banks</span>
            <span className="text-xs opacity-70">{verticals.length} verticals</span>
          </Button>
          <Button variant="outline" className="h-auto py-3 flex flex-col gap-1" onClick={() => setLocation("/blog/posts")}>
            <span className="text-sm font-medium">Posts</span>
            <span className="text-xs opacity-70">Review and publish</span>
          </Button>
          <Button variant="outline" className="h-auto py-3 flex flex-col gap-1" onClick={() => setLocation("/blog/photos")}>
            <span className="text-sm font-medium">Assets</span>
            <span className="text-xs opacity-70">Photos & media</span>
          </Button>
          <Button variant="outline" className="h-auto py-3 flex flex-col gap-1" onClick={() => setLocation("/blog/benchmark")}>
            <span className="text-sm font-medium">AI Visibility</span>
            <span className="text-xs opacity-70">Track answers</span>
          </Button>
        </div>

        {liveShopifyPosts.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Live on Shopify</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Latest posts confirmed by the connected store
                </p>
              </div>
              {storeUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a href={shopifyArticlesData?.blogUrl || `${storeUrl}/blogs/${blogHandle}`} target="_blank" rel="noreferrer">
                    View blog
                    <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {liveShopifyPosts.map((article) => {
                  const publicUrl = article.public_url
                    || (storeUrl && article.handle ? `${storeUrl}/blogs/${blogHandle}/${article.handle}` : "");
                  return (
                    <a
                      key={article.id}
                      href={publicUrl || undefined}
                      target={publicUrl ? "_blank" : undefined}
                      rel={publicUrl ? "noreferrer" : undefined}
                      className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${publicUrl ? "hover:bg-muted/50" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{article.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {article.published_at
                            ? `Published ${new Date(article.published_at).toLocaleDateString()}`
                            : "Published"}
                        </div>
                      </div>
                      <div className="ml-3 flex items-center gap-2">
                        <Badge variant="secondary">live</Badge>
                        {publicUrl && <ExternalLink className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </a>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent posts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Posts</CardTitle>
          </CardHeader>
          <CardContent>
            {posts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No posts generated yet. Go to Generate Posts to create your first batch.</p>
            ) : (
              <div className="space-y-2">
                {posts.slice(0, 10).map((post: any) => (
                  <div
                    key={post.id}
                    className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setLocation(`/blog/posts/${post.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{post.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {post.wordCount} words &middot; /{post.slug}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <Badge variant={post.status === "review" ? "default" : post.status === "approved" ? "secondary" : "outline"}>
                        {post.status}
                      </Badge>
                      {post.overallScore && (
                        <span className={`text-sm font-mono font-bold ${post.overallScore >= 70 ? "text-green-500" : "text-orange-500"}`}>
                          {post.overallScore}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Clusters overview */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Keyword Clusters</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog/keywords")}>View All</Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {clusters.slice(0, 8).map((cluster: any) => (
                <div key={cluster.id} className="flex items-center justify-between p-2 rounded border text-sm">
                  <div className="flex-1 min-w-0">
                    <span className="truncate block">{cluster.name}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-3 text-xs text-muted-foreground">
                    <span>{cluster.keywords?.length || 0} kws</span>
                    <span>vol: {cluster.totalVolume?.toLocaleString()}</span>
                    <Badge variant={cluster.status === "generated" ? "secondary" : "outline"} className="text-xs">
                      {cluster.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
  );
}
