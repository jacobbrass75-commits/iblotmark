import fs from "fs/promises";
import path from "path";

function envFlag(value: string | undefined): boolean | null {
  if (["1", "true", "yes", "on"].includes((value || "").toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes((value || "").toLowerCase())) return false;
  return null;
}

export function localFileImportsEnabled(): boolean {
  const explicit = envFlag(process.env.BLOG_ALLOW_LOCAL_FILE_IMPORTS);
  if (explicit !== null) return explicit;
  return process.env.NODE_ENV !== "production";
}

export async function resolveAllowedLocalImportPath(
  input: unknown,
  options: {
    extensions: string[];
    maxBytes: number;
  },
): Promise<string> {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("filePath is required");
  }

  const root = path.resolve(process.env.BLOG_LOCAL_IMPORT_DIR || path.join(process.cwd(), "data", "imports"));
  const resolved = path.resolve(input.trim());
  const rootReal = await fs.realpath(root);
  const targetReal = await fs.realpath(resolved);

  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`filePath must be inside the configured import directory: ${root}`);
  }

  const ext = path.extname(targetReal).toLowerCase();
  if (!options.extensions.includes(ext)) {
    throw new Error(`filePath must use one of these extensions: ${options.extensions.join(", ")}`);
  }

  const stat = await fs.stat(targetReal);
  if (!stat.isFile()) {
    throw new Error("filePath must point to a regular file");
  }
  if (stat.size > options.maxBytes) {
    throw new Error(`file is too large; maximum size is ${options.maxBytes} bytes`);
  }

  return targetReal;
}

export async function resolveAllowedLocalImportDirectory(input: unknown): Promise<string> {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("dirPath is required");
  }

  const root = path.resolve(process.env.BLOG_LOCAL_IMPORT_DIR || path.join(process.cwd(), "data", "imports"));
  const resolved = path.resolve(input.trim());
  const rootReal = await fs.realpath(root);
  const targetReal = await fs.realpath(resolved);

  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`dirPath must be inside the configured import directory: ${root}`);
  }

  const stat = await fs.stat(targetReal);
  if (!stat.isDirectory()) {
    throw new Error("dirPath must point to a directory");
  }

  return targetReal;
}
