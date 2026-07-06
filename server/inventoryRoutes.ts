import { Router, type Request, type Response } from "express";
import {
  archiveInventoryBin,
  calculateInventoryCount,
  createInventoryBin,
  getInventoryBin,
  listInventoryBins,
  listInventoryCounts,
  lookupInventoryBin,
  updateInventoryBin,
} from "./inventoryManager";
import { getCompanyIdFromRequest, requireBlogMutationRole } from "./companyContext";

export function registerInventoryRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();
  router.use(requireBlogMutationRole("editor"));

  router.get("/bins", async (req: Request, res: Response) => {
    try {
      const bins = await listInventoryBins(getCompanyIdFromRequest(req), {
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        includeArchived: req.query.includeArchived === "true",
      });
      res.json(bins);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/bins", async (req: Request, res: Response) => {
    try {
      const bin = await createInventoryBin(getCompanyIdFromRequest(req), req.body || {});
      res.status(201).json(bin);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/bins/:id", async (req: Request, res: Response) => {
    try {
      const bin = await getInventoryBin(getCompanyIdFromRequest(req), req.params.id);
      res.json(bin);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  });

  router.patch("/bins/:id", async (req: Request, res: Response) => {
    try {
      const bin = await updateInventoryBin(getCompanyIdFromRequest(req), req.params.id, req.body || {});
      res.json(bin);
    } catch (error: any) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  router.delete("/bins/:id", async (req: Request, res: Response) => {
    try {
      const bin = await archiveInventoryBin(getCompanyIdFromRequest(req), req.params.id);
      res.json(bin);
    } catch (error: any) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  router.get("/lookup", async (req: Request, res: Response) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const bin = await lookupInventoryBin(getCompanyIdFromRequest(req), code);
      res.json(bin);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  });

  router.post("/calculate", async (req: Request, res: Response) => {
    try {
      const result = await calculateInventoryCount(getCompanyIdFromRequest(req), req.body || {});
      res.json(result);
    } catch (error: any) {
      const status = /not found|No inventory bin/i.test(error.message) ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  router.get("/counts", async (req: Request, res: Response) => {
    try {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const counts = await listInventoryCounts(getCompanyIdFromRequest(req), limit);
      res.json(counts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/inventory", router);
}
