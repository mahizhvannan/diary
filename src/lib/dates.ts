export const TIMEZONE = "Asia/Kolkata";

export function todayIsoDate(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

export function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDayHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
  return utc.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIMEZONE,
  });
}

export function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function isoDate(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
