import {
  clearCollectionsPending,
  clearPending,
  loadAllCachedCalories,
  loadAllCachedDays,
  loadCachedCalorieDay,
  loadCachedCollections,
  loadCachedDay,
  loadCachedManifest,
  loadPendingSync,
  saveCachedCalorieDay,
  saveCachedCollections,
  saveCachedDay,
  saveCachedManifest,
} from "./cache";
import {
  loadCalorieFile,
  loadCollections,
  loadDayFile,
  saveCalorieFile,
  saveCollections,
  saveDayFile,
} from "./drive";
import type { CalorieDay, CollectionsFile, DayFile, Manifest } from "./types";

export type ManualSyncResult = {
  pushedDays: number;
  pulledDays: number;
  pushedCalories: number;
  pulledCalories: number;
  collections: "pushed" | "pulled" | "same" | "none";
  summary: string;
};

function maxIso(...values: (string | undefined | null)[]): string {
  let best = "";
  for (const v of values) {
    if (v && v > best) best = v;
  }
  return best;
}

/** Latest activity stamp inside a diary day file. */
export function dayContentStamp(day: DayFile | null | undefined): string {
  if (!day?.entries.length) return "";
  return maxIso(...day.entries.map((e) => e.updatedAt));
}

export function calorieContentStamp(day: CalorieDay | null | undefined): string {
  if (!day?.items.length) return "";
  return maxIso(...day.items.map((i) => i.at));
}

export function collectionsContentStamp(file: CollectionsFile | null | undefined): string {
  if (!file) return "";
  const stamps: string[] = [];
  for (const c of file.collections) {
    for (const v of c.variables) {
      for (const s of v.samples) stamps.push(s.at);
    }
  }
  return maxIso(...stamps);
}

function preferLocal(localStamp: string, remoteStamp: string): boolean {
  if (!remoteStamp) return true;
  if (!localStamp) return false;
  // Equal → local (usually ahead / same write).
  return localStamp >= remoteStamp;
}

/**
 * Bidirectional reconcile: for each day/calorie/collections blob, keep the
 * newer content (by embedded timestamps) and write the loser side up to date.
 */
