import type {
  ArtifactFile,
  ArtifactsIndex,
  CalorieDay,
  CollectionsFile,
  CollectionsMetaFile,
  CustomSkillsFile,
  DayFile,
  Manifest,
  MonthSummaryFile,
  PeriodQaFile,
  RecentSession,
  TrackMonthFile,
} from "./types";
import { DEFAULT_CALORIE_GOAL } from "./nutrition";
import { collectionsToMeta, splitTrackMonths, mergeTrackMonths } from "./track";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_NAME = "DiaryApp";
const MANIFEST_NAME = "manifest.json";

function normalizeManifest(loaded: Manifest, folderId: string): Manifest {
  return {
    folderId,
    calorieGoal: loaded.calorieGoal ?? DEFAULT_CALORIE_GOAL,
    days: loaded.days ?? [],
    calorieDays: loaded.calorieDays ?? [],
    recentSessions: loaded.recentSessions ?? [],
    monthSummaries: loaded.monthSummaries ?? [],
    periodQaFileId: loaded.periodQaFileId,
    collectionsFileId: loaded.collectionsFileId,
    trackMonths: loaded.trackMonths ?? [],
    monthFolders: loaded.monthFolders ?? [],
    customSkillsFileId: loaded.customSkillsFileId,
    artifactsFileId: loaded.artifactsFileId,
    artifactFiles: loaded.artifactFiles ?? [],
  };
}

function recentFromDay(day: DayFile): RecentSession[] {
  return day.entries.map((e) => ({
    date: day.date,
    entryId: e.id,
    title: e.title,
    updatedAt: e.updatedAt,
  }));
}

function mergeRecent(existing: RecentSession[] | undefined, day: DayFile): RecentSession[] {
  const without = (existing ?? []).filter((r) => r.date !== day.date);
  return [...recentFromDay(day), ...without]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 80);
}

function authHeaders(token: string, extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set("Authorization", `Bearer ${token}`);
  return h;
}

async function driveJson<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: authHeaders(token, init?.headers),
  });
  if (res.status === 401) {
    throw new Error("Google sign-in expired. Connect Drive again.");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive error ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

type DriveFile = { id: string; name: string };

async function findFile(
  token: string,
  q: string,
): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    q,
    fields: "files(id,name)",
    pageSize: "1",
  });
  const data = await driveJson<{ files: DriveFile[] }>(
    token,
    `${DRIVE}/files?${params}`,
  );
  return data.files[0] ?? null;
}

async function createFolder(token: string, name: string, parentId?: string): Promise<string> {
  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    appProperties: { diary: "1" },
  };
  if (parentId) body.parents = [parentId];
  const file = await driveJson<DriveFile>(token, `${DRIVE}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return file.id;
}

async function downloadJson<T>(token: string, fileId: string): Promise<T> {
  return driveJson<T>(
    token,
    `${DRIVE}/files/${fileId}?alt=media`,
  );
}

async function uploadJson(opts: {
  token: string;
  name: string;
  parentId?: string;
  fileId?: string;
  body: unknown;
}): Promise<string> {
  const metadata: Record<string, unknown> = {
    name: opts.name,
    mimeType: "application/json",
    appProperties: { diary: "1" },
  };
  if (!opts.fileId && opts.parentId) {
    metadata.parents = [opts.parentId];
  }

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append(
    "file",
    new Blob([JSON.stringify(opts.body, null, 2)], { type: "application/json" }),
  );

  const url = opts.fileId
    ? `${UPLOAD}/files/${opts.fileId}?uploadType=multipart`
    : `${UPLOAD}/files?uploadType=multipart`;

  const res = await fetch(url, {
    method: opts.fileId ? "PATCH" : "POST",
    headers: authHeaders(opts.token),
    body: form,
  });
  if (res.status === 401) {
    throw new Error("Google sign-in expired. Connect Drive again.");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload ${res.status}: ${text.slice(0, 400)}`);
  }
  const file = (await res.json()) as DriveFile;
  return file.id;
}

