import { existsSync } from "fs";
import { Router, type Request, type Response } from "express";
import { getPhoto } from "./photoBank";
import { isPhotoPublishable } from "./photoAssetPolicy";
import { unsignedPublicPhotosAllowed, verifyPublicPhotoToken } from "./publicPhotoTokens";

function getPublicCompanyId(req: Request): string | null {
  const queryCompanyId = req.query.companyId;
  return typeof queryCompanyId === "string" && queryCompanyId ? queryCompanyId : null;
}

export function registerPublicPhotoRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  router.get("/serve/:id", async (req: Request, res: Response) => {
    try {
      const companyId = getPublicCompanyId(req);
      if (!companyId) return res.status(404).json({ error: "Photo not found" });
      if (!unsignedPublicPhotosAllowed() && !verifyPublicPhotoToken(companyId, req.params.id, "serve", req.query.token)) {
        return res.status(404).json({ error: "Photo not found" });
      }

      const photo = await getPhoto(req.params.id, companyId);
      if (!isPhotoPublishable(photo)) return res.status(404).json({ error: "Photo not found" });

      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(photo.filePath, { root: process.cwd() });
    } catch {
      res.status(404).json({ error: "Photo not found" });
    }
  });

  router.get("/thumb/:id", async (req: Request, res: Response) => {
    try {
      const companyId = getPublicCompanyId(req);
      if (!companyId) return res.status(404).json({ error: "Photo not found" });
      if (!unsignedPublicPhotosAllowed() && !verifyPublicPhotoToken(companyId, req.params.id, "thumb", req.query.token)) {
        return res.status(404).json({ error: "Photo not found" });
      }

      const photo = await getPhoto(req.params.id, companyId);
      if (!isPhotoPublishable(photo)) return res.status(404).json({ error: "Photo not found" });

      const filePath = photo.thumbnailPath && existsSync(photo.thumbnailPath)
        ? photo.thumbnailPath
        : photo.filePath;
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(filePath, { root: process.cwd() });
    } catch {
      res.status(404).json({ error: "Photo not found" });
    }
  });

  app.use("/api/public/blog/photos", router);
}
