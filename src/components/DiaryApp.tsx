"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarLog } from "../components/CalendarLog";
import { ChatPane } from "../components/ChatPane";
import { ExportView } from "../components/ExportView";
import { IconRail, SettingsPanel } from "../components/IconRail";
import { SessionList } from "../components/SessionList";
import {
  clearPending,
  deleteCachedCalorieDay,
  deleteCachedDay,
  loadAllCachedCalories,
  loadAllCachedDays,
  loadAllCachedMonthSummaries,
  loadCachedCalorieDay,
  loadCachedDay,
  loadCachedManifest,
  loadCachedMonthSummary,
  loadCachedPeriodQa,
  loadPendingSync,
  markPending,
  saveCachedCalorieDay,
  saveCachedDay,
  saveCachedManifest,
  saveCachedMonthSummary,
  saveCachedPeriodQa,
} from "../lib/cache";
import { TIMEZONE, todayIsoDate } from "../lib/dates";
import {
  deleteCalorieFile,
  deleteDayFile,
  ensureDiaryStore,
  loadCalorieFile,
  loadDayFile,
  loadMonthSummary,
  loadPeriodQa,
  saveCalorieFile,
  saveDayFile,
  saveMonthSummary,
  savePeriodQa,
} from "../lib/drive";
import { callGemini, emptyDay } from "../lib/gemini-client";
import { dataUrlToImage, fileToAttachment } from "../lib/images";
import { isRetrievalQuery } from "../lib/intent";
import {
  DEFAULT_CALORIE_GOAL,
  emptyCalorieDay,
  formatNutritionReply,
} from "../lib/nutrition";
import { packDaysForLlm, searchSummaryDates } from "../lib/search";
import { parseCalorieLogDate, addDaysIso } from "../lib/parse-date";
import {
  collectLogBounds,
  datesInRange,
  monthKey,
  monthRange,
  packPeriod,
  normalizeQuestion,
  weekRange,
} from "../lib/period";
import { extractCaloriesNote, extractPeriodAsk } from "../lib/skills";
import type {
  CalorieDay,
  ChatAttachment,
  ChatMessage,
  DayFile,
  DiaryEntry,
  Manifest,
  MonthSummaryFile,
  PeriodQaFile,
} from "../lib/types";
import { useGoogleDriveToken } from "../lib/use-google-drive";
import { useTheme } from "../lib/theme";

const SIDEBAR_LIMIT = 20;

function freshEntry(): DiaryEntry {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    startedAt: now,
    updatedAt: now,
    title: "New session",
    tags: [],
    summary: "",
    messages: [],
    savedToDrive: false,
  };
}

function msg(role: ChatMessage["role"], text: string, attachments?: ChatAttachment[]): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    at: new Date().toISOString(),
    attachments,
  };
}

function listSessions(
  days: Record<string, DayFile>,
  current: DiaryEntry,
  currentDate: string,
) {
  const byId = new Map<string, { date: string; entry: DiaryEntry }>();
  for (const day of Object.values(days)) {
    for (const entry of day.entries) {
      byId.set(entry.id, { date: day.date, entry: { ...entry, savedToDrive: true } });
    }
  }
  if (current.messages.length > 0 || byId.has(current.id)) {
    byId.set(current.id, { date: currentDate, entry: current });
  }
  return [...byId.values()].sort((a, b) =>
    b.entry.updatedAt.localeCompare(a.entry.updatedAt),
  );
}

function upsertEntry(day: DayFile, entry: DiaryEntry, daySummary?: string): DayFile {
  const exists = day.entries.some((e) => e.id === entry.id);
  const entries = exists
    ? day.entries.map((e) => (e.id === entry.id ? entry : e))
    : [...day.entries, entry];
  return {
    ...day,
    summary: daySummary ?? day.summary,
    entries,
  };
}

