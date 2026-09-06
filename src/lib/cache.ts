import type {
  ArtifactFile,
  ArtifactsIndex,
  CalorieDay,
  CollectionsFile,
  CustomSkillsFile,
  DayFile,
  Manifest,
  MonthSummaryFile,
  PeriodQaFile,
} from "./types";

const DB = "diary-cache";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCachedManifest(): Promise<Manifest | null> {
  return (await idbGet<Manifest>("manifest")) ?? null;
}

export async function saveCachedManifest(manifest: Manifest): Promise<void> {
  await idbSet("manifest", manifest);
}

export async function loadCachedDay(date: string): Promise<DayFile | null> {
  return (await idbGet<DayFile>(`day:${date}`)) ?? null;
}

export async function saveCachedDay(day: DayFile): Promise<void> {
  await idbSet(`day:${day.date}`, day);
}

export async function deleteCachedCalorieDay(date: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(`cal:${date}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteCachedDay(date: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(`day:${date}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCachedCalorieDay(date: string): Promise<CalorieDay | null> {
  return (await idbGet<CalorieDay>(`cal:${date}`)) ?? null;
}

export async function saveCachedCalorieDay(day: CalorieDay): Promise<void> {
  await idbSet(`cal:${day.date}`, day);
}

export async function listCachedKeys(): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
    req.onerror = () => reject(req.error);
  });
}

export async function loadAllCachedDays(): Promise<Record<string, DayFile>> {
  const keys = await listCachedKeys();
  const out: Record<string, DayFile> = {};
  for (const key of keys) {
    if (!key.startsWith("day:")) continue;
    const day = await idbGet<DayFile>(key);
    if (day?.date) out[day.date] = day;
  }
  return out;
}

export async function loadAllCachedCalories(): Promise<Record<string, CalorieDay>> {
  const keys = await listCachedKeys();
  const out: Record<string, CalorieDay> = {};
  for (const key of keys) {
    if (!key.startsWith("cal:")) continue;
    const day = await idbGet<CalorieDay>(key);
    if (day?.date) out[day.date] = day;
  }
  return out;
}

export type PendingSync = {
  days: string[];
  calories: string[];
  collections: boolean;
};

export async function loadPendingSync(): Promise<PendingSync> {
  const loaded = (await idbGet<Partial<PendingSync>>("pendingSync")) ?? {};
  return {
    days: loaded.days ?? [],
    calories: loaded.calories ?? [],
    collections: Boolean(loaded.collections),
  };
}

export async function savePendingSync(pending: PendingSync): Promise<void> {
  await idbSet("pendingSync", {
    days: [...new Set(pending.days)],
    calories: [...new Set(pending.calories)],
    collections: Boolean(pending.collections),
  });
}

export async function markPending(kind: "days" | "calories", date: string): Promise<void> {
  const pending = await loadPendingSync();
  pending[kind] = [...new Set([...pending[kind], date])];
  await savePendingSync(pending);
}

export async function clearPending(kind: "days" | "calories", date: string): Promise<void> {
  const pending = await loadPendingSync();
  pending[kind] = pending[kind].filter((d) => d !== date);
  await savePendingSync(pending);
}

export async function markCollectionsPending(): Promise<void> {
  const pending = await loadPendingSync();
  pending.collections = true;
  await savePendingSync(pending);
}

export async function clearCollectionsPending(): Promise<void> {
  const pending = await loadPendingSync();
  pending.collections = false;
  await savePendingSync(pending);
}

export async function hasPendingSync(): Promise<boolean> {
  const pending = await loadPendingSync();
  return pending.days.length > 0 || pending.calories.length > 0 || pending.collections;
}

export async function loadCachedMonthSummary(month: string): Promise<MonthSummaryFile | null> {
  return (await idbGet<MonthSummaryFile>(`month:${month}`)) ?? null;
}

export async function saveCachedMonthSummary(file: MonthSummaryFile): Promise<void> {
  await idbSet(`month:${file.month}`, file);
}

export async function deleteCachedMonthSummary(month: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(`month:${month}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllCachedMonthSummaries(): Promise<Record<string, MonthSummaryFile>> {
  const keys = await listCachedKeys();
  const out: Record<string, MonthSummaryFile> = {};
  for (const key of keys) {
    if (!key.startsWith("month:")) continue;
    const file = await idbGet<MonthSummaryFile>(key);
    if (file?.month) out[file.month] = file;
  }
  return out;
}

export async function loadCachedPeriodQa(): Promise<PeriodQaFile> {
  return (await idbGet<PeriodQaFile>("periodQa")) ?? { answers: [] };
}

export async function saveCachedPeriodQa(file: PeriodQaFile): Promise<void> {
  await idbSet("periodQa", file);
}

export async function loadCachedCollections(): Promise<CollectionsFile> {
  return (await idbGet<CollectionsFile>("collections")) ?? { collections: [] };
}

export async function saveCachedCollections(file: CollectionsFile): Promise<void> {
  await idbSet("collections", file);
}

export async function loadCachedCustomSkills(): Promise<CustomSkillsFile> {
  return (await idbGet<CustomSkillsFile>("customSkills")) ?? { skills: [] };
}

export async function saveCachedCustomSkills(file: CustomSkillsFile): Promise<void> {
  await idbSet("customSkills", file);
}

export async function loadCachedArtifactsIndex(): Promise<ArtifactsIndex> {
  return (await idbGet<ArtifactsIndex>("artifactsIndex")) ?? { items: [] };
}

export async function saveCachedArtifactsIndex(index: ArtifactsIndex): Promise<void> {
  await idbSet("artifactsIndex", index);
}

export async function loadCachedArtifact(id: string): Promise<ArtifactFile | null> {
  return (await idbGet<ArtifactFile>(`artifact:${id}`)) ?? null;
}

export async function saveCachedArtifact(file: ArtifactFile): Promise<void> {
  await idbSet(`artifact:${file.id}`, file);
}

export async function deleteCachedArtifact(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(`artifact:${id}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCachedDaysForDates(dates: string[]): Promise<Record<string, DayFile>> {
  const out: Record<string, DayFile> = {};
  for (const date of dates) {
    const day = await loadCachedDay(date);
    if (day) out[date] = day;
  }
  return out;
}
