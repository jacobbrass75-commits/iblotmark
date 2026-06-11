// Load environment variables first
import "dotenv/config";

import cors from "cors";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { registerAuthRoutes } from "./authRoutes";
import { registerOAuthRoutes } from "./oauthRoutes";
import { configureClerk } from "./auth";
import { serveStatic } from "./static";
import { initAnalytics } from "./analyticsLogger";
import { createServer } from "http";
import { envEnabled, isProduction, legacyScholarMarkEnabled, validateProductionConfig } from "./runtimeConfig";
import { startPersistedSchedulers } from "./scheduler";
import { validateBlogTenantIntegrity } from "./db";
import { summarizeApiResponseForLog } from "./responseLogRedaction";

validateProductionConfig();
if (process.env.NODE_ENV === "production") {
  validateBlogTenantIntegrity();
}

const app = express();
const httpServer = createServer(app);
app.set("trust proxy", true);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const configuredAppOrigins = [
  process.env.PUBLIC_BASE_URL,
  process.env.APP_BASE_URL,
  process.env.PUBLIC_APP_URL,
]
  .map((origin) => (origin || "").trim())
  .filter(Boolean);

const alwaysAllowedOrigins = isProduction()
  ? [...configuredAppOrigins]
  : [
      ...configuredAppOrigins,
      "https://claude.ai",
      "https://claude.com",
    ];

if (legacyScholarMarkEnabled()) {
  alwaysAllowedOrigins.push("https://mcp.scholarmark.ai", "https://app.scholarmark.ai");
}

const ALWAYS_ALLOWED_ORIGINS = new Set(alwaysAllowedOrigins);
const ALLOWED_ORIGIN_SET = new Set(allowedOrigins.map((origin) => normalizeOrigin(origin)));

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  if (origin.startsWith("chrome-extension://")) return !isProduction() || envEnabled("ALLOW_CHROME_EXTENSION_ORIGINS");
  if (/^https?:\/\/(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:\\d+)?$/i.test(origin)) return !isProduction();
  if (/^https?:\/\/89\\.167\\.10\\.34(:\\d+)?$/i.test(origin)) return !isProduction();
  if (ALWAYS_ALLOWED_ORIGINS.has(normalizedOrigin)) return true;
  if (ALLOWED_ORIGIN_SET.has(normalizedOrigin)) return true;
  return false;
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Reject malformed percent-encoding before Express route matching can throw.
app.use((req, res, next) => {
  try {
    decodeURIComponent(req.url);
    next();
  } catch {
    log(`Malformed URI sequence in request URL: ${req.url}`);
    res.status(400).json({ message: "Malformed URI sequence" });
  }
});

// Initialize Clerk authentication
configureClerk(app);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const summary = summarizeApiResponseForLog(path, capturedJsonResponse, { isProduction: isProduction() });
        if (summary) {
          logLine += ` :: ${summary}`;
        }
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  if (legacyScholarMarkEnabled()) {
    registerOAuthRoutes(app);
  }

  // Register auth routes before other routes
  registerAuthRoutes(app);

  await registerRoutes(httpServer, app);
  const restoredSchedulers = await startPersistedSchedulers();
  if (restoredSchedulers > 0) {
    log(`restored ${restoredSchedulers} persisted blog scheduler(s)`, "scheduler");
  }
  initAnalytics();

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (err instanceof URIError || message.includes("Failed to decode param")) {
      log(`Malformed URI sequence in request URL: ${req.originalUrl}`);
      return res.status(400).json({ message: "Malformed URI sequence" });
    }

    if (status >= 500) {
      console.error(err);
    }

    return res.status(status).json({ message });
  });

  app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({
      message: "API route not found",
      path: req.originalUrl,
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Default to 5001 if not specified (different from ScholarMark's 5000).
  const port = parseInt(process.env.PORT || "5001", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`Open http://localhost:${port} in your browser`);
  });
})();