export function DiaryApp() {
  const { token, ready, hydrating, error: authError, connect, disconnect } =
    useGoogleDriveToken();
  const { theme, toggle } = useTheme();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [days, setDays] = useState<Record<string, DayFile>>({});
  const [calories, setCalories] = useState<Record<string, CalorieDay>>({});
  const [current, setCurrent] = useState<DiaryEntry>(() => freshEntry());
  const [currentDate, setCurrentDate] = useState(todayIsoDate);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"chat" | "log" | "export">("chat");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [phonePreview, setPhonePreview] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [monthSummaries, setMonthSummaries] = useState<Record<string, MonthSummaryFile>>({});
  const [periodQa, setPeriodQa] = useState<PeriodQaFile>({ answers: [] });
  const [generatingMonth, setGeneratingMonth] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const persistDay = useCallback(
    async (nextManifest: Manifest | null, day: DayFile, access: string | null) => {
      setDays((prev) => ({ ...prev, [day.date]: day }));
      await saveCachedDay(day);
      await markPending("days", day.date);
      if (!access || !nextManifest) return nextManifest;
      const savedManifest = await saveDayFile(access, nextManifest, day);
      setManifest(savedManifest);
      await saveCachedManifest(savedManifest);
      await clearPending("days", day.date);
      return savedManifest;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCachedManifest();
      if (cancelled) return;
      if (cached) setManifest(cached);
      const loaded = await loadAllCachedDays();
      if (!cancelled) setDays(loaded);
      const cal = await loadAllCachedCalories();
      if (!cancelled) setCalories(cal);
      const months = await loadAllCachedMonthSummaries();
      if (!cancelled) setMonthSummaries(months);
      const qa = await loadCachedPeriodQa();
      if (!cancelled) setPeriodQa(qa);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      try {
        const store = await ensureDiaryStore(token);
        if (cancelled) return;
        setManifest(store);
        await saveCachedManifest(store);
        const pending = await loadPendingSync();
        for (const date of pending.days) {
          const local = await loadCachedDay(date);
          if (local) {
            const next = await saveDayFile(token, store, local);
            if (!cancelled) setManifest(next);
            await saveCachedManifest(next);
            await clearPending("days", date);
          }
        }
        const pendingAfter = await loadPendingSync();
        let calManifest = (await loadCachedManifest()) ?? store;
        for (const date of pendingAfter.calories) {
          const local = await loadCachedCalorieDay(date);
          if (local) {
            calManifest = await saveCalorieFile(token, calManifest, local);
            if (!cancelled) setManifest(calManifest);
            await saveCachedManifest(calManifest);
            await clearPending("calories", date);
          }
        }
        const latest = (await loadCachedManifest()) ?? store;
        for (const row of latest.days) {
          const cached = await loadCachedDay(row.date);
          if (cached) continue;
          const remote = await loadDayFile(token, latest, row.date);
          if (remote) {
            await saveCachedDay(remote);
            if (!cancelled) setDays((prev) => ({ ...prev, [row.date]: remote }));
          }
        }
        for (const row of latest.calorieDays ?? []) {
          const cached = await loadCachedCalorieDay(row.date);
          if (cached) continue;
          const remote = await loadCalorieFile(token, latest, row.date);
          if (remote) {
            await saveCachedCalorieDay(remote);
            if (!cancelled) setCalories((prev) => ({ ...prev, [row.date]: remote }));
          }
        }
        for (const row of latest.monthSummaries ?? []) {
          const cached = await loadCachedMonthSummary(row.month);
          if (cached) {
            if (!cancelled) setMonthSummaries((prev) => ({ ...prev, [row.month]: cached }));
            continue;
          }
          const remote = await loadMonthSummary(token, latest, row.month);
          if (remote) {
            await saveCachedMonthSummary(remote);
            if (!cancelled) setMonthSummaries((prev) => ({ ...prev, [row.month]: remote }));
          }
        }
        const qa = await loadPeriodQa(token, latest);
        await saveCachedPeriodQa(qa);
        if (!cancelled) setPeriodQa(qa);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Drive load failed");
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const sessions = useMemo(
    () => listSessions(days, current, currentDate).slice(0, SIDEBAR_LIMIT),
    [days, current, currentDate],
  );

  const savedToDrive = Boolean(
    current.savedToDrive ||
      Object.values(days).some((d) => d.entries.some((e) => e.id === current.id)),
  );

  const markedDates = useMemo(() => {
    const s = new Set<string>();
    for (const d of manifest?.days ?? []) s.add(d.date);
    for (const d of manifest?.calorieDays ?? []) s.add(d.date);
    for (const d of Object.keys(days)) s.add(d);
    for (const d of Object.keys(calories)) s.add(d);
    return s;
  }, [manifest, days, calories]);

  const getDay = useCallback(
    (date: string): DayFile => days[date] ?? emptyDay(date, TIMEZONE),
    [days],
  );

  const loadDayIntoState = async (date: string): Promise<DayFile | null> => {
    if (days[date]) return days[date];
    const cached = await loadCachedDay(date);
    if (cached) {
      setDays((prev) => ({ ...prev, [date]: cached }));
      return cached;
    }
    if (!token || !manifest) return null;
    const remote = await loadDayFile(token, manifest, date);
    if (remote) {
      setDays((prev) => ({ ...prev, [date]: remote }));
      await saveCachedDay(remote);
    }
    return remote;
  };

  const loadCalIntoState = async (date: string): Promise<CalorieDay | null> => {
    if (calories[date]) return calories[date];
    const cached = await loadCachedCalorieDay(date);
    if (cached) {
      setCalories((prev) => ({ ...prev, [date]: cached }));
      return cached;
    }
    if (!token || !manifest) return null;
    const remote = await loadCalorieFile(token, manifest, date);
    if (remote) {
      setCalories((prev) => ({ ...prev, [date]: remote }));
      await saveCachedCalorieDay(remote);
    }
    return remote;
  };

  const onNew = () => {
    setCurrent(freshEntry());
    setCurrentDate(todayIsoDate());
    setDraft("");
    setPending([]);
    setError(null);
    setTab("chat");
    setSessionsOpen(false);
  };

  const onSelect = (date: string, entryId: string) => {
    const entry = days[date]?.entries.find((e) => e.id === entryId);
    if (!entry) return;
    setCurrent(entry);
    setCurrentDate(date);
    setDraft("");
    setPending([]);
    setError(null);
    setSessionsOpen(false);
  };

  const onDelete = async (date: string, entryId: string) => {
    if (!token || !manifest) {
      setError("Connect Google Drive first.");
      return;
    }
    if (!confirm("Delete this entire session (all messages in it)?")) return;
    setDeletingId(entryId);
    setError(null);
    try {
      const day = getDay(date);
      const nextEntries = day.entries.filter((e) => e.id !== entryId);
      if (nextEntries.length === 0) {
        const nextManifest = await deleteDayFile(token, manifest, date);
        setManifest(nextManifest);
        setDays((prev) => {
          const copy = { ...prev };
          delete copy[date];
          return copy;
        });
        await saveCachedManifest(nextManifest);
        await deleteCachedDay(date);
      } else {
        const nextDay: DayFile = {
          ...day,
          entries: nextEntries,
          summary: nextEntries.map((e) => e.summary).filter(Boolean).join(" "),
        };
        await persistDay(manifest, nextDay, token);
      }
      if (current.id === entryId) onNew();
      if (selectedDate === date) {
        const leftover = nextEntries.length;
        if (leftover === 0 && !(calories[date]?.items.length)) setSelectedDate(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const onDeleteDiaryDay = async (date: string) => {
    if (!token || !manifest) {
      setError("Connect Google Drive first.");
      return;
    }
    if (!confirm(`Delete all diary logs for ${date}? Calorie items stay unless you delete them separately.`)) {
      return;
    }
    setError(null);
    try {
      const nextManifest = await deleteDayFile(token, manifest, date);
      setManifest(nextManifest);
      setDays((prev) => {
        const copy = { ...prev };
        delete copy[date];
        return copy;
      });
      await saveCachedManifest(nextManifest);
      await deleteCachedDay(date);
      if (currentDate === date) onNew();
      if (selectedDate === date && !(calories[date]?.items.length)) setSelectedDate(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const onDeleteCalorieDay = async (date: string, skipConfirm = false) => {
    if (!token || !manifest) {
      setError("Connect Google Drive first.");
      return;
    }
    if (!skipConfirm && !confirm(`Delete the calorie log for ${date}?`)) return;
    setError(null);
    try {
      const nextManifest = await deleteCalorieFile(token, manifest, date);
      setManifest(nextManifest);
      setCalories((prev) => {
        const copy = { ...prev };
        delete copy[date];
        return copy;
      });
      await saveCachedManifest(nextManifest);
      await deleteCachedCalorieDay(date);
      await clearPending("calories", date);
      if (selectedDate === date && !(days[date]?.entries.length)) setSelectedDate(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const onDeleteCalorieItem = async (date: string, itemId: string) => {
    if (!confirm("Delete this calorie item?")) return;
    const day = calories[date];
    if (!day) return;
    const items = day.items.filter((i) => i.id !== itemId);
    if (items.length === 0) {
      await onDeleteCalorieDay(date, true);
      return;
    }
    try {
      await persistCalories({ ...day, items });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const retrieveDays = async (question: string): Promise<DayFile[]> => {
    if (!manifest) return [];
    let hits = searchSummaryDates(manifest, question, 5);
    if (hits.length === 0 && manifest.days.length > 0) {
      const picked = await callGemini({
        mode: "pick_dates",
        question,
        index: manifest.days.map((d) => ({ date: d.date, summary: d.summary })),
      });
      if (picked.ok && picked.mode === "pick_dates") {
        hits = picked.dates.map((date) => ({
          date,
          score: 1,
          summary: manifest.days.find((d) => d.date === date)?.summary ?? "",
        }));
      }
    }
    const out: DayFile[] = [];
    for (const hit of hits) {
      const day = (await loadDayIntoState(hit.date)) ?? days[hit.date];
      if (day) out.push(day);
    }
    return out;
  };

  const persistCalories = async (day: CalorieDay) => {
    setCalories((prev) => ({ ...prev, [day.date]: day }));
    await saveCachedCalorieDay(day);
    await markPending("calories", day.date);
    if (!token || !manifest) return;
    const next = await saveCalorieFile(token, manifest, day);
    setManifest(next);
    await saveCachedManifest(next);
    await clearPending("calories", day.date);
  };

  const persistPeriodQa = async (next: PeriodQaFile) => {
    setPeriodQa(next);
    await saveCachedPeriodQa(next);
    if (!token || !manifest) return;
    const saved = await savePeriodQa(token, manifest, next);
    setManifest(saved);
    await saveCachedManifest(saved);
  };

  const loadRangeData = async (start: string, end: string) => {
    const dayFiles: DayFile[] = [];
    const calDays: CalorieDay[] = [];
    for (const date of datesInRange(start, end)) {
      const day = await loadDayIntoState(date);
      if (day?.entries.length) dayFiles.push(day);
      const cal = await loadCalIntoState(date);
      if (cal?.items.length) calDays.push(cal);
    }
    return { dayFiles, calDays };
  };

  const onGenerateMonth = async (year: number, monthIndex: number) => {
    const key = monthKey(year, monthIndex);
    const { start, end } = monthRange(`${key}-01`);
    setGeneratingMonth(true);
    setError(null);
    try {
      const { dayFiles, calDays } = await loadRangeData(start, end);
      if (dayFiles.length === 0 && calDays.length === 0) return;
      const packed = packPeriod(dayFiles, calDays);
      const result = await callGemini({ mode: "range_summary", start, end, packed });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const file: MonthSummaryFile = {
        month: key,
        summary: result.mode === "range_summary" ? result.data.reply : "",
        generatedAt: new Date().toISOString(),
      };
      setMonthSummaries((prev) => ({ ...prev, [key]: file }));
      await saveCachedMonthSummary(file);
      if (token && manifest) {
        const next = await saveMonthSummary(token, manifest, file);
        setManifest(next);
        await saveCachedManifest(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Month summary failed");
    } finally {
      setGeneratingMonth(false);
    }
  };

  const onSend = async () => {
    const text = draft.trim();
    if ((!text && pending.length === 0) || chatBusy) return;

    const attachments = pending;
    const images = attachments
      .map((a) => dataUrlToImage(a.dataUrl))
      .filter((img): img is { mimeType: string; data: string } => Boolean(img))
      .slice(0, 4);
    const fileNames = attachments
      .filter((a) => !a.mimeType.startsWith("image/"))
      .map((a) => a.name);
    const visible = text || (attachments.length ? "(attached)" : "");
    const userMsg = msg("user", visible, attachments.length ? attachments : undefined);
    const working: DiaryEntry = {
      ...current,
      messages: [...current.messages, userMsg],
      updatedAt: userMsg.at,
    };
    setCurrent(working);
    setDraft("");
    setPending([]);
    setChatBusy(true);
    setError(null);

    try {
      const calorieNote = extractCaloriesNote(text);
      const treatAsCalories = Boolean(calorieNote) || (images.length > 0 && /@calories\b/i.test(text));
      let assistantText: string;
      if (treatAsCalories) {
        const note = [
          calorieNote || text || "Estimate the meal in the attached photo.",
          fileNames.length ? `Files: ${fileNames.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const result = await callGemini({
          mode: "nutrition",
          note,
          today: todayIsoDate(),
          images,
        });
        if (!result.ok) {
          assistantText = result.message;
          if (result.quota) setError(result.message);
        } else if (result.mode === "nutrition") {
          const hinted = /\b(yesterday|today|tonight|last night|days ago|\d{4}-\d{2}-\d{2})\b/i.test(
            note,
          );
          const date = hinted
            ? parseCalorieLogDate(note)
            : result.data.logDate && /^\d{4}-\d{2}-\d{2}$/.test(result.data.logDate)
              ? result.data.logDate
              : todayIsoDate();
          const existing =
            calories[date] ??
            (await loadCalIntoState(date)) ??
            emptyCalorieDay(date, manifest?.calorieGoal ?? DEFAULT_CALORIE_GOAL);
          const items = result.data.items.map((i) => ({
            ...i,
            id: crypto.randomUUID(),
            at: userMsg.at,
            raw: note,
            minutes: i.minutes,
          }));
          const nextCal: CalorieDay = { ...existing, items: [...existing.items, ...items] };
          await persistCalories(nextCal);
          assistantText = formatNutritionReply(
            items.map((i) => ({ ...i })),
            `${result.data.reply}${date !== todayIsoDate() ? `\n\nFiled on ${date}.` : ""}`,
          );
        } else {
          assistantText = "Could not estimate nutrition.";
        }
      } else if (extractPeriodAsk(text)) {
        const ask = extractPeriodAsk(text)!;
        const range = ask.skill === "weekly" ? weekRange() : monthRange();
        const { dayFiles, calDays } = await loadRangeData(range.start, range.end);
        const bounds = collectLogBounds(dayFiles, calDays);
        if (!bounds.startLogId) {
          assistantText = `No ${ask.skill} diary or nutrition logs in range ${range.start} to ${range.end}.`;
          setCurrent({
            ...working,
            messages: [
              ...working.messages,
              {
                ...msg("assistant", assistantText),
                period: {
                  skill: ask.skill,
                  startLogId: "",
                  endLogId: "",
                },
              },
            ],
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        const question = normalizeQuestion(ask.question) || ask.question;
        const hit = periodQa.answers.find(
          (a) =>
            a.skill === ask.skill &&
            a.question === question &&
            a.startLogId === bounds.startLogId &&
            a.endLogId === bounds.endLogId,
        );
        if (hit) {
          assistantText = hit.reply;
          setCurrent({
            ...working,
            messages: [
              ...working.messages,
              {
                ...msg("assistant", assistantText),
                period: {
                  skill: ask.skill,
                  startLogId: bounds.startLogId,
                  endLogId: bounds.endLogId,
                  cached: true,
                },
              },
            ],
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        const packed = packPeriod(dayFiles, calDays);
        const result = await callGemini({
          mode: "period_ask",
          skill: ask.skill,
          question: ask.question,
          start: range.start,
          end: range.end,
          packed,
        });
        if (!result.ok) {
          assistantText = result.message;
          if (result.quota) setError(result.message);
        } else if (result.mode === "period_ask") {
          assistantText = result.data.reply;
          const entry = {
            skill: ask.skill,
            question,
            startLogId: bounds.startLogId,
            endLogId: bounds.endLogId,
            reply: assistantText,
            at: new Date().toISOString(),
          };
          const answers = [
            entry,
            ...periodQa.answers.filter(
              (a) => !(a.skill === ask.skill && a.question === question),
            ),
          ].slice(0, 40);
          await persistPeriodQa({ answers });
        } else {
          assistantText = "Could not answer.";
        }
        setCurrent({
          ...working,
          messages: [
            ...working.messages,
            {
              ...msg("assistant", assistantText),
              period: {
                skill: ask.skill,
                startLogId: bounds.startLogId,
                endLogId: bounds.endLogId,
                cached: false,
              },
            },
          ],
          updatedAt: new Date().toISOString(),
        });
        return;
      } else {
        let packedDays = "";
        if (isRetrievalQuery(text) && manifest) {
          const found = await retrieveDays(text);
          packedDays = packDaysForLlm(found);
        }
        const result = await callGemini({
          mode: "chat",
          messages: working.messages.map((m) => ({ role: m.role, text: m.text })),
          packedDays,
          images,
        });
        if (!result.ok) {
          assistantText = result.message;
          if (result.quota) setError(result.message);
        } else if (result.mode === "chat") {
          assistantText = result.data.reply;
        } else {
          assistantText = "Could not reply.";
        }
      }
      setCurrent({
        ...working,
        messages: [...working.messages, msg("assistant", assistantText)],
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      setCurrent(working);
    } finally {
      setChatBusy(false);
    }
  };

  const onLog = async () => {
    if (chatBusy || current.messages.length === 0) return;
    if (!token || !manifest) {
      setError("Connect Google Drive to file this session.");
      return;
    }
    setChatBusy(true);
    setError(null);
    const date = current.messages.length ? currentDate : todayIsoDate();
    const day = getDay(date);
    try {
      const result = await callGemini({
        mode: "log",
        userText: [...current.messages].reverse().find((m) => m.role === "user")?.text ?? "",
        session: {
          title: current.title,
          summary: current.summary,
          messages: current.messages.map((m) => ({ role: m.role, text: m.text })),
        },
        day: {
          date,
          summary: day.summary,
          otherSessionTitles: day.entries
            .filter((e) => e.id !== current.id)
            .map((e) => e.title),
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.mode !== "log") {
        setError("Could not log session.");
        return;
      }
      const confirmation = msg("assistant", result.data.reply);
      const nextEntry: DiaryEntry = {
        ...current,
        title: result.data.title,
        tags: result.data.tags,
        summary: result.data.sessionSummary,
        savedToDrive: true,
        messages: [...current.messages, confirmation],
        updatedAt: confirmation.at,
      };
      setCurrent(nextEntry);
      setCurrentDate(date);
      await persistDay(manifest, upsertEntry(day, nextEntry, result.data.daySummary), token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Log failed");
    } finally {
      setChatBusy(false);
    }
  };

  const onAddFiles = async (list: FileList | File[]) => {
    const incoming = Array.from(list).slice(0, 6);
    try {
      const next = await Promise.all(incoming.map(fileToAttachment));
      setPending((prev) => [...prev, ...next].slice(0, 6));
    } catch {
      setError("Could not attach that file.");
    }
  };

  const onOpenDay = async (date: string) => {
    setSelectedDate(date);
    await Promise.all([loadDayIntoState(date), loadCalIntoState(date)]);
  };

  const isPhone = narrow || phonePreview;
  const bezel = phonePreview && !narrow;

  const sessionList = (
    <SessionList
      entries={sessions}
      currentId={current.id}
      busy={false}
      deletingId={deletingId}
      sheet={isPhone}
      onClose={() => setSessionsOpen(false)}
      onNew={onNew}
      onSelect={onSelect}
      onDelete={onDelete}
    />
  );

  const chatPane = (
    <ChatPane
      entry={current}
      savedToDrive={savedToDrive}
      busy={chatBusy}
      error={error}
      draft={draft}
      pending={pending}
      compact={isPhone}
      onDraft={setDraft}
      onPending={setPending}
      onAddFiles={onAddFiles}
      onSend={onSend}
      onLog={onLog}
    />
  );

  const main =
    tab === "chat" ? (
      <>
        {isPhone ? null : sessionList}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-ink/15 px-4 py-2 text-xs text-ink-mute">
            {isPhone ? (
              <button type="button" className="text-accent" onClick={() => setSessionsOpen(true)}>
                Sessions
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {syncing ? <span>Syncing…</span> : <span>Drive</span>}
              <button type="button" className="underline-offset-2 hover:underline" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          </div>
          {chatPane}
        </div>
      </>
    ) : tab === "log" ? (
      <CalendarLog
        markedDates={markedDates}
        onOpenDay={onOpenDay}
        selected={
          selectedDate
            ? {
                date: selectedDate,
                day: days[selectedDate] ?? null,
                calories: calories[selectedDate] ?? null,
              }
            : null
        }
        onCloseDay={() => setSelectedDate(null)}
        onDeleteSession={onDelete}
        onDeleteCalorieItem={onDeleteCalorieItem}
        onDeleteCalorieDay={onDeleteCalorieDay}
        onDeleteDiaryDay={onDeleteDiaryDay}
        monthSummaries={monthSummaries}
        generatingMonth={generatingMonth}
        onGenerateMonth={onGenerateMonth}
      />
    ) : (
      <ExportView
        calories={calories}
        days={days}
        onNeedRange={async (start, end) => {
          let d = start;
          while (d <= end) {
            await Promise.all([loadDayIntoState(d), loadCalIntoState(d)]);
            d = addDaysIso(d, 1);
          }
        }}
      />
    );

  if (hydrating) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="font-serif text-3xl">Diary</h1>
        <p className="mt-4 text-ink-mute">Restoring your Drive session…</p>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="font-serif text-3xl">Diary</h1>
        <p className="mt-4 leading-7 text-ink-mute">
          Sessions are stored as JSON in a <em>DiaryApp</em> folder on your Google Drive.
          Sign in with the same Google account you use for calorie-logging. The popup must
          include Drive access — if Google only asks for email, cancel and click Connect again.
        </p>
        <button
          type="button"
          onClick={connect}
          disabled={!ready || hydrating}
          className="mt-8 border border-ink bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
        >
          Connect Google Drive
        </button>
        <button type="button" className="mt-4 block text-sm text-ink-mute" onClick={toggle}>
          {theme === "dark" ? "Use light mode" : "Use dark mode"}
        </button>
        {authError ? <p className="mt-3 text-sm">{authError}</p> : null}
      </main>
    );
  }

  return (
    <div
      className={
        bezel
          ? "flex min-h-screen flex-col items-center justify-center gap-3 bg-paper-2 p-6"
          : "relative min-h-screen"
      }
    >
      {narrow ? null : (
        <div className={`flex items-center gap-3 text-xs text-ink-mute ${bezel ? "" : "absolute top-2 right-3 z-20"}`}>
          <button
            type="button"
            className={phonePreview ? "text-ink" : ""}
            onClick={() => setPhonePreview(true)}
          >
            Phone
          </button>
          <span>·</span>
          <button
            type="button"
            className={phonePreview ? "" : "text-ink"}
            onClick={() => setPhonePreview(false)}
          >
            Desktop
          </button>
        </div>
      )}
      <div
        className={
          bezel
            ? "relative flex h-[844px] w-[390px] flex-col overflow-hidden rounded-[32px] border border-ink/25 bg-paper"
            : isPhone
              ? "relative flex h-[100dvh] flex-col overflow-hidden"
              : "relative flex min-h-screen flex-col md:h-screen md:flex-row"
        }
      >
        {isPhone ? null : (
          <IconRail
            tab={tab}
            onTab={(t) => {
              setSettingsOpen(false);
              setTab(t);
            }}
            placement="side"
            settingsOpen={settingsOpen}
            onSettings={() => {
              setSessionsOpen(false);
              setSettingsOpen((v) => !v);
            }}
          />
        )}
        <div className={`flex min-h-0 flex-1 overflow-hidden ${isPhone ? "flex-col" : "flex-col md:flex-row"}`}>
          {main}
        </div>
        {isPhone ? (
          <IconRail
            tab={tab}
            onTab={(t) => {
              setSettingsOpen(false);
              setTab(t);
            }}
            placement="bottom"
            settingsOpen={settingsOpen}
            onSettings={() => {
              setSessionsOpen(false);
              setSettingsOpen((v) => !v);
            }}
          />
        ) : null}
        {isPhone && sessionsOpen && tab === "chat" ? (
          <div className="absolute inset-0 z-30 flex flex-col bg-paper">
            {sessionList}
          </div>
        ) : null}
        {settingsOpen ? (
          <div className="absolute inset-0 z-40 flex flex-col bg-paper">
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