async function trashFile(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE}/files/${fileId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (res.status === 401) {
    throw new Error("Google sign-in expired. Connect Drive again.");
  }
  // Already gone / no access — treat as deleted so local index can still clean up.
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive error ${res.status}: ${text.slice(0, 400)}`);
  }
}

export async function ensureDiaryStore(token: string): Promise<Manifest> {
  const folder = await findFile(
    token,
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const folderId = folder?.id ?? (await createFolder(token, FOLDER_NAME));

  const manifestFile = await findFile(
    token,
    `name='${MANIFEST_NAME}' and '${folderId}' in parents and trashed=false`,
  );

  if (manifestFile) {
    const loaded = await downloadJson<Manifest>(token, manifestFile.id);
    return normalizeManifest(loaded, folderId);
  }

  const empty: Manifest = normalizeManifest({ folderId, days: [] }, folderId);
  await uploadJson({
    token,
    name: MANIFEST_NAME,
    parentId: folderId,
    body: empty,
  });
  return empty;
}

async function manifestFileId(token: string, folderId: string): Promise<string | null> {
  const file = await findFile(
    token,
    `name='${MANIFEST_NAME}' and '${folderId}' in parents and trashed=false`,
  );
  return file?.id ?? null;
}

export async function saveManifest(token: string, manifest: Manifest): Promise<void> {
  const id = await manifestFileId(token, manifest.folderId);
  await uploadJson({
    token,
    name: MANIFEST_NAME,
    parentId: manifest.folderId,
    fileId: id ?? undefined,
    body: manifest,
  });
}

async function ensureMonthFolder(
  token: string,
  manifest: Manifest,
  month: string,
): Promise<{ folderId: string; manifest: Manifest }> {
  const hit = (manifest.monthFolders ?? []).find((m) => m.month === month);
  if (hit) return { folderId: hit.folderId, manifest };

  const found = await findFile(
    token,
    `name='${month}' and mimeType='application/vnd.google-apps.folder' and '${manifest.folderId}' in parents and trashed=false`,
  );
  const folderId = found?.id ?? (await createFolder(token, month, manifest.folderId));
  const monthFolders = [...(manifest.monthFolders ?? []).filter((m) => m.month !== month), { month, folderId }];
  return { folderId, manifest: { ...manifest, monthFolders } };
}

function dayFileName(date: string): string {
  return `day-${date}.json`;
}

export async function loadDayFile(
  token: string,
  manifest: Manifest,
  date: string,
): Promise<DayFile | null> {
  const row = manifest.days.find((d) => d.date === date);
  if (!row) return null;
  return downloadJson<DayFile>(token, row.fileId);
}

export async function saveDayFile(
  token: string,
  manifest: Manifest,
  day: DayFile,
): Promise<Manifest> {
  const existing = manifest.days.find((d) => d.date === day.date);
  const month = day.date.slice(0, 7);
  let nextManifest = manifest;
  let parentId = manifest.folderId;
  if (!existing) {
    const folder = await ensureMonthFolder(token, nextManifest, month);
    nextManifest = folder.manifest;
    parentId = folder.folderId;
  }
  const fileId = await uploadJson({
    token,
    name: dayFileName(day.date),
    parentId,
    fileId: existing?.fileId,
    body: day,
  });

  const tags = Array.from(new Set(day.entries.flatMap((e) => e.tags)));
  const row = {
    date: day.date,
    fileId,
    summary: day.summary,
    tags,
    entryCount: day.entries.length,
  };

  const days = existing
    ? nextManifest.days.map((d) => (d.date === day.date ? row : d))
    : [...nextManifest.days, row].sort((a, b) => b.date.localeCompare(a.date));

  const next = {
    ...nextManifest,
    days,
    recentSessions: mergeRecent(nextManifest.recentSessions, day),
  };
  await saveManifest(token, next);
  return next;
}

export async function deleteDayFile(
  token: string,
  manifest: Manifest,
  date: string,
): Promise<Manifest> {
  const row = manifest.days.find((d) => d.date === date);
  if (row) {
    await trashFile(token, row.fileId);
  }
  const next = {
    ...manifest,
    days: manifest.days.filter((d) => d.date !== date),
    recentSessions: (manifest.recentSessions ?? []).filter((r) => r.date !== date),
  };
  await saveManifest(token, next);
  return next;
}

function calorieFileName(date: string): string {
  return `cal-${date}.json`;
}

export async function loadCalorieFile(
  token: string,
  manifest: Manifest,
  date: string,
): Promise<CalorieDay | null> {
  const row = (manifest.calorieDays ?? []).find((d) => d.date === date);
  if (!row) return null;
  return downloadJson<CalorieDay>(token, row.fileId);
}

export async function saveCalorieFile(
  token: string,
  manifest: Manifest,
  day: CalorieDay,
): Promise<Manifest> {
  const existing = (manifest.calorieDays ?? []).find((d) => d.date === day.date);
  const month = day.date.slice(0, 7);
  let nextManifest = manifest;
  let parentId = manifest.folderId;
  if (!existing) {
    const folder = await ensureMonthFolder(token, nextManifest, month);
    nextManifest = folder.manifest;
    parentId = folder.folderId;
  }
  const fileId = await uploadJson({
    token,
    name: calorieFileName(day.date),
    parentId,
    fileId: existing?.fileId,
    body: day,
  });
  const row = { date: day.date, fileId };
  const calorieDays = existing
    ? (nextManifest.calorieDays ?? []).map((d) => (d.date === day.date ? row : d))
    : [...(nextManifest.calorieDays ?? []), row].sort((a, b) => b.date.localeCompare(a.date));
  const next = { ...nextManifest, calorieDays };
  await saveManifest(token, next);
  return next;
}

export async function deleteCalorieFile(
  token: string,
  manifest: Manifest,
  date: string,
): Promise<Manifest> {
  const row = (manifest.calorieDays ?? []).find((d) => d.date === date);
  if (row) {
    await trashFile(token, row.fileId);
  }
  const next = {
    ...manifest,
    calorieDays: (manifest.calorieDays ?? []).filter((d) => d.date !== date),
  };
  await saveManifest(token, next);
  return next;
}

function monthFileName(month: string): string {
  return `month-${month}.json`;
}

export async function loadMonthSummary(
  token: string,
  manifest: Manifest,
  month: string,
): Promise<MonthSummaryFile | null> {
  const row = (manifest.monthSummaries ?? []).find((d) => d.month === month);
  if (!row) return null;
  return downloadJson<MonthSummaryFile>(token, row.fileId);
}

export async function saveMonthSummary(
  token: string,
  manifest: Manifest,
  body: MonthSummaryFile,
): Promise<Manifest> {
  const existing = (manifest.monthSummaries ?? []).find((d) => d.month === body.month);
  const fileId = await uploadJson({
    token,
    name: monthFileName(body.month),
    parentId: manifest.folderId,
    fileId: existing?.fileId,
    body,
  });
  const row = { month: body.month, fileId };
  const monthSummaries = existing
    ? (manifest.monthSummaries ?? []).map((d) => (d.month === body.month ? row : d))
    : [...(manifest.monthSummaries ?? []), row];
  const next = { ...manifest, monthSummaries };
  await saveManifest(token, next);
  return next;
}

export async function deleteMonthSummary(
  token: string,
  manifest: Manifest,
  month: string,
): Promise<Manifest> {
  const row = (manifest.monthSummaries ?? []).find((d) => d.month === month);
  if (row) {
    await trashFile(token, row.fileId);
  }
  const next = {
    ...manifest,
    monthSummaries: (manifest.monthSummaries ?? []).filter((d) => d.month !== month),
  };
  await saveManifest(token, next);
  return next;
}

const PERIOD_QA_NAME = "period-qa.json";

export async function loadPeriodQa(
  token: string,
  manifest: Manifest,
): Promise<PeriodQaFile> {
  if (manifest.periodQaFileId) {
    try {
      return await downloadJson<PeriodQaFile>(token, manifest.periodQaFileId);
    } catch {
      return { answers: [] };
    }
  }
  return { answers: [] };
}

export async function savePeriodQa(
  token: string,
  manifest: Manifest,
  body: PeriodQaFile,
): Promise<Manifest> {
  const fileId = await uploadJson({
    token,
    name: PERIOD_QA_NAME,
    parentId: manifest.folderId,
    fileId: manifest.periodQaFileId,
    body,
  });
  const next = { ...manifest, periodQaFileId: fileId };
  await saveManifest(token, next);
  return next;
}

const COLLECTIONS_META_NAME = "collections-meta.json";

function trackMonthFileName(month: string): string {
  return `track-${month}.json`;
}

export async function loadCollections(
  token: string,
  manifest: Manifest,
): Promise<CollectionsFile> {
  let meta: CollectionsMetaFile | CollectionsFile | null = null;
  if (manifest.collectionsFileId) {
    try {
      meta = await downloadJson<CollectionsMetaFile | CollectionsFile>(
        token,
        manifest.collectionsFileId,
      );
    } catch {
      meta = null;
    }
  }
  if (!meta) return { collections: [] };

  // Legacy single-file shape already includes samples.
  const legacyHasSamples = (meta.collections ?? []).some((c) =>
    (c.variables ?? []).some((v) => Array.isArray((v as { samples?: unknown }).samples)),
  );
  if (legacyHasSamples) {
    return { collections: (meta as CollectionsFile).collections ?? [] };
  }

  const months: TrackMonthFile[] = [];
  for (const row of manifest.trackMonths ?? []) {
    try {
      months.push(await downloadJson<TrackMonthFile>(token, row.fileId));
    } catch {
      // skip missing month shard
    }
  }
  return mergeTrackMonths(meta as CollectionsMetaFile, months);
}

export async function saveCollections(
  token: string,
  manifest: Manifest,
  body: CollectionsFile,
): Promise<Manifest> {
  let next = manifest;
  const meta = collectionsToMeta(body);
  const metaFileId = await uploadJson({
    token,
    name: COLLECTIONS_META_NAME,
    parentId: next.folderId,
    fileId: next.collectionsFileId,
    body: meta,
  });
  next = { ...next, collectionsFileId: metaFileId };

  const shards = splitTrackMonths(body);
  const touched = new Set(shards.map((s) => s.month));
  // Also rewrite empty months that used to have data? Keep prior months listed in manifest
  // and overwrite shards we have; leave untouched months as-is unless variables deleted.
  const trackMonths = [...(next.trackMonths ?? [])];

  for (const shard of shards) {
    const folder = await ensureMonthFolder(token, next, shard.month);
    next = folder.manifest;
    const existing = trackMonths.find((t) => t.month === shard.month);
    const fileId = await uploadJson({
      token,
      name: trackMonthFileName(shard.month),
      parentId: folder.folderId,
      fileId: existing?.fileId,
      body: shard,
    });
    if (existing) {
      existing.fileId = fileId;
    } else {
      trackMonths.push({ month: shard.month, fileId });
    }
  }

  // Drop months with no remaining samples so Drive stays tidy.
  next = {
    ...next,
    trackMonths: trackMonths
      .filter((t) => touched.has(t.month))
      .sort((a, b) => b.month.localeCompare(a.month)),
  };
  await saveManifest(token, next);
  return next;
}

const CUSTOM_SKILLS_NAME = "custom-skills.json";

export async function loadCustomSkills(
  token: string,
  manifest: Manifest,
): Promise<CustomSkillsFile> {
  if (manifest.customSkillsFileId) {
    try {
      const loaded = await downloadJson<CustomSkillsFile>(token, manifest.customSkillsFileId);
      return { skills: loaded.skills ?? [] };
    } catch {
      return { skills: [] };
    }
  }
  return { skills: [] };
}

export async function saveCustomSkills(
  token: string,
  manifest: Manifest,
  body: CustomSkillsFile,
): Promise<Manifest> {
  const fileId = await uploadJson({
    token,
    name: CUSTOM_SKILLS_NAME,
    parentId: manifest.folderId,
    fileId: manifest.customSkillsFileId,
    body,
  });
  const next = { ...manifest, customSkillsFileId: fileId };
  await saveManifest(token, next);
  return next;
}

const ARTIFACTS_INDEX_NAME = "artifacts-index.json";

function artifactFileName(id: string): string {
  return `artifact-${id}.json`;
}

export async function loadArtifactsIndex(
  token: string,
  manifest: Manifest,
): Promise<ArtifactsIndex> {
  if (manifest.artifactsFileId) {
    try {
      const loaded = await downloadJson<ArtifactsIndex>(token, manifest.artifactsFileId);
      return { items: loaded.items ?? [] };
    } catch {
      return { items: [] };
    }
  }
  return { items: [] };
}

export async function loadArtifactFile(
  token: string,
  manifest: Manifest,
  id: string,
): Promise<ArtifactFile | null> {
  const row = (manifest.artifactFiles ?? []).find((a) => a.id === id);
  if (!row) return null;
  try {
    return await downloadJson<ArtifactFile>(token, row.fileId);
  } catch {
    return null;
  }
}

export async function saveArtifact(
  token: string,
  manifest: Manifest,
  artifact: ArtifactFile,
  index: ArtifactsIndex,
): Promise<{ manifest: Manifest; index: ArtifactsIndex }> {
  const existingFile = (manifest.artifactFiles ?? []).find((a) => a.id === artifact.id);
  const fileId = await uploadJson({
    token,
    name: artifactFileName(artifact.id),
    parentId: manifest.folderId,
    fileId: existingFile?.fileId,
    body: artifact,
  });

  const nextItems = [
    {
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      createdAt: artifact.createdAt,
      fileId,
      note: artifact.note,
    },
    ...index.items.filter((i) => i.id !== artifact.id),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const nextIndex: ArtifactsIndex = { items: nextItems };
  const indexFileId = await uploadJson({
    token,
    name: ARTIFACTS_INDEX_NAME,
    parentId: manifest.folderId,
    fileId: manifest.artifactsFileId,
    body: nextIndex,
  });

  const artifactFiles = [
    { id: artifact.id, fileId },
    ...(manifest.artifactFiles ?? []).filter((a) => a.id !== artifact.id),
  ];

  const nextManifest: Manifest = {
    ...manifest,
    artifactsFileId: indexFileId,
    artifactFiles,
  };
  await saveManifest(token, nextManifest);
  return { manifest: nextManifest, index: nextIndex };
}

export async function deleteArtifact(
  token: string,
  manifest: Manifest,
  id: string,
  index: ArtifactsIndex,
): Promise<{ manifest: Manifest; index: ArtifactsIndex }> {
  const row = (manifest.artifactFiles ?? []).find((a) => a.id === id);
  const fromIndex = index.items.find((i) => i.id === id);
  const fileId = row?.fileId ?? fromIndex?.fileId;
  if (fileId) await trashFile(token, fileId);

  const nextIndex: ArtifactsIndex = { items: index.items.filter((i) => i.id !== id) };
  const indexFileId = await uploadJson({
    token,
    name: ARTIFACTS_INDEX_NAME,
    parentId: manifest.folderId,
    fileId: manifest.artifactsFileId,
    body: nextIndex,
  });

  const nextManifest: Manifest = {
    ...manifest,
    artifactsFileId: indexFileId,
    artifactFiles: (manifest.artifactFiles ?? []).filter((a) => a.id !== id),
  };
  await saveManifest(token, nextManifest);
  return { manifest: nextManifest, index: nextIndex };
}
