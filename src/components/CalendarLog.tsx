"use client";

import { useEffect, useState } from "react";
import { isoDate, monthLabel, shiftMonth } from "../lib/dates";
import { nutritionHeadline } from "../lib/nutrition";
import { monthKey } from "../lib/period";
import type { CalorieDay, DayFile, MonthSummaryFile } from "../lib/types";

type Props = {
  markedDates: Set<string>;
  days: Record<string, DayFile>;
  calories: Record<string, CalorieDay>;
  onOpenDay: (date: string) => void;
  selected?: {
    date: string;
    day: DayFile | null;
    calories: CalorieDay | null;
    tracked: { name: string; unit: string; value: number }[];
  } | null;
  onCloseDay: () => void;
  onDeleteSession: (date: string, entryId: string) => void;
  onDeleteCalorieItem: (date: string, itemId: string) => void;
  onDeleteCalorieDay: (date: string) => void;
  onDeleteDiaryDay: (date: string) => void;
  monthSummaries: Record<string, MonthSummaryFile>;
  generatingMonth: boolean;
  onGenerateMonth: (year: number, month: number) => void;
  onDeleteMonthSummary: (year: number, month: number) => void;
  onNeedMonthSummary: (year: number, month: number) => void;
};

function monthHasRealLogs(
  key: string,
  days: Record<string, DayFile>,
  calories: Record<string, CalorieDay>,
): boolean {
  for (const [date, day] of Object.entries(days)) {
    if (date.startsWith(`${key}-`) && day.entries.length > 0) return true;
  }
  for (const [date, day] of Object.entries(calories)) {
    if (date.startsWith(`${key}-`) && day.items.length > 0) return true;
  }
  return false;
}

