import type { DiarySnapshot } from "./analyze-types";

const MAX_CHARS = 120_000;

/** Pack IndexedDB snapshot text for Gemini Analyze (no local agent workspace). */
export function packDiarySnapshotForAnalyze(snapshot: DiarySnapshot): string {
  const parts: string[] = [];

  parts.push("## Collections");
  parts.push(JSON.stringify(snapshot.collections ?? { collections: [] }));

  parts.push("\n## Custom skills");
  parts.push(JSON.stringify(snapshot.customSkills ?? { skills: [] }));

  const days = Object.entries(snapshot.days ?? {}).sort(([a], [b]) => a.localeCompare(b));
  parts.push(`\n## Diary days (${days.length})`);
  for (const [date, day] of days) {
    parts.push(`### ${date}\n${JSON.stringify(day)}`);
  }

  const cals = Object.entries(snapshot.calories ?? {}).sort(([a], [b]) => a.localeCompare(b));
  parts.push(`\n## Calorie days (${cals.length})`);
  for (const [date, day] of cals) {
    parts.push(`### ${date}\n${JSON.stringify(day)}`);
  }

  const months = Object.entries(snapshot.monthSummaries ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (months.length) {
    parts.push(`\n## Month summaries (${months.length})`);
    for (const [month, file] of months) {
      parts.push(`### ${month}\n${JSON.stringify(file)}`);
    }
  }

  let out = parts.join("\n");
  if (out.length > MAX_CHARS) {
    out =
      out.slice(0, MAX_CHARS) +
      `\n\n…truncated (${out.length} chars total). Prefer recent dates if needed.`;
  }
  return out;
}
