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

const app = express();
const httpServer = createServer(app);
app.set("trust proxy", true);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const ALWAYS_ALLOWED_ORIGINS = new Set([
  "https://claude.ai",
  "https://claude.com",
  "https://mcp.scholarmark.ai",
  "https://app.scholarmark.ai",
]);
const ALLOWED_ORIGIN_SET = new Set(allowedOrigins.map((origin) => normalizeOrigin(origin)));

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  if (origin.startsWith("chrome-extension://")) return true;
  if (/^https?:\/\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(origin)) return true;
  if (/^https?:\/\/89\\.167\\.10\\.34(:\\d+)?$/i.test(origin)) return true;
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

function summarizeApiResponse(path: string, body: unknown): string | null {
  if (typeof body === "undefined") return null;

  if ((path === "/api/documents" || path === "/api/documents/meta") && Array.isArray(body)) {
    return `items=${body.length}`;
  }

  try {
    const serialized = JSON.stringify(body);
    if (!serialized) return null;
    const maxLength = 2000;
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return `${serialized.slice(0, maxLength)}...<truncated ${serialized.length - maxLength} chars>`;
  } catch {
    return "[unserializable]";
  }
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
        const summary = summarizeApiResponse(path, capturedJsonResponse);
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
  registerOAuthRoutes(app);

  // Register auth routes before other routes
  registerAuthRoutes(app);

  await registerRoutes(httpServer, app);
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
