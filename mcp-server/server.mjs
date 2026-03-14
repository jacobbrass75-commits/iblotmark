import express from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { buildProtectedResourceMetadata } from "./dist/discovery.js";
import { registerScholarMarkTools } from "./dist/mcp-tools.js";

const app = express();
const port = Number(process.env.MCP_SERVER_PORT ?? 5002);
const backendBaseUrl = process.env.SCHOLARMARK_BACKEND_URL ?? "http://127.0.0.1:5001";
const MCP_SCOPE_CHALLENGE = "read write";

const mcpSessions = new Map();
const sseSessions = new Map();

setInterval(() => {
  if (mcpSessions.size > 0 || sseSessions.size > 0) {
    console.log(`[SESSION] Active: streamable=${mcpSessions.size}, sse=${sseSessions.size}`);
  }
}, 10 * 60 * 1000);

function attachAuthInfo(req) {
  const authHeader = typeof req.headers.authorization === "string"
    ? req.headers.authorization
    : "";
  const match = authHeader.match(/^bearer\s+(.+)$/i);
  if (!match) {
    return;
  }
  const token = match[1]?.trim();
  if (!token) {
    return;
  }
  console.log("[AUTH] Bearer token, prefix:", token.substring(0, 12));
  req.auth = {
    token,
    clientId: "mcp-passthrough",
    scopes: ["read", "write"],
  };
}

function createMcpServer() {
  const server = new McpServer({ name: "ScholarMark", version: "1.0.0" });
  registerScholarMarkTools(server, { backendBaseUrl });
  return server;
}

function ensurePostAccept(req) {
  const current = typeof req.headers.accept === "string" ? req.headers.accept.toLowerCase() : "";
  if (current.includes("application/json") && current.includes("text/event-stream")) {
    return;
  }
  req.headers.accept = "application/json, text/event-stream";
}

function accepts(req, mimeType) {
  const current = typeof req.headers.accept === "string" ? req.headers.accept : "";
  return current.toLowerCase().includes(mimeType.toLowerCase());
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "scholarmark-mcp-server" });
});

function sendServiceInfo(res) {
  res.status(200).json({
    service: "ScholarMark MCP Server",
    endpoints: ["/mcp", "/.well-known/oauth-protected-resource", "/healthz"],
  });
}

app.get("/", (_req, res) => sendServiceInfo(res));

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.status(200).json(buildProtectedResourceMetadata(req));
});
app.get("/.well-known/oauth-protected-resource/mcp", (req, res) => {
  res.status(200).json(buildProtectedResourceMetadata(req));
});

function getResourceMetadataUrl(req) {
  const host = req.headers.host ?? `localhost:${port}`;
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  return `${proto}://${host}/.well-known/oauth-protected-resource/mcp`;
}

function sendAuthChallenge(req, res, options = {}) {
  const resourceUrl = getResourceMetadataUrl(req);
  const hasAuthHeader = typeof req.headers.authorization === "string"
    && req.headers.authorization.trim().length > 0;
  const error = options.error ?? (hasAuthHeader ? "invalid_token" : null);
  const description = options.description ?? "Authorization required.";
  const challengeParts = [
    'Bearer realm="ScholarMark MCP"',
    `resource_metadata="${resourceUrl}"`,
    `scope="${MCP_SCOPE_CHALLENGE}"`,
  ];

  if (error) {
    challengeParts.push(`error="${error}"`);
    challengeParts.push(`error_description="${description}"`);
  }

  res.status(401)
    .set("Cache-Control", "no-store")
    .set("WWW-Authenticate", challengeParts.join(", "))
    .json({
      error: error ?? "unauthorized",
      error_description: description,
    });
}

