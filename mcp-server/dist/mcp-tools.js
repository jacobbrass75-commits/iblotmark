import { BackendHttpError, ScholarMarkBackendClient } from "./backend-client.js";
import { consumeSSEStream } from "./sse-buffer.js";
import { z } from "zod";
function asTextResult(payload) {
    return {
        content: [
            {
                type: "text",
                text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
            },
        ],
    };
}
function asErrorResult(message) {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: message,
            },
        ],
    };
}
function registerTool(server, name, description, inputSchema, handler) {
    if (typeof server.registerTool === "function") {
        const mcpInputSchema = toZodInputSchema(inputSchema);
        server.registerTool(name, { description, inputSchema: mcpInputSchema }, handler);
        return;
    }
    if (typeof server.tool === "function") {
        server.tool(name, description, inputSchema, handler);
        return;
    }
    throw new Error("MCP server instance does not support tool registration");
}
function toZodField(schema) {
    const schemaType = typeof schema.type === "string" ? schema.type : "";
    let field;
    if (schemaType === "string") {
        field = z.string();
    }
    else if (schemaType === "number") {
        field = z.number();
    }
    else if (schemaType === "integer") {
        field = z.number().int();
    }
    else if (schemaType === "boolean") {
        field = z.boolean();
    }
    else {
        field = z.any();
    }
    const description = typeof schema.description === "string" ? schema.description.trim() : "";
    if (description.length > 0) {
        return field.describe(description);
    }
    return field;
}
function toZodInputSchema(inputSchema) {
    const schemaType = typeof inputSchema.type === "string" ? inputSchema.type : "";
    if (schemaType !== "object") {
        return z.object({}).passthrough();
    }
    const properties = typeof inputSchema.properties === "object" && inputSchema.properties !== null
        ? inputSchema.properties
        : {};
    const required = Array.isArray(inputSchema.required)
        ? inputSchema.required.filter((entry) => typeof entry === "string")
        : [];
    const requiredSet = new Set(required);
    const shape = {};
    for (const [key, rawValue] of Object.entries(properties)) {
        const schema = typeof rawValue === "object" && rawValue !== null
            ? rawValue
            : {};
        let field = toZodField(schema);
        if (!requiredSet.has(key)) {
            field = field.optional();
        }
        shape[key] = field;
    }
    const base = z.object(shape);
    return inputSchema.additionalProperties === false ? base.strict() : base.passthrough();
}
function getHeaderValue(headers, headerName) {
    if (!headers)
        return null;
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
        return headers.get(headerName);
    }
    if (typeof headers === "object") {
        const record = headers;
        const direct = record[headerName] ?? record[headerName.toLowerCase()] ?? record[headerName.toUpperCase()];
        if (typeof direct === "string")
            return direct;
        if (Array.isArray(direct) && typeof direct[0] === "string")
            return direct[0];
    }
    return null;
}
function extractBearerToken(context) {
    if (context.authInfo?.token) {
        return context.authInfo.token;
    }
    const candidateHeaders = [
        context.requestInfo?.headers,
        context.request?.headers,
        context.headers,
        context.meta?.headers,
        context._meta?.headers,
    ];
    for (const headers of candidateHeaders) {
        const authorization = getHeaderValue(headers, "authorization");
        if (!authorization)
            continue;
        const [scheme, token] = authorization.split(/\s+/);
        if (!scheme || !token)
            continue;
        if (scheme.toLowerCase() !== "bearer")
            continue;
        return token;
    }
    return null;
}
function parseRequiredString(input, key) {
    const value = input[key];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${key} is required`);
    }
    return value.trim();
}
function parseOptionalString(input, key) {
    const value = input[key];
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function buildQueryString(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "undefined" || value === null) {
            continue;
        }
        search.set(key, String(value));
    }
    const query = search.toString();
    return query.length > 0 ? `?${query}` : "";
}
async function resolveSourceIds(client, token, input) {
    const projectDocumentId = parseOptionalString(input, "project_document_id");
    const documentId = parseOptionalString(input, "document_id");
    if (projectDocumentId) {
        const projectDocument = await client.requestJson("GET", `/api/project-documents/${encodeURIComponent(projectDocumentId)}`, token);
        const resolvedDocumentId = typeof projectDocument?.documentId === "string"
            ? projectDocument.documentId.trim()
            : "";
        if (resolvedDocumentId.length === 0) {
            throw new Error("Project document did not include a backing document ID.");
        }
        return {
            projectDocumentId,
            documentId: resolvedDocumentId,
            projectDocument,
        };
    }
    if (documentId) {
        return {
            projectDocumentId: undefined,
            documentId,
            projectDocument: null,
        };
    }
    throw new Error("project_document_id or document_id is required");
}
function describeBackendError(error) {
    if (error instanceof BackendHttpError) {
        if (error.status === 401) {
            return "Authentication failed. Please reconnect the ScholarMark connector.";
        }
        if (error.status === 403) {
            return "This feature requires a ScholarMark Pro plan.";
        }
        if (error.status === 404) {
            return "Requested ScholarMark resource was not found.";
        }
        if (typeof error.body === "string" && error.body.trim().length > 0) {
            return `Backend request failed (${error.status}): ${error.body}`;
        }
        if (error.body && typeof error.body === "object") {
            const message = error.body.message;
            if (typeof message === "string" && message.trim().length > 0) {
                return `Backend request failed (${error.status}): ${message}`;
            }
        }
        return `Backend request failed with status ${error.status}`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return "Unknown tool execution error";
}
function formatSseOutput(result) {
    const sections = [];
    if (result.text.trim().length > 0) {
        sections.push(result.text.trim());
    }
    for (const document of result.documents) {
        const safeTitle = (document.title || "Draft").replace(/"/g, "'");
        sections.push(`<document title="${safeTitle}">\n${document.content}\n</document>`);
    }
    return sections.join("\n\n").trim();
}
async function withToken(context, fn) {
    try {
        const token = extractBearerToken(context);
        if (!token) {
            return asErrorResult("Missing Bearer token in MCP request context.");
        }
        return await fn(token);
    }
    catch (error) {
        return asErrorResult(describeBackendError(error));
    }
}
export function registerScholarMarkTools(server, options) {
    const client = new ScholarMarkBackendClient(options.backendBaseUrl);
    registerTool(server, "get_projects", "List your ScholarMark writing projects", {
        type: "object",
        properties: {},
        additionalProperties: false,
    }, async (_input, context) => withToken(context, async (token) => {
        const projects = await client.requestJson("GET", "/api/projects", token);
        return asTextResult(projects);
    }));
    registerTool(server, "get_project_sources", "List sources attached to a specific ScholarMark project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
        },
        required: ["project_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = encodeURIComponent(parseRequiredString(input, "project_id"));
        const sources = await client.requestJson("GET", `/api/projects/${projectId}/documents`, token);
        return asTextResult(sources);
    }));
    registerTool(server, "get_source_summary", "Load a source summary, key concepts, and related project-document metadata", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if you already have it" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const { projectDocumentId, documentId, projectDocument } = await resolveSourceIds(client, token, input);
        const summary = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}/summary`, token);
        return asTextResult({
            projectDocumentId: projectDocumentId ?? null,
            documentId,
            projectDocument,
            summary,
        });
    }));
    registerTool(server, "get_source_annotations", "Load quote-bank annotations for a project source or a plain document", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if you want legacy document annotations" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const { projectDocumentId, documentId } = await resolveSourceIds(client, token, input);
        if (projectDocumentId) {
            const annotations = await client.requestJson("GET", `/api/project-documents/${encodeURIComponent(projectDocumentId)}/annotations`, token);
            return asTextResult({
                scope: "project_document",
                projectDocumentId,
                documentId,
                annotations,
            });
        }
        const annotations = await client.requestJson("GET", `/api/documents/${encodeURIComponent(documentId)}/annotations`, token);
        return asTextResult({
            scope: "document",
            documentId,
            annotations,
        });
    }));
    registerTool(server, "get_source_chunks", "Search a source for relevant chunks/quotes and return the best matching passages", {
        type: "object",
        properties: {
            project_document_id: { type: "string", description: "Project document ID from get_project_sources" },
            document_id: { type: "string", description: "Underlying document ID if you want non-project document search" },
            query: { type: "string", description: "What you want to find in the source" },
        },
        required: ["query"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const query = parseRequiredString(input, "query");
        const { projectDocumentId, documentId } = await resolveSourceIds(client, token, input);
        if (projectDocumentId) {
            const results = await client.requestJson("POST", `/api/project-documents/${encodeURIComponent(projectDocumentId)}/search`, token, { query });
            return asTextResult({
                scope: "project_document",
                projectDocumentId,
                documentId,
                query,
                results,
            });
        }
        const results = await client.requestJson("POST", `/api/documents/${encodeURIComponent(documentId)}/search`, token, { query });
        return asTextResult({
            scope: "document",
            documentId,
            query,
            results,
        });
    }));
    registerTool(server, "get_web_clips", "Load saved web clips, optionally filtered to a project, URL, category, or text query", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "Optional project ID to limit clips to one project" },
            source_url: { type: "string", description: "Optional exact source URL filter" },
            category: { type: "string", description: "Optional clip category filter" },
            search: { type: "string", description: "Optional text search across clip content and notes" },
            limit: { type: "integer", description: "Optional result limit (default 25, max 200)" },
            sort: { type: "string", description: "Optional sort: newest, oldest, or site" },
        },
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = parseOptionalString(input, "project_id");
        const sourceUrl = parseOptionalString(input, "source_url");
        const category = parseOptionalString(input, "category");
        const search = parseOptionalString(input, "search");
        const sort = parseOptionalString(input, "sort");
        const limit = typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(200, Math.floor(input.limit)))
            : 25;
        const query = buildQueryString({
            projectId,
            sourceUrl,
            category,
            search,
            sort,
            limit,
        });
        const clips = await client.requestJson("GET", `/api/web-clips${query}`, token);
        return asTextResult(clips);
    }));
    registerTool(server, "start_conversation", "Start a new ScholarMark conversation for a project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
            title: { type: "string", description: "Optional conversation title" },
        },
        required: ["project_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = parseRequiredString(input, "project_id");
        const title = typeof input.title === "string" ? input.title.trim() : undefined;
        const conversation = await client.requestJson("POST", "/api/chat/conversations", token, {
            projectId,
            title: title && title.length > 0 ? title : "New Chat",
            model: "claude-opus-4-6",
            writingModel: "precision",
        });
        return asTextResult(conversation);
    }));
    registerTool(server, "send_message", "Send a message to a ScholarMark conversation and return the full buffered answer", {
        type: "object",
        properties: {
            conversation_id: { type: "string", description: "Conversation ID" },
            message: { type: "string", description: "Message content" },
        },
        required: ["conversation_id", "message"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const conversationId = encodeURIComponent(parseRequiredString(input, "conversation_id"));
        const message = parseRequiredString(input, "message");
        const response = await client.requestSSE("POST", `/api/chat/conversations/${conversationId}/messages`, token, { content: message }, 300_000);
        const buffered = await consumeSSEStream(response, { timeoutMs: 300_000 });
        const fullResponse = formatSseOutput(buffered);
        return asTextResult({
            response: fullResponse,
            usage: buffered.usage,
        });
    }));
    registerTool(server, "get_conversations", "List conversations for a ScholarMark project", {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ScholarMark project ID" },
        },
        required: ["project_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const projectId = encodeURIComponent(parseRequiredString(input, "project_id"));
        const conversations = await client.requestJson("GET", `/api/chat/conversations?projectId=${projectId}`, token);
        return asTextResult(conversations);
    }));
    registerTool(server, "compile_paper", "Compile a conversation into a finalized paper draft", {
        type: "object",
        properties: {
            conversation_id: { type: "string", description: "Conversation ID" },
        },
        required: ["conversation_id"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const conversationId = encodeURIComponent(parseRequiredString(input, "conversation_id"));
        const response = await client.requestSSE("POST", `/api/chat/conversations/${conversationId}/compile`, token, {}, 300_000);
        const buffered = await consumeSSEStream(response, { timeoutMs: 300_000 });
        return asTextResult({
            compiled_content: formatSseOutput(buffered),
            usage: buffered.usage,
        });
    }));
    registerTool(server, "verify_paper", "Verify citations and claims in a compiled paper", {
        type: "object",
        properties: {
            conversation_id: { type: "string", description: "Conversation ID" },
            compiled_content: { type: "string", description: "Compiled paper content to verify" },
        },
        required: ["conversation_id", "compiled_content"],
        additionalProperties: false,
    }, async (input, context) => withToken(context, async (token) => {
        const conversationId = encodeURIComponent(parseRequiredString(input, "conversation_id"));
        const compiledContent = parseRequiredString(input, "compiled_content");
        const response = await client.requestSSE("POST", `/api/chat/conversations/${conversationId}/verify`, token, { compiledContent }, 300_000);
        const buffered = await consumeSSEStream(response, { timeoutMs: 300_000 });
        return asTextResult({
            verification_report: formatSseOutput(buffered),
            usage: buffered.usage,
        });
    }));
}
