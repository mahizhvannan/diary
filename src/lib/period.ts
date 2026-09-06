import { addDaysIso } from "./parse-date";
import { todayIsoDate } from "./dates";
import { dayCalorieTotals, dayMacroTotals } from "./nutrition";
import { samplesOnDate, allVariables } from "./track";
import type { CalorieDay, CollectionsFile, DayFile } from "./types";

export function weekdayMonday0(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (dow + 6) % 7;
}

export function weekRange(today = todayIsoDate()): { start: string; end: string } {
  const start = addDaysIso(today, -weekdayMonday0(today));
  const end = addDaysIso(start, 6);
  return { start, end };
}

export function monthRange(today = todayIsoDate()): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const end = addDaysIso(next, -1);
  return { start, end };
}

export function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

export type LogBound = { id: string; at: string };

export function collectLogBounds(
  dayFiles: DayFile[],
  calorieDays: CalorieDay[],
  collections?: CollectionsFile,
  rangeFilter?: { start: string; end: string },
): { startLogId: string; endLogId: string; logs: LogBound[] } {
  const logs: LogBound[] = [];
  for (const day of dayFiles) {
    for (const entry of day.entries) {
      logs.push({ id: entry.id, at: entry.updatedAt || entry.startedAt });
    }
  }
  for (const day of calorieDays) {
    for (const item of day.items) {
      logs.push({ id: item.id, at: item.at });
    }
  }
  if (collections) {
    for (const { variable } of allVariables(collections)) {
      for (const sample of variable.samples) {
        if (rangeFilter && (sample.date < rangeFilter.start || sample.date > rangeFilter.end)) {
          continue;
        }
        logs.push({ id: `${variable.id}:${sample.date}:${sample.at}`, at: sample.at });
      }
    }
  }
  logs.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return {
    logs,
    startLogId: logs[0]?.id ?? "",
    endLogId: logs[logs.length - 1]?.id ?? "",
  };
}

export function packedHash(packed: string): string {
  let h = 2166136261;
  for (let i = 0; i < packed.length; i++) {
    h ^= packed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function packPeriod(
  dayFiles: DayFile[],
  calorieDays: CalorieDay[],
  collections?: CollectionsFile,
  rangeFilter?: { start: string; end: string },
): string {
  const byDate = new Map<string, { diary?: DayFile; cal?: CalorieDay }>();
  for (const d of dayFiles) {
    byDate.set(d.date, { ...byDate.get(d.date), diary: d });
  }
  for (const c of calorieDays) {
    byDate.set(c.date, { ...byDate.get(c.date), cal: c });
  }
  if (collections) {
    for (const { variable } of allVariables(collections)) {
      for (const sample of variable.samples) {
        if (rangeFilter && (sample.date < rangeFilter.start || sample.date > rangeFilter.end)) {
          continue;
        }
        if (!byDate.has(sample.date)) byDate.set(sample.date, {});
      }
    }
  }
  const rows = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const range = rows.reduce(
    (s, [, row]) => {
      const tot = dayCalorieTotals(row.cal);
      const macros = dayMacroTotals(row.cal);
      return {
        eaten: s.eaten + tot.eaten,
        burned: s.burned + tot.burned,
        protein: s.protein + macros.protein,
        carbs: s.carbs + macros.carbs,
        fat: s.fat + macros.fat,
      };
    },
    { eaten: 0, burned: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const header = `Range totals: eaten ${Math.round(range.eaten)}kcal burned ${Math.round(range.burned)}kcal net ${Math.round(range.eaten - range.burned)}kcal · protein ${Math.round(range.protein)}g carbs ${Math.round(range.carbs)}g fat ${Math.round(range.fat)}g`;
  const body = rows
    .map(([date, row]) => {
      const tot = dayCalorieTotals(row.cal);
      const macros = dayMacroTotals(row.cal);
      const sessions = (row.diary?.entries ?? [])
        .map((e) => `${e.id}: ${e.title} — ${e.summary || "(no summary)"}`)
        .join("\n");
      const items = (row.cal?.items ?? [])
        .map((i) =>
          i.kind === "activity"
            ? `${i.id}: activity ${i.name} ${i.calories}kcal${i.minutes ? ` ${i.minutes}min` : ""}`
            : `${i.id}: food ${i.name} ${i.calories}kcal P ${i.protein}g C ${i.carbs}g F ${i.fat}g`,
        )
        .join("\n");
      const tracked = collections
        ? samplesOnDate(collections, date)
            .map((t) => `${t.name}${t.unit ? ` (${t.unit})` : ""}: ${t.value}`)
            .join("\n")
        : "";
      return `${date}\nNutrition eaten ${Math.round(tot.eaten)} burned ${Math.round(tot.burned)} net ${Math.round(tot.net)} goal ${row.cal?.goalKcal ?? "-"} · P ${Math.round(macros.protein)}g C ${Math.round(macros.carbs)}g F ${Math.round(macros.fat)}g\nDiary:\n${sessions || "(none)"}\nCalories:\n${items || "(none)"}\nTracked:\n${tracked || "(none)"}`;
    })
    .join("\n\n");
  return body ? `${header}\n\n${body}` : header;
}

export function normalizeQuestion(text: string): string {
  return text.replace(/@weekly\b|@monthly\b|@calories\b|@track\b/gi, "").replace(/^[:\s,-]+/, "").trim().toLowerCase();
}