async function handleStreamableMcpRequest(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.status(204)
        .set("Allow", "GET, POST, DELETE, OPTIONS, HEAD")
        .set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, HEAD")
        .set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id")
        .set("Access-Control-Expose-Headers", "Mcp-Session-Id")
        .set("Access-Control-Max-Age", "86400")
        .end();
      return;
    }

    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }

    if (req.method === "GET" && !accepts(req, "text/event-stream")) {
      sendServiceInfo(res);
      return;
    }

    if (req.method === "POST") {
      ensurePostAccept(req);
    }

    const sessionHeader = req.headers["mcp-session-id"];
    const bodyMethod = req.body?.method;

    console.log(
      `[MCP] ${req.method} /mcp`
      + ` | auth=${!!req.headers.authorization}`
      + ` | session=${(sessionHeader ?? "none").substring(0, 8)}`
      + ` | method=${bodyMethod ?? "-"}`
      + ` | accept=${(req.headers.accept ?? "").substring(0, 60)}`
      + ` | ua=${(req.headers["user-agent"] ?? "").substring(0, 50)}`
    );

    attachAuthInfo(req);

    // Use per-server auth so the MCP host starts OAuth before attempting
    // initialize/tools/list on an unauthenticated session.
    if (!req.auth) {
      console.log("[AUTH] 401 for method:", bodyMethod ?? req.method);
      sendAuthChallenge(req, res);
      return;
    }

    if (req.method === "DELETE") {
      if (sessionHeader && mcpSessions.has(sessionHeader)) {
        const session = mcpSessions.get(sessionHeader);
        mcpSessions.delete(sessionHeader);
        try {
          await session.server.close();
        } catch (error) {
          void error;
        }
        console.log(`[SESSION] Terminated ${sessionHeader.substring(0, 8)}`);
      }
      res.status(200).end();
      return;
    }

    if (sessionHeader && mcpSessions.has(sessionHeader)) {
      const session = mcpSessions.get(sessionHeader);
      console.log(`[SESSION] Reuse ${sessionHeader.substring(0, 8)} for ${bodyMethod ?? req.method}`);
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionHeader) {
      console.log(`[SESSION] Not found: ${sessionHeader.substring(0, 8)}`);
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found. Re-initialize." },
        id: null,
      });
      return;
    }

    console.log("[SESSION] Creating new session");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const mcpServer = createMcpServer();

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        mcpSessions.delete(sid);
        console.log(`[SESSION] onclose ${sid.substring(0, 8)}, remaining: ${mcpSessions.size}`);
      }
    };

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);

    const sid = transport.sessionId;
    if (sid) {
      mcpSessions.set(sid, { transport, server: mcpServer });
      console.log(`[SESSION] Stored ${sid.substring(0, 8)}, total: ${mcpSessions.size}`);
    } else {
      console.log("[SESSION] Warning: no session ID generated");
      try {
        await mcpServer.close();
      } catch (error) {
        void error;
      }
    }
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "internal_error", message: "Failed to handle MCP request" });
    }
  }
}

app.get("/sse", async (req, res) => {
  try {
    attachAuthInfo(req);
    const mcpServer = createMcpServer();
    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, { transport, server: mcpServer });
    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
  } catch (error) {
    console.error("SSE error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "internal_error" });
    }
  }
});

function getSessionId(req) {
  const q = req.query;
  if (typeof q.sessionId === "string") return q.sessionId;
  if (typeof q.session_id === "string") return q.session_id;
  const b = typeof req.body === "object" && req.body !== null ? req.body : {};
  if (typeof b.sessionId === "string") return b.sessionId;
  if (typeof b.session_id === "string") return b.session_id;
  return "";
}

async function handleLegacySseMessage(req, res) {
  attachAuthInfo(req);
  const sessionId = getSessionId(req);
  if (!sessionId) {
    res.status(400).send("Missing sessionId");
    return;
  }
  const session = sseSessions.get(sessionId);
  if (!session) {
    res.status(404).send("Unknown sessionId");
    return;
  }
  try {
    await session.transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error("SSE message error:", error);
    if (!res.headersSent) {
      res.status(500).send("Failed");
    }
  }
}

app.all("/mcp", handleStreamableMcpRequest);
app.post("/", (_req, res) => sendServiceInfo(res));
app.options("/", (_req, res) => {
  res.status(204)
    .set("Allow", "GET, POST, OPTIONS, HEAD")
    .set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
    .set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id")
    .set("Access-Control-Expose-Headers", "Mcp-Session-Id")
    .set("Access-Control-Max-Age", "86400")
    .end();
});
app.head("/", (_req, res) => res.status(200).end());

app.post("/messages", handleLegacySseMessage);
app.post("/sse", async (req, res) => {
  const sessionId = getSessionId(req);
  if (sessionId) {
    await handleLegacySseMessage(req, res);
    return;
  }
  res.status(200).json({
    service: "ScholarMark MCP Server",
    endpoint: "/sse",
    note: "Use GET /sse for legacy SSE streams.",
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`ScholarMark MCP server listening on port ${port}`);
  console.log(`Proxying backend requests to ${backendBaseUrl}`);
});
