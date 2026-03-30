import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useProducts, useProductStats, useScrapeProducts, useMapVerticals } from "@/hooks/useProducts";
import { useVerticals } from "@/hooks/useVerticals";

export default function ProductCatalog() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: verticals = [] } = useVerticals();
  const [selectedVertical, setSelectedVertical] = useState("");
  const { data: products = [], isLoading } = useProducts(selectedVertical || undefined);
  const { data: stats } = useProductStats();
  const scrapeMutation = useScrapeProducts();
  const mapMutation = useMapVerticals();
  const [search, setSearch] = useState("");

  const handleScrape = async () => {
    try {
      const result = await scrapeMutation.mutateAsync();
      toast({ title: "Scrape Complete", description: result.message });
    } catch (err: any) {
      toast({ title: "Scrape Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleMap = async () => {
    try {
      const result = await mapMutation.mutateAsync();
      toast({ title: "Mapping Complete", description: result.message });
    } catch (err: any) {
      toast({ title: "Mapping Failed", description: err.message, variant: "destructive" });
    }
  };

  const filtered = search
    ? products.filter((p: any) => p.title.toLowerCase().includes(search.toLowerCase()) || p.handle.toLowerCase().includes(search.toLowerCase()))
    : products;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40 backdrop-blur">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <h1 className="text-lg font-bold">Product Catalog</h1>
            <span className="text-sm text-muted-foreground">{stats?.count || 0} products</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleScrape} disabled={scrapeMutation.isPending}>
              {scrapeMutation.isPending ? "Scraping..." : "Scrape Products"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleMap} disabled={mapMutation.isPending}>
              {mapMutation.isPending ? "Mapping..." : "Map to Verticals"}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-4">
        {/* Filters */}
        <div className="flex gap-3 items-center">
          <input
            type="text"
            placeholder="Search products..."
            className="flex-1 max-w-sm px-3 py-1.5 text-sm border rounded-lg bg-transparent focus:outline-none focus:ring-1 focus:ring-primary"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setSelectedVertical("")}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${!selectedVertical ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              All
            </button>
            {verticals.map((v: any) => (
              <button
                key={v.id}
                onClick={() => setSelectedVertical(v.id)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${selectedVertical === v.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>

        {/* Product grid */}
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No products found. {stats?.count === 0 && "Click 'Scrape Products' to fetch from iboltmounts.com."}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.slice(0, 60).map((product: any) => (
              <Card key={product.id} className="overflow-hidden">
                <CardContent className="pt-4">
                  <div className="flex gap-3">
                    {product.imageUrl && (
                      <img src={product.imageUrl} alt={product.title} className="w-16 h-16 object-cover rounded" loading="lazy" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm truncate">{product.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">/{product.handle}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {product.price && <span className="text-sm font-medium">${product.price}</span>}
                        {product.productType && <Badge variant="outline" className="text-xs">{product.productType}</Badge>}
                      </div>
                    </div>
                  </div>
                  {product.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(product.tags as string[]).slice(0, 5).map((tag: string) => (
                        <Badge key={tag} variant="outline" className="text-xs opacity-60">{tag}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {filtered.length > 60 && (
          <p className="text-center text-sm text-muted-foreground">Showing 60 of {filtered.length} products</p>
        )}
      </main>
    </div>
  );
}
