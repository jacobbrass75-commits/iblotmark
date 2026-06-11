import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ExternalLink, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useBlogPosts } from "@/hooks/useBlogPosts";

const statuses = ["all", "draft", "review", "approved", "published"];

export default function BlogPosts() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const { data: posts = [], isLoading } = useBlogPosts(status === "all" ? undefined : status);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return posts;
    return posts.filter((post: any) =>
      [post.title, post.slug, post.metaTitle, post.metaDescription]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [posts, search]);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
          <p className="text-sm text-muted-foreground">Review, approve, export, and publish generated content.</p>
        </div>
        <Button onClick={() => setLocation("/blog/generate")}>Generate Posts</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content Library</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search posts" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              {statuses.map((item) => (
                <Button key={item} size="sm" variant={status === item ? "secondary" : "outline"} onClick={() => setStatus(item)}>
                  {item[0].toUpperCase() + item.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading posts...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No posts match this view.</div>
          ) : (
            <div className="divide-y rounded-md border">
              {filtered.map((post: any) => (
                <button
                  key={post.id}
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/50"
                  onClick={() => setLocation(`/blog/posts/${post.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{post.title}</div>
                    <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.metaDescription || post.slug}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">{post.status}</Badge>
                      {post.overallScore !== null && post.overallScore !== undefined && <Badge variant="secondary">{post.overallScore}/100</Badge>}
                      {post.wordCount ? <Badge variant="outline">{post.wordCount} words</Badge> : null}
                      {post.shopifyArticleId ? <Badge variant="secondary">Shopify synced</Badge> : null}
                    </div>
                  </div>
                  <ExternalLink className="mt-1 h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
