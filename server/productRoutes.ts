// Product management API routes
// Scraping, listing, and vertical mapping for iboltmounts.com products.

import { Router, type Request, type Response } from "express";
import { scrapeProducts, mapProductsToVerticals, getProducts, getProductStats } from "./productScraper";

export function registerProductRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  // POST /api/blog/products/scrape — Scrape iboltmounts.com product catalog
  router.post("/scrape", async (_req: Request, res: Response) => {
    try {
      const result = await scrapeProducts();
      res.json({
        message: `Scraped ${result.total} products (${result.new_} new, ${result.updated} updated)`,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/products/map-verticals — AI-map products to verticals
  router.post("/map-verticals", async (_req: Request, res: Response) => {
    try {
      const result = await mapProductsToVerticals();
      res.json({
        message: `Created ${result.mapped} product-vertical mappings`,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/products — List all products
  router.get("/", async (req: Request, res: Response) => {
    try {
      const verticalId = req.query.verticalId as string | undefined;
      const prods = await getProducts(verticalId);
      res.json(prods);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/products/stats — Product count and last scrape time
  router.get("/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await getProductStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/products", router);
}
