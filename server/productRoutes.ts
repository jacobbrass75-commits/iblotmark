// Product management API routes
// Scraping, listing, and vertical mapping for company product catalogs.

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { scrapeProducts, mapProductsToVerticals, getProducts, getProductStats } from "./productScraper";
import { importProductFromUrl, importProductsFromCSV, upsertProduct } from "./productImporter";
import {
  getLatestProductFeedAuditsByLane,
  listProductFeedAuditLanes,
  listProductFeedAudits,
  runProductFeedAudit,
} from "./productFeedAudit";
import { getCompanyIdFromRequest, requireBlogMutationRole } from "./companyContext";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export function registerProductRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();
  router.use(requireBlogMutationRole("editor"));

  // POST /api/blog/products/scrape — Scrape the configured public Shopify product catalog
  router.post("/scrape", async (req: Request, res: Response) => {
    try {
      const result = await scrapeProducts(getCompanyIdFromRequest(req));
      res.json({
        message: `Scraped ${result.total} products (${result.new_} new, ${result.updated} updated)`,
        ...result,
      });
    } catch (error: any) {
      const status = /private|local network|only http|credentials|too large|valid product url/i.test(error.message) ? 400 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  // POST /api/blog/products/map-verticals — AI-map products to verticals
  router.post("/map-verticals", async (req: Request, res: Response) => {
    try {
      const result = await mapProductsToVerticals(getCompanyIdFromRequest(req));
      res.json({
        message: `Created ${result.mapped} product-vertical mappings`,
        ...result,
      });
    } catch (error: any) {
      const status = /private|local network|only http|credentials|too large|valid product url/i.test(error.message) ? 400 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  // GET /api/blog/products — List all products
  router.get("/", async (req: Request, res: Response) => {
    try {
      const verticalId = req.query.verticalId as string | undefined;
      const prods = await getProducts(verticalId, getCompanyIdFromRequest(req));
      res.json(prods);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/products/stats — Product count and last scrape time
  router.get("/stats", async (req: Request, res: Response) => {
    try {
      const stats = await getProductStats(getCompanyIdFromRequest(req));
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/products/feed-audit/lanes - Default audit lanes and hero handles
  router.get("/feed-audit/lanes", async (req: Request, res: Response) => {
    try {
      res.json({ lanes: await listProductFeedAuditLanes(getCompanyIdFromRequest(req)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/products/feed-audit - List persisted product/feed audits
  router.get("/feed-audit", async (req: Request, res: Response) => {
    try {
      const lane = req.query.lane as string | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const audits = await listProductFeedAudits({ companyId: getCompanyIdFromRequest(req), lane, limit });
      res.json({ audits });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/products/feed-audit/latest - Latest audit for each default lane
  router.get("/feed-audit/latest", async (req: Request, res: Response) => {
    try {
      const latest = await getLatestProductFeedAuditsByLane(getCompanyIdFromRequest(req));
      res.json({ latest });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/products/feed-audit/run - Run audit for all default lanes, or one lane/handle
  router.post("/feed-audit/run", async (req: Request, res: Response) => {
    try {
      const audits = await runProductFeedAudit({
        companyId: getCompanyIdFromRequest(req),
        lane: typeof req.body?.lane === "string" ? req.body.lane : undefined,
        handle: typeof req.body?.handle === "string" ? req.body.handle : undefined,
      });
      res.json({ audits });
    } catch (error: any) {
      const status = error.message?.startsWith("Unknown product feed audit lane") ? 400 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  // POST /api/blog/products — Manually add a product
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { title, handle, description, productType, vendor, sku, price, url, imageUrl, tags, specs, compatibility, claims, disclaimers, availability } = req.body;
      if (!title) return res.status(400).json({ error: "title is required" });

      const { product, created } = await upsertProduct(getCompanyIdFromRequest(req), {
        title,
        handle,
        description: description || null,
        productType: productType || null,
        vendor: vendor || null,
        sku: sku || null,
        price: price || null,
        url: url || null,
        imageUrl: imageUrl || null,
        tags: Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[|;,]+/).map((tag) => tag.trim()).filter(Boolean) : [],
        specs: specs || null,
        compatibility: Array.isArray(compatibility) ? compatibility : [],
        claims: Array.isArray(claims) ? claims : [],
        disclaimers: Array.isArray(disclaimers) ? disclaimers : [],
        availability: availability || null,
        sourceType: "manual",
      });

      res.status(created ? 201 : 200).json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/import-csv", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const csvText = req.file?.buffer.toString("utf-8")
        || (typeof req.body?.csvText === "string" ? req.body.csvText : "");
      if (!csvText.trim()) return res.status(400).json({ error: "CSV file or csvText is required" });

      const result = await importProductsFromCSV(
        csvText,
        req.file?.originalname || "products.csv",
        getCompanyIdFromRequest(req),
      );
      res.json({
        message: `Imported ${result.new_} new products and updated ${result.updated}`,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/import-url", async (req: Request, res: Response) => {
    try {
      const url = typeof req.body?.url === "string" ? req.body.url : "";
      if (!url.trim()) return res.status(400).json({ error: "url is required" });

      const { product, created } = await importProductFromUrl(url, getCompanyIdFromRequest(req));
      res.status(created ? 201 : 200).json({
        message: created ? "Product imported from URL" : "Product updated from URL",
        created,
        product,
      });
    } catch (error: any) {
      const status = /private|local network|only http|credentials|too large|valid product url/i.test(error.message) ? 400 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  app.use("/api/blog/products", router);
}