export function CalendarLog({
  markedDates,
  days,
  calories,
  onOpenDay,
  selected,
  onCloseDay,
  onDeleteSession,
  onDeleteCalorieItem,
  onDeleteCalorieDay,
  onDeleteDiaryDay,
  monthSummaries,
  generatingMonth,
  onGenerateMonth,
  onDeleteMonthSummary,
  onNeedMonthSummary,
}: Props) {
  const now = new Date();
  const [{ year, month }, setMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth(),
  });

  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: (first + 6) % 7 }, () => null),
    ...Array.from({ length: dim }, (_, i) => i + 1),
  ];

  const diaryCount = selected?.day?.entries.length ?? 0;
  const calCount = selected?.calories?.items.length ?? 0;
  const key = monthKey(year, month);
  const hasMonthData = monthHasRealLogs(key, days, calories);
  const monthSummary = monthSummaries[key];
  const showMonthBlock =
    hasMonthData ||
    Boolean(monthSummary) ||
    [...markedDates].some((d) => d.startsWith(`${key}-`));
  const staleSummary = Boolean(monthSummary) && !hasMonthData;

  useEffect(() => {
    onNeedMonthSummary(year, month);
  }, [year, month, onNeedMonthSummary]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="border-b border-ink/15 px-6 py-4">
        <h1 className="font-serif text-2xl">Logs</h1>
        <p className="mt-1 text-sm text-ink-mute">
          One month at a time. Scroll or use arrows. Circled days have diary, calorie, or tracked
          logs.
        </p>
      </header>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) < 20) return;
          e.preventDefault();
          setMonth((m) => shiftMonth(m.year, m.month, e.deltaY > 0 ? 1 : -1));
        }}
      >
        <div className="mb-6 flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-ink-mute"
            onClick={() => setMonth((m) => shiftMonth(m.year, m.month, -1))}
          >
            Previous
          </button>
          <h2 className="font-serif text-xl">{monthLabel(year, month)}</h2>
          <button
            type="button"
            className="text-sm text-ink-mute"
            onClick={() => setMonth((m) => shiftMonth(m.year, m.month, 1))}
          >
            Next
          </button>
        </div>
        <div className="grid grid-cols-7 gap-y-3 text-center text-xs text-ink-mute">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={`${d}-${i}`}>{d}</div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-7 gap-y-3 text-center">
          {cells.map((day, i) => {
            if (!day) return <div key={`e-${i}`} />;
            const date = isoDate(year, month, day);
            const marked = markedDates.has(date);
            return (
              <button
                key={date}
                type="button"
                onClick={() => onOpenDay(date)}
                className={`mx-auto flex h-10 w-10 items-center justify-center text-sm ${
                  marked ? "rounded-full border border-accent text-ink" : "text-ink"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
        {showMonthBlock ? (
          <div className="mt-8 border-t border-ink/10 pt-5">
            {staleSummary ? (
              <p className="mb-3 text-sm text-ink-mute">
                Stale summary — no diary or calorie logs left in this month.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {hasMonthData ? (
                <button
                  type="button"
                  disabled={generatingMonth}
                  onClick={() => onGenerateMonth(year, month)}
                  className="border border-ink bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-40"
                >
                  {generatingMonth
                    ? "Working…"
                    : monthSummary
                      ? "Regenerate monthly summary"
                      : "Generate monthly summary"}
                </button>
              ) : null}
              {monthSummary ? (
                <button
                  type="button"
                  className="border border-ink/40 px-3 py-1.5 text-sm text-ink"
                  onClick={() => {
                    if (confirm(`Delete the monthly summary for ${monthLabel(year, month)}?`)) {
                      onDeleteMonthSummary(year, month);
                    }
                  }}
                >
                  Delete monthly summary
                </button>
              ) : null}
            </div>
            {monthSummary ? (
              <p className="mt-4 font-serif text-[16px] leading-7">{monthSummary.summary}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/20 p-4 md:items-center">
          <div className="max-h-[85%] w-full max-w-lg overflow-y-auto border border-ink/20 bg-paper p-5">
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-serif text-xl">{selected.date}</h3>
              <button type="button" className="text-sm text-ink-mute" onClick={onCloseDay}>
                Close
              </button>
            </div>
            <p className="mt-3 border-b border-ink/10 pb-3 text-sm">
              {nutritionHeadline(selected.calories)}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {diaryCount > 0 ? (
                <button
                  type="button"
                  className="border border-ink/30 px-2 py-1 text-xs text-ink-mute"
                  onClick={() => onDeleteDiaryDay(selected.date)}
                >
                  Delete diary day
                </button>
              ) : null}
              {calCount > 0 ? (
                <button
                  type="button"
                  className="border border-ink/30 px-2 py-1 text-xs text-ink-mute"
                  onClick={() => onDeleteCalorieDay(selected.date)}
                >
                  Delete calorie log
                </button>
              ) : null}
            </div>

            <h4 className="mt-5 text-xs tracking-[0.14em] text-ink-mute uppercase">Diary</h4>
            <ul className="mt-2 flex flex-col gap-4">
              {(selected.day?.entries ?? []).length === 0 ? (
                <li className="text-sm text-ink-mute">No diary logs this day.</li>
              ) : (
                selected.day!.entries.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-serif text-base">{e.title}</p>
                      <p className="mt-1 text-sm leading-6 text-ink-mute">
                        {e.summary || "No summary."}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-ink-mute"
                      onClick={() => onDeleteSession(selected.date, e.id)}
                    >
                      Delete
                    </button>
                  </li>
                ))
              )}
            </ul>

            <h4 className="mt-6 text-xs tracking-[0.14em] text-ink-mute uppercase">Calories</h4>
            <ul className="mt-2 flex flex-col gap-3">
              {calCount === 0 ? (
                <li className="text-sm text-ink-mute">No calorie items this day.</li>
              ) : (
                selected.calories!.items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      {item.kind === "activity" ? "Activity" : "Food"} · {item.name} ·{" "}
                      {item.calories} kcal
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-ink-mute"
                      onClick={() => onDeleteCalorieItem(selected.date, item.id)}
                    >
                      Delete
                    </button>
                  </li>
                ))
              )}
            </ul>

            <h4 className="mt-6 text-xs tracking-[0.14em] text-ink-mute uppercase">Tracked</h4>
            <ul className="mt-2 flex flex-col gap-2">
              {(selected.tracked ?? []).length === 0 ? (
                <li className="text-sm text-ink-mute">No collection variables this day.</li>
              ) : (
                selected.tracked.map((row) => (
                  <li key={row.name} className="text-sm">
                    {row.name}
                    {row.unit ? ` (${row.unit})` : ""} · {row.value}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
