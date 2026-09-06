import JSZip from "jszip";
import {
  loadAllCachedCalories,
  loadAllCachedDays,
  loadAllCachedMonthSummaries,
  loadCachedCollections,
  loadCachedCustomSkills,
  loadCachedArtifactsIndex,
  loadCachedManifest,
  loadCachedPeriodQa,
} from "./cache";

export async function buildDiaryExportZip(): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder("diary-export");
  if (!root) throw new Error("Could not create zip");

  const manifest = await loadCachedManifest();
  const days = await loadAllCachedDays();
  const calories = await loadAllCachedCalories();
  const months = await loadAllCachedMonthSummaries();
  const periodQa = await loadCachedPeriodQa();
  const collections = await loadCachedCollections();
  const customSkills = await loadCachedCustomSkills();
  const artifactsIndex = await loadCachedArtifactsIndex();

  root.file("manifest.json", JSON.stringify(manifest ?? {}, null, 2));
  root.file("collections.json", JSON.stringify(collections, null, 2));
  root.file("custom-skills.json", JSON.stringify(customSkills, null, 2));
  root.file("artifacts-index.json", JSON.stringify(artifactsIndex, null, 2));
  root.file("period-qa.json", JSON.stringify(periodQa, null, 2));

  const daysFolder = root.folder("days");
  for (const day of Object.values(days).sort((a, b) => a.date.localeCompare(b.date))) {
    daysFolder?.file(`day-${day.date}.json`, JSON.stringify(day, null, 2));
  }

  const calFolder = root.folder("calories");
  for (const day of Object.values(calories).sort((a, b) => a.date.localeCompare(b.date))) {
    calFolder?.file(`cal-${day.date}.json`, JSON.stringify(day, null, 2));
  }

  const monthFolder = root.folder("month-summaries");
  for (const file of Object.values(months).sort((a, b) => a.month.localeCompare(b.month))) {
    monthFolder?.file(`month-${file.month}.json`, JSON.stringify(file, null, 2));
  }

  root.file(
    "README.txt",
    [
      "Diary export",
      `Exported at ${new Date().toISOString()}`,
      "",
      "Contents are from local IndexedDB cache (synced with Google Drive).",
      "API keys and AI settings are intentionally omitted.",
      "days/ — diary sessions",
      "calories/ — food and activity logs",
      "collections.json — trackable variables and samples",
      "custom-skills.json — user-defined @skills",
      "artifacts-index.json — logged Analyze artifacts metadata",
      "month-summaries/ — generated month summaries",
      "period-qa.json — cached @weekly/@monthly answers",
      "manifest.json — Drive index snapshot",
    ].join("\n"),
  );

  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
