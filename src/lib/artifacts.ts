import type { ArtifactFile, ArtifactKind } from "./types";

export function kindFromMime(mimeType: string, name: string): ArtifactKind {
  const lower = name.toLowerCase();
  if (mimeType.includes("html") || lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (mimeType.includes("svg") || lower.endsWith(".svg")) return "svg";
  if (mimeType.includes("markdown") || lower.endsWith(".md")) return "md";
  if (mimeType.includes("json") || lower.endsWith(".json")) return "json";
  if (mimeType.includes("png") || lower.endsWith(".png")) return "png";
  if (mimeType.includes("csv") || lower.endsWith(".csv")) return "csv";
  if (mimeType.startsWith("text/")) return "text";
  return "other";
}

export function titleFromPath(relativePath: string): string {
  const base = relativePath.split("/").pop() || relativePath;
  return base.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") || base;
}

export function artifactFromOutFile(opts: {
  relativePath: string;
  content: string;
  mimeType: string;
  note?: string;
}): ArtifactFile {
  const now = new Date().toISOString();
  const kind = kindFromMime(opts.mimeType, opts.relativePath);
  return {
    id: crypto.randomUUID(),
    title: titleFromPath(opts.relativePath),
    kind,
    mimeType: opts.mimeType,
    content: opts.content,
    encoding: kind === "png" ? "base64" : "utf8",
    sourcePath: opts.relativePath,
    createdAt: now,
    note: opts.note,
  };
}
