function resolveResourcePath(req) {
    const requestPath = typeof req?.path === "string" ? req.path : "";
    return requestPath.endsWith("/mcp.") ? "/mcp." : "/mcp";
}
function getResourceBaseUrl(req) {
    const resourcePath = resolveResourcePath(req);
    const configured = process.env.MCP_RESOURCE_URL;
    if (configured && configured.trim().length > 0) {
        try {
            const url = new URL(configured);
            if (url.pathname === "/" || url.pathname === "") {
                url.pathname = resourcePath;
            }
            else if (resourcePath.endsWith(".") && !url.pathname.endsWith(".")) {
                url.pathname = `${url.pathname}.`;
            }
            return url.toString().replace(/\/+$/, "");
        }
        catch {
            const normalized = configured.replace(/\/+$/, "");
            if (resourcePath.endsWith(".")) {
                if (normalized.endsWith("/mcp.")) {
                    return normalized;
                }
                if (normalized.endsWith("/mcp")) {
                    return `${normalized}.`;
                }
                return `${normalized}/mcp.`;
            }
            return normalized.endsWith("/mcp") ? normalized : `${normalized}/mcp`;
        }
    }
    const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProto || req.protocol || "https";
    const host = req.header("x-forwarded-host") || req.get("host") || "localhost";
    return `${protocol}://${host}${resourcePath}`.replace(/\/+$/, "");
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
