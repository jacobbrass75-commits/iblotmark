import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBlogPosts } from "@/hooks/useBlogPosts";
import { useClusters } from "@/hooks/useKeywords";
import { useVerticals } from "@/hooks/useVerticals";
import { useProductStats } from "@/hooks/useProducts";

export default function BlogDashboard() {
  const [, setLocation] = useLocation();
  const { data: posts = [] } = useBlogPosts();
  const { data: clusters = [] } = useClusters();
  const { data: verticals = [] } = useVerticals();
  const { data: productStats } = useProductStats();

  const draftPosts = posts.filter((p: any) => p.status === "draft");
  const reviewPosts = posts.filter((p: any) => p.status === "review");
  const approvedPosts = posts.filter((p: any) => p.status === "approved");
  const pendingClusters = clusters.filter((c: any) => c.status === "pending");
  const avgScore = posts.length > 0
    ? Math.round(posts.reduce((s: number, p: any) => s + (p.overallScore || 0), 0) / posts.length)
    : 0;

  return (
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Blog Dashboard</h1>
            <p className="text-sm text-muted-foreground">Posts, products, context, assets, and visibility</p>
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
              <div className="text-3xl font-bold">{productStats?.count || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Products</div>
            </CardContent>
          </Card>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
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
          <Button variant="outline" className="h-auto py-3 flex flex-col gap-1" onClick={() => setLocation("/blog/products")}>
            <span className="text-sm font-medium">Products</span>
            <span className="text-xs opacity-70">{productStats?.count || 0} scraped</span>
          </Button>
          <Button variant="outline" className="h-auto py-3 flex flex-col gap-1" onClick={() => setLocation("/blog/catalog")}>
            <span className="text-sm font-medium">Catalog PDFs</span>
            <span className="text-xs opacity-70">Import specs</span>
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