export async function runManualSync(opts: {
  token: string;
  manifest: Manifest;
}): Promise<{
  manifest: Manifest;
  days: Record<string, DayFile>;
  calories: Record<string, CalorieDay>;
  collections: CollectionsFile;
  result: ManualSyncResult;
}> {
  const { token } = opts;
  let manifest = opts.manifest;

  const result: ManualSyncResult = {
    pushedDays: 0,
    pulledDays: 0,
    pushedCalories: 0,
    pulledCalories: 0,
    collections: "none",
    summary: "",
  };

  // 1) Flush explicit pending local writes first.
  const pending = await loadPendingSync();
  for (const date of pending.days) {
    const local = await loadCachedDay(date);
    if (!local) {
      await clearPending("days", date);
      continue;
    }
    manifest = await saveDayFile(token, manifest, local);
    await saveCachedManifest(manifest);
    await clearPending("days", date);
    result.pushedDays += 1;
  }
  for (const date of (await loadPendingSync()).calories) {
    const local = await loadCachedCalorieDay(date);
    if (!local) {
      await clearPending("calories", date);
      continue;
    }
    manifest = await saveCalorieFile(token, manifest, local);
    await saveCachedManifest(manifest);
    await clearPending("calories", date);
    result.pushedCalories += 1;
  }
  if ((await loadPendingSync()).collections) {
    const localCols = await loadCachedCollections();
    manifest = await saveCollections(token, manifest, localCols);
    await saveCachedManifest(manifest);
    await clearCollectionsPending();
    result.collections = "pushed";
  }

  const localDays = await loadAllCachedDays();
  const localCals = await loadAllCachedCalories();
  const dayDates = new Set<string>([
    ...Object.keys(localDays),
    ...manifest.days.map((d) => d.date),
  ]);
  const calDates = new Set<string>([
    ...Object.keys(localCals),
    ...(manifest.calorieDays ?? []).map((d) => d.date),
  ]);

  const outDays: Record<string, DayFile> = { ...localDays };
  const outCals: Record<string, CalorieDay> = { ...localCals };

  for (const date of [...dayDates].sort()) {
    const local = localDays[date] ?? null;
    const remote = manifest.days.some((d) => d.date === date)
      ? await loadDayFile(token, manifest, date)
      : null;
    const ls = dayContentStamp(local);
    const rs = dayContentStamp(remote);

    if (local && !remote) {
      manifest = await saveDayFile(token, manifest, local);
      await saveCachedManifest(manifest);
      result.pushedDays += 1;
      outDays[date] = local;
      continue;
    }
    if (remote && !local) {
      await saveCachedDay(remote);
      outDays[date] = remote;
      result.pulledDays += 1;
      continue;
    }
    if (local && remote) {
      if (preferLocal(ls, rs)) {
        if (ls !== rs) {
          manifest = await saveDayFile(token, manifest, local);
          await saveCachedManifest(manifest);
          result.pushedDays += 1;
        }
        outDays[date] = local;
      } else {
        await saveCachedDay(remote);
        outDays[date] = remote;
        result.pulledDays += 1;
      }
    }
  }

  for (const date of [...calDates].sort()) {
    const local = localCals[date] ?? null;
    const remote = (manifest.calorieDays ?? []).some((d) => d.date === date)
      ? await loadCalorieFile(token, manifest, date)
      : null;
    const ls = calorieContentStamp(local);
    const rs = calorieContentStamp(remote);

    if (local && !remote) {
      manifest = await saveCalorieFile(token, manifest, local);
      await saveCachedManifest(manifest);
      result.pushedCalories += 1;
      outCals[date] = local;
      continue;
    }
    if (remote && !local) {
      await saveCachedCalorieDay(remote);
      outCals[date] = remote;
      result.pulledCalories += 1;
      continue;
    }
    if (local && remote) {
      if (preferLocal(ls, rs)) {
        if (ls !== rs) {
          manifest = await saveCalorieFile(token, manifest, local);
          await saveCachedManifest(manifest);
          result.pushedCalories += 1;
        }
        outCals[date] = local;
      } else {
        await saveCachedCalorieDay(remote);
        outCals[date] = remote;
        result.pulledCalories += 1;
      }
    }
  }

  const localCols = await loadCachedCollections();
  const remoteCols = await loadCollections(token, manifest);
  const cls = collectionsContentStamp(localCols);
  const crs = collectionsContentStamp(remoteCols);
  let collections = localCols;

  if (!cls && !crs) {
    result.collections = result.collections === "pushed" ? "pushed" : "none";
  } else if (preferLocal(cls, crs)) {
    if (cls && cls !== crs) {
      manifest = await saveCollections(token, manifest, localCols);
      await saveCachedManifest(manifest);
      result.collections = "pushed";
    } else if (result.collections !== "pushed") {
      result.collections = cls || crs ? "same" : "none";
    }
    collections = localCols;
  } else {
    await saveCachedCollections(remoteCols);
    collections = remoteCols;
    result.collections = "pulled";
  }

  await saveCachedManifest(manifest);

  const parts = [
    result.pulledDays || result.pushedDays
      ? `days +${result.pushedDays}/↓${result.pulledDays}`
      : null,
    result.pulledCalories || result.pushedCalories
      ? `calories +${result.pushedCalories}/↓${result.pulledCalories}`
      : null,
    result.collections !== "none" && result.collections !== "same"
      ? `collections ${result.collections}`
      : null,
  ].filter(Boolean);
  result.summary = parts.length ? `Synced (${parts.join(", ")})` : "Already in sync";

  return { manifest, days: outDays, calories: outCals, collections, result };
}
