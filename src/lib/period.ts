import { addDaysIso } from "./parse-date";
import { todayIsoDate } from "./dates";
import { dayCalorieTotals } from "./nutrition";
import type { CalorieDay, DayFile } from "./types";

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
  logs.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return {
    logs,
    startLogId: logs[0]?.id ?? "",
    endLogId: logs[logs.length - 1]?.id ?? "",
  };
}

export function packPeriod(
  dayFiles: DayFile[],
  calorieDays: CalorieDay[],
): string {
  const byDate = new Map<string, { diary?: DayFile; cal?: CalorieDay }>();
  for (const d of dayFiles) {
    byDate.set(d.date, { ...byDate.get(d.date), diary: d });
  }
  for (const c of calorieDays) {
    byDate.set(c.date, { ...byDate.get(c.date), cal: c });
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => {
      const tot = dayCalorieTotals(row.cal);
      const sessions = (row.diary?.entries ?? [])
        .map((e) => `${e.id}: ${e.title} — ${e.summary || "(no summary)"}`)
        .join("\n");
      const items = (row.cal?.items ?? [])
        .map((i) => `${i.id}: ${i.kind} ${i.name} ${i.calories}kcal`)
        .join("\n");
      return `${date}\nNutrition eaten ${tot.eaten} burned ${tot.burned} net ${tot.net} goal ${row.cal?.goalKcal ?? "-"}\nDiary:\n${sessions || "(none)"}\nCalories:\n${items || "(none)"}`;
    })
    .join("\n\n");
}

export function normalizeQuestion(text: string): string {
  return text.replace(/@weekly\b|@monthly\b|@calories\b/gi, "").replace(/^[:\s,-]+/, "").trim().toLowerCase();
}
