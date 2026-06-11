import { lookup } from "dns/promises";
import http from "http";
import https from "https";
import net from "net";
import { Readable } from "stream";

const PRIVATE_HOSTS = new Set(["localhost", "0", "0.0.0.0"]);

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

export function parsePublicHttpUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }
  return url;
}

type PublicResolution = {
  url: URL;
  address: string;
  family: 4 | 6;
};

export async function resolvePublicHttpUrl(input: string | URL): Promise<PublicResolution> {
  const url = typeof input === "string" ? parsePublicHttpUrl(input) : input;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || PRIVATE_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Private or local network URLs are not allowed.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Private or local network URLs are not allowed.");
    return { url, address: hostname, family: net.isIP(hostname) as 4 | 6 };
  }

  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Private or local network URLs are not allowed.");
  }
  const preferred = addresses.find((entry) => entry.family === 4) || addresses[0];
  return { url, address: preferred.address, family: preferred.family as 4 | 6 };
}

export async function assertPublicHttpUrl(input: string | URL): Promise<URL> {
  return (await resolvePublicHttpUrl(input)).url;
}

async function normalizeBody(body: BodyInit | null | undefined): Promise<Buffer | string | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    throw new Error("safeFetch does not support FormData request bodies.");
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  throw new Error("safeFetch request body type is not supported.");
}

async function pinnedFetch(resolution: PublicResolution, init: RequestInit): Promise<Response> {
  const { url, address, family } = resolution;
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  const body = await normalizeBody(init.body);
  if (body !== undefined && !headers.has("content-length")) {
    headers.set("content-length", String(Buffer.byteLength(body)));
  }

  const client = url.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: Object.fromEntries(headers.entries()),
      servername: url.hostname,
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options && "all" in options && options.all) {
          (callback as (error: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: 4 | 6 }>) => void)(null, [{ address, family }]);
          return;
        }
        callback(null, address, family);
      },
    }, (incoming) => {
      if (settled) return;
      settled = true;
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) responseHeaders.append(key, item);
        } else if (value !== undefined) {
          responseHeaders.set(key, String(value));
        }
      }
      const bodyStream = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolve(new Response(bodyStream, {
        status: incoming.statusCode || 0,
        statusText: incoming.statusMessage || "",
        headers: responseHeaders,
      }));
    });

    request.on("error", finishReject);

    if (init.signal) {
      if (init.signal.aborted) {
        request.destroy();
        finishReject(new Error("Request aborted."));
        return;
      }
      init.signal.addEventListener("abort", () => {
        request.destroy();
        finishReject(new Error("Request aborted."));
      }, { once: true });
    }

    if (body !== undefined) request.write(body);
    request.end();
  });
}

export async function safeFetch(input: string, init: RequestInit & { maxRedirects?: number } = {}): Promise<Response> {
  let resolution = await resolvePublicHttpUrl(input);
  const maxRedirects = init.maxRedirects ?? 3;

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const response = await pinnedFetch(resolution, init);

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location || redirects === maxRedirects) return response;
    try { await response.body?.cancel(); } catch {}
    resolution = await resolvePublicHttpUrl(new URL(location, resolution.url));
  }

  throw new Error("Too many redirects.");
}

export async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) {
    throw new Error(`Response is too large; maximum size is ${maxBytes} bytes.`);
  }

  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      throw new Error(`Response is too large; maximum size is ${maxBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString("utf8");
}
