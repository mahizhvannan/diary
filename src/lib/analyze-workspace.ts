import { promises as fs } from "fs";
import path from "path";
import { ANALYZE_AGENTS_MD, ANALYZE_SCHEMA_MD } from "./analyze-schema";
import type { DiarySnapshot, WorkspaceArtifact } from "./analyze-types";
import { sanitizeWorkspaceScope } from "./server-ai-auth";

export type { DiarySnapshot, WorkspaceArtifact };

const ROOT_BASE = path.join(process.cwd(), ".diary-analyze");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function analyzeWorkspaceRoot(scopeId: string): string {
  const scope = sanitizeWorkspaceScope(scopeId);
  if (!scope) throw new Error("Invalid analyze workspace scope");
  return path.join(ROOT_BASE, scope);
}

function pathsFor(scopeId: string) {
  const root = analyzeWorkspaceRoot(scopeId);
  return {
    root,
    data: path.join(root, "data"),
    out: path.join(root, "out"),
  };
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function ensureDirs(scopeId: string): Promise<ReturnType<typeof pathsFor>> {
  const p = pathsFor(scopeId);
  await fs.mkdir(path.join(p.data, "days"), { recursive: true });
  await fs.mkdir(path.join(p.data, "calories"), { recursive: true });
  await fs.mkdir(path.join(p.data, "month-summaries"), { recursive: true });
  await fs.mkdir(p.out, { recursive: true });
  return p;
}

async function writeJsonSafe(dir: string, fileName: string, body: unknown): Promise<void> {
  const full = path.join(dir, fileName);
  if (!isInside(dir, full)) {
    throw new Error(`Refusing to write outside workspace: ${fileName}`);
  }
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(body, null, 2), "utf8");
}

async function emptyDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    await fs.rm(full, { recursive: true, force: true });
  }
}

export async function writeDiarySnapshot(
  scopeId: string,
  snapshot: DiarySnapshot,
): Promise<{ root: string }> {
  const p = await ensureDirs(scopeId);
  await emptyDir(path.join(p.data, "days"));
  await emptyDir(path.join(p.data, "calories"));
  await emptyDir(path.join(p.data, "month-summaries"));

  await fs.writeFile(path.join(p.root, "SCHEMA.md"), ANALYZE_SCHEMA_MD, "utf8");
  await fs.writeFile(path.join(p.root, "AGENTS.md"), ANALYZE_AGENTS_MD, "utf8");

  await writeJsonSafe(p.data, "collections.json", snapshot.collections ?? { collections: [] });
  await writeJsonSafe(p.data, "custom-skills.json", snapshot.customSkills ?? { skills: [] });
  await writeJsonSafe(p.data, "period-qa.json", snapshot.periodQa ?? { answers: [] });
  if (snapshot.manifest) {
    await writeJsonSafe(p.data, "manifest-snapshot.json", snapshot.manifest);
  }

  const daysDir = path.join(p.data, "days");
  for (const [date, day] of Object.entries(snapshot.days ?? {})) {
    if (!DATE_RE.test(date)) continue;
    await writeJsonSafe(daysDir, `day-${date}.json`, day);
  }
  const calDir = path.join(p.data, "calories");
  for (const [date, day] of Object.entries(snapshot.calories ?? {})) {
    if (!DATE_RE.test(date)) continue;
    await writeJsonSafe(calDir, `cal-${date}.json`, day);
  }
  const monthDir = path.join(p.data, "month-summaries");
  for (const [month, file] of Object.entries(snapshot.monthSummaries ?? {})) {
    if (!MONTH_RE.test(month)) continue;
    await writeJsonSafe(monthDir, `month-${month}.json`, file);
  }

  return { root: p.root };
}

async function walkFiles(dir: string, base = dir): Promise<WorkspaceArtifact[]> {
  const out: WorkspaceArtifact[] = [];
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkFiles(full, base)));
      continue;
    }
    const st = await fs.stat(full);
    const relativePath = path.relative(base, full).split(path.sep).join("/");
    out.push({
      relativePath,
      name: String(e.name),
      size: st.size,
      updatedAt: st.mtime.toISOString(),
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listOutArtifacts(scopeId: string): Promise<WorkspaceArtifact[]> {
  const p = await ensureDirs(scopeId);
  return walkFiles(p.out);
}

export async function readOutArtifact(
  scopeId: string,
  relativePath: string,
): Promise<{ relativePath: string; content: string; mimeType: string } | null> {
  const p = pathsFor(scopeId);
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("..") || path.isAbsolute(cleaned)) return null;
  const full = path.join(p.out, cleaned);
  if (!isInside(p.out, full)) return null;
  try {
    const buf = await fs.readFile(path.resolve(full));
    const ext = path.extname(cleaned).toLowerCase();
    const mimeType =
      ext === ".html" || ext === ".htm"
        ? "text/html"
        : ext === ".svg"
          ? "image/svg+xml"
          : ext === ".md"
            ? "text/markdown"
            : ext === ".json"
              ? "application/json"
              : ext === ".png"
                ? "image/png"
                : ext === ".csv"
                  ? "text/csv"
                  : "text/plain";
    const content =
      mimeType.startsWith("image/") && ext === ".png"
        ? buf.toString("base64")
        : buf.toString("utf8");
    return { relativePath: cleaned, content, mimeType };
  } catch {
    return null;
  }
}

export async function clearOutArtifacts(scopeId: string): Promise<void> {
  const p = await ensureDirs(scopeId);
  await emptyDir(p.out);
}
