import type { CalorieDay, DayFile, Manifest, MonthSummaryFile, PeriodQaFile, RecentSession } from "./types";
import { DEFAULT_CALORIE_GOAL } from "./nutrition";

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

async function createFolder(token: string): Promise<string> {
  const file = await driveJson<DriveFile>(token, `${DRIVE}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { diary: "1" },
    }),
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
  await driveJson(token, `${DRIVE}/files/${fileId}`, { method: "DELETE" });
}

export async function ensureDiaryStore(token: string): Promise<Manifest> {
  const folder = await findFile(
    token,
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const folderId = folder?.id ?? (await createFolder(token));

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
  const fileId = await uploadJson({
    token,
    name: dayFileName(day.date),
    parentId: manifest.folderId,
    fileId: existing?.fileId,
    body: day,
  });

  const tags = Array.from(
    new Set(day.entries.flatMap((e) => e.tags)),
  );
  const row = {
    date: day.date,
    fileId,
    summary: day.summary,
    tags,
    entryCount: day.entries.length,
  };

  const days = existing
    ? manifest.days.map((d) => (d.date === day.date ? row : d))
    : [...manifest.days, row].sort((a, b) => b.date.localeCompare(a.date));

  const next = {
    ...manifest,
    days,
    recentSessions: mergeRecent(manifest.recentSessions, day),
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
  const fileId = await uploadJson({
    token,
    name: calorieFileName(day.date),
    parentId: manifest.folderId,
    fileId: existing?.fileId,
    body: day,
  });
  const row = { date: day.date, fileId };
  const calorieDays = existing
    ? (manifest.calorieDays ?? []).map((d) => (d.date === day.date ? row : d))
    : [...(manifest.calorieDays ?? []), row].sort((a, b) => b.date.localeCompare(a.date));
  const next = { ...manifest, calorieDays };
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
