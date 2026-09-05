import type { CalorieDay, DayFile, Manifest, MonthSummaryFile, PeriodQaFile } from "./types";

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

export type PendingSync = { days: string[]; calories: string[] };

export async function loadPendingSync(): Promise<PendingSync> {
  return (await idbGet<PendingSync>("pendingSync")) ?? { days: [], calories: [] };
}

export async function savePendingSync(pending: PendingSync): Promise<void> {
  await idbSet("pendingSync", {
    days: [...new Set(pending.days)],
    calories: [...new Set(pending.calories)],
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

export async function loadCachedMonthSummary(month: string): Promise<MonthSummaryFile | null> {
  return (await idbGet<MonthSummaryFile>(`month:${month}`)) ?? null;
}

export async function saveCachedMonthSummary(file: MonthSummaryFile): Promise<void> {
  await idbSet(`month:${file.month}`, file);
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

export async function loadCachedDaysForDates(dates: string[]): Promise<Record<string, DayFile>> {
  const out: Record<string, DayFile> = {};
  for (const date of dates) {
    const day = await loadCachedDay(date);
    if (day) out[date] = day;
  }
  return out;
}
