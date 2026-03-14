function normalizeCanonicalResourcePath(pathname) {
    if (!pathname || pathname === "/") {
        return "/mcp";
    }
    if (pathname.endsWith("/mcp.")) {
        return pathname.slice(0, -1);
    }
    return pathname;
}
function getResourceBaseUrl(req) {
    const configured = process.env.MCP_RESOURCE_URL;
    if (configured && configured.trim().length > 0) {
        try {
            const url = new URL(configured);
            url.pathname = normalizeCanonicalResourcePath(url.pathname);
            return url.toString().replace(/\/+$/, "");
        }
        catch {
            const normalized = configured.replace(/\/+$/, "");
            if (normalized.endsWith("/mcp.")) {
                return normalized.slice(0, -1);
            }
            return normalized.endsWith("/mcp") ? normalized : `${normalized}/mcp`;
        }
    }
    const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProto || req.protocol || "https";
    const host = req.header("x-forwarded-host") || req.get("host") || "localhost";
    return `${protocol}://${host}/mcp`.replace(/\/+$/, "");
}
function getAuthorizationServer() {
    const configured = process.env.MCP_AUTHORIZATION_SERVER
        || process.env.SCHOLARMARK_AUTHORIZATION_SERVER
        || process.env.APP_BASE_URL
        || "https://app.scholarmark.ai";
    return configured.replace(/\/+$/, "");
}
export function buildProtectedResourceMetadata(req) {
    return {
        resource: getResourceBaseUrl(req),
        authorization_servers: [getAuthorizationServer()],
        bearer_methods_supported: ["header"],
        scopes_supported: ["read", "write"],
    };
}
