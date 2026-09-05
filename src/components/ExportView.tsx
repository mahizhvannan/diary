"use client";

import { useMemo, useState } from "react";
import { callGemini } from "../lib/gemini-client";
import { addDaysIso } from "../lib/parse-date";
import { dayCalorieTotals } from "../lib/nutrition";
import { todayIsoDate } from "../lib/dates";
import type { CalorieDay, DayFile } from "../lib/types";

type Point = { date: string; eaten: number; burned: number; net: number };

type Props = {
  calories: Record<string, CalorieDay>;
  days: Record<string, DayFile>;
  onNeedRange: (start: string, end: string) => Promise<void>;
};

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

function Chart({ points }: { points: Point[] }) {
  const w = 640;
  const h = 220;
  const pad = 28;
  const max = Math.max(1, ...points.flatMap((p) => [p.eaten, p.burned, Math.abs(p.net)]));
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const path = (key: "eaten" | "burned" | "net") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(Math.max(0, p[key]))}`).join(" ");

  if (points.length === 0) return <p className="text-sm text-ink-mute">No calorie points in range.</p>;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-3xl text-ink" role="img">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="currentColor" opacity="0.3" />
      <path d={path("eaten")} fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d={path("burned")} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 3" />
      <path d={path("net")} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
    </svg>
  );
}

export function ExportView({ calories, days, onNeedRange }: Props) {
  const today = todayIsoDate();
  const [start, setStart] = useState(() => addDaysIso(today, -6));
  const [end, setEnd] = useState(today);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const span = useMemo(() => eachDate(start, end), [start, end]);
  const tooLong = span.length > 31 || start > end;

  const points: Point[] = span.map((date) => ({
    date,
    ...dayCalorieTotals(calories[date]),
  }));

  const runSummary = async () => {
    if (tooLong) return;
    setBusy(true);
    setError(null);
    try {
      await onNeedRange(start, end);
      const packed = span
        .map((date) => {
          const tot = dayCalorieTotals(calories[date]);
          const diary = (days[date]?.entries ?? []).map((e) => e.summary || e.title).join(" | ");
          return `${date}: eaten ${tot.eaten} burned ${tot.burned} net ${tot.net}. ${diary}`;
        })
        .join("\n");
      const result = await callGemini({ mode: "range_summary", start, end, packed });
      if (!result.ok) setError(result.message);
      else if (result.mode === "range_summary") setSummary(result.data.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Summary failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <h1 className="flex items-baseline gap-2 font-serif text-2xl">
        Export
        <span className="rounded-sm bg-accent px-1.5 py-0.5 font-sans text-[10px] tracking-wide text-paper uppercase">
          beta
        </span>
      </h1>
      <p className="mt-1 text-sm text-ink-mute">
        Range is at most one month. Solid line is eaten, dashed is burned, faint is net.
      </p>
      <div className="mt-6 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          Start
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 block border border-ink/20 bg-paper px-2 py-1 text-ink"
          />
        </label>
        <label className="text-sm">
          End
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 block border border-ink/20 bg-paper px-2 py-1 text-ink"
          />
        </label>
        <button
          type="button"
          disabled={busy || tooLong}
          onClick={runSummary}
          className="border border-ink bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-40"
        >
          {busy ? "Working…" : "Summarize range"}
        </button>
      </div>
      {tooLong ? (
        <p className="mt-3 text-sm">Pick at most 31 days, with start on or before end.</p>
      ) : null}
      {error ? <p className="mt-3 text-sm">{error}</p> : null}
      <div className="mt-8">
        <Chart points={tooLong ? [] : points} />
        <p className="mt-2 text-xs text-ink-mute">eaten — burned - - - net · · ·</p>
      </div>
      {summary ? (
        <p className="mt-8 max-w-2xl font-serif text-[17px] leading-7">{summary}</p>
      ) : null}
    </div>
  );
}
