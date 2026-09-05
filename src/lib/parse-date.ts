import { TIMEZONE, todayIsoDate } from "./dates";

export function addDaysIso(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Resolve which calendar day a calorie note belongs to. Chat/diary log can stay today. */
export function parseCalorieLogDate(note: string, today = todayIsoDate()): string {
  const t = note.toLowerCase();
  const iso = note.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  if (/\bday before yesterday\b|\b2 days ago\b/.test(t)) return addDaysIso(today, -2);
  if (/\byesterday\b|\blast night\b/.test(t)) return addDaysIso(today, -1);
  if (/\btoday\b|\btonight\b/.test(t)) return today;
  return today;
}

export { TIMEZONE };
