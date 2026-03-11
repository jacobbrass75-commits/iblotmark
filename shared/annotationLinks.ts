export function buildTextFingerprint(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function buildProjectAnnotationJumpPath(options: {
  projectId: string;
  projectDocumentId: string;
  annotationId?: string | null;
  startPosition?: number | null;
  anchorFingerprint?: string | null;
}): string {
  const params = new URLSearchParams();
  if (options.annotationId) {
    params.set("annotationId", options.annotationId);
  }
  if (typeof options.startPosition === "number" && Number.isFinite(options.startPosition)) {
    params.set("start", String(options.startPosition));
  }
  if (options.anchorFingerprint) {
    params.set("anchor", options.anchorFingerprint);
  }

  const query = params.toString();
  const basePath = `/projects/${options.projectId}/documents/${options.projectDocumentId}`;
  return query ? `${basePath}?${query}` : basePath;
}
