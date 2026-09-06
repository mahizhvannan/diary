"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalyzeView } from "../components/AnalyzeView";
import { CalendarLog } from "../components/CalendarLog";
import { ChatPane } from "../components/ChatPane";
import { IconRail, SettingsPanel } from "../components/IconRail";
import { SessionList } from "../components/SessionList";
import {
  clearPending,
  deleteCachedArtifact,
  deleteCachedCalorieDay,
  deleteCachedDay,
  deleteCachedMonthSummary,
  loadAllCachedCalories,
  loadAllCachedDays,
  loadAllCachedMonthSummaries,
  loadCachedArtifact,
  loadCachedArtifactsIndex,
  loadCachedCalorieDay,
  loadCachedDay,
  loadCachedManifest,
  loadCachedMonthSummary,
  loadCachedPeriodQa,
  loadCachedCollections,
  loadCachedCustomSkills,
  loadPendingSync,
  markPending,
  markCollectionsPending,
  clearCollectionsPending,
  hasPendingSync,
  saveCachedArtifact,
  saveCachedArtifactsIndex,
  saveCachedCalorieDay,
  saveCachedDay,
  saveCachedManifest,
  saveCachedMonthSummary,
  saveCachedPeriodQa,
  saveCachedCollections,
  saveCachedCustomSkills,
} from "../lib/cache";
import { TIMEZONE, todayIsoDate } from "../lib/dates";
import {
  deleteArtifact,
  deleteCalorieFile,
  deleteDayFile,
  deleteMonthSummary,
  ensureDiaryStore,
  loadArtifactFile,
  loadArtifactsIndex,
  loadCalorieFile,
  loadDayFile,
  loadMonthSummary,
  loadPeriodQa,
  loadCollections,
  loadCustomSkills,
  saveArtifact,
  saveCalorieFile,
  saveDayFile,
  saveMonthSummary,
  savePeriodQa,
  saveCollections,
  saveCustomSkills,
  saveManifest,
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
import { parseCalorieLogDate } from "../lib/parse-date";
import {
  collectLogBounds,
  datesInRange,
  monthKey,
  monthRange,
  packPeriod,
  packedHash,
  normalizeQuestion,
  weekRange,
} from "../lib/period";
import {
  applyTrackUpdates,
  looksLikeTrackUpdate,
  packExportCatalog,
  packTrackCatalog,
  samplesOnDate,
  trackDates,
} from "../lib/track";
import { extractCaloriesNote, extractCustomSkill, extractPeriodAsk, extractTrackNote } from "../lib/skills";
import type {
  ArtifactFile,
  ArtifactsIndex,
  CalorieDay,
  ChatAttachment,
  ChatMessage,
  CollectionsFile,
  CustomSkillsFile,
  DayFile,
  DiaryEntry,
  Manifest,
  MonthSummaryFile,
  PeriodQaFile,
} from "../lib/types";
import type { DiarySnapshot } from "../lib/analyze-types";
import { collectionTrackables, nutritionTrackables } from "../lib/trackables";
import { buildDiaryExportZip, downloadBlob } from "../lib/export-zip";
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
  const [tab, setTab] = useState<"chat" | "log" | "analyze">("chat");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [phonePreview, setPhonePreview] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [monthSummaries, setMonthSummaries] = useState<Record<string, MonthSummaryFile>>({});
  const [periodQa, setPeriodQa] = useState<PeriodQaFile>({ answers: [] });
  const [collections, setCollections] = useState<CollectionsFile>({ collections: [] });
  const [customSkills, setCustomSkills] = useState<CustomSkillsFile>({ skills: [] });
  const [artifactsIndex, setArtifactsIndex] = useState<ArtifactsIndex>({ items: [] });
  const [generatingMonth, setGeneratingMonth] = useState(false);
  const [drivePending, setDrivePending] = useState(false);

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
      const cols = await loadCachedCollections();
      if (!cancelled) setCollections(cols);
      const skills = await loadCachedCustomSkills();
      if (!cancelled) setCustomSkills(skills);
      const arts = await loadCachedArtifactsIndex();
      if (!cancelled) setArtifactsIndex(arts);
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
        let colManifest = (await loadCachedManifest()) ?? calManifest;
        if ((await loadPendingSync()).collections) {
          const localCols = await loadCachedCollections();
          colManifest = await saveCollections(token, colManifest, localCols);
          if (!cancelled) setManifest(colManifest);
          await saveCachedManifest(colManifest);
          await clearCollectionsPending();
        }
        const latest = (await loadCachedManifest()) ?? colManifest;
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
        const cols = await loadCollections(token, latest);
        await saveCachedCollections(cols);
        if (!cancelled) setCollections(cols);
        const skills = await loadCustomSkills(token, latest);
        await saveCachedCustomSkills(skills);
        if (!cancelled) setCustomSkills(skills);
        const arts = await loadArtifactsIndex(token, latest);
        await saveCachedArtifactsIndex(arts);
        if (!cancelled) setArtifactsIndex(arts);
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
    for (const d of trackDates(collections)) s.add(d);
    return s;
  }, [manifest, days, calories, collections]);

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

  const flushPendingSync = useCallback(async () => {
    if (!token) return;
    const pending = await loadPendingSync();
    if (!pending.days.length && !pending.calories.length && !pending.collections) {
      setDrivePending(false);
      return;
    }
    setDrivePending(true);
    try {
      let m = (await loadCachedManifest()) ?? manifest;
      if (!m) return;

      for (const date of pending.days) {
        const local = await loadCachedDay(date);
        if (!local) {
          await clearPending("days", date);
          continue;
        }
        m = await saveDayFile(token, m, local);
        await saveCachedManifest(m);
        setManifest(m);
        await clearPending("days", date);
      }

      for (const date of (await loadPendingSync()).calories) {
        const local = await loadCachedCalorieDay(date);
        if (!local) {
          await clearPending("calories", date);
          continue;
        }
        m = await saveCalorieFile(token, m, local);
        await saveCachedManifest(m);
        setManifest(m);
        await clearPending("calories", date);
      }

      if ((await loadPendingSync()).collections) {
        const cols = await loadCachedCollections();
        m = await saveCollections(token, m, cols);
        await saveCachedManifest(m);
        setManifest(m);
        await clearCollectionsPending();
      }

      setDrivePending(await hasPendingSync());
    } catch {
      setDrivePending(true);
    }
  }, [token, manifest]);

  useEffect(() => {
    if (!token) return;
    void flushPendingSync();
    const id = window.setInterval(() => {
      void flushPendingSync();
    }, 20000);
    return () => window.clearInterval(id);
  }, [token, flushPendingSync]);

  const persistCollections = async (next: CollectionsFile) => {
    // Optimistic: UI + IndexedDB first, Drive in background with retry.
    setCollections(next);
    await saveCachedCollections(next);
    await markCollectionsPending();
    setDrivePending(true);
    void flushPendingSync();
  };

  const persistCustomSkills = async (next: CustomSkillsFile) => {
    setCustomSkills(next);
    await saveCachedCustomSkills(next);
    if (!token || !manifest) return;
    const saved = await saveCustomSkills(token, manifest, next);
    setManifest(saved);
    await saveCachedManifest(saved);
  };

  const buildAnalyzeSnapshot = async (): Promise<DiarySnapshot> => {
    const [allDays, allCals, allMonths, cols, skills, qa, man] = await Promise.all([
      loadAllCachedDays(),
      loadAllCachedCalories(),
      loadAllCachedMonthSummaries(),
      loadCachedCollections(),
      loadCachedCustomSkills(),
      loadCachedPeriodQa(),
      loadCachedManifest(),
    ]);
    return {
      days: allDays,
      calories: allCals,
      monthSummaries: allMonths,
      collections: cols,
      customSkills: skills,
      periodQa: qa,
      manifest: man
        ? {
            calorieGoal: man.calorieGoal,
            dayCount: man.days?.length ?? 0,
            calorieDayCount: man.calorieDays?.length ?? 0,
          }
        : undefined,
    };
  };

  const onLogArtifacts = async (files: ArtifactFile[]) => {
    if (!token || !manifest) throw new Error("Connect Google Drive to log artifacts.");
    let nextManifest = manifest;
    let nextIndex = artifactsIndex;
    for (const file of files) {
      await saveCachedArtifact(file);
      const saved = await saveArtifact(token, nextManifest, file, nextIndex);
      nextManifest = saved.manifest;
      nextIndex = saved.index;
    }
    setManifest(nextManifest);
    await saveCachedManifest(nextManifest);
    setArtifactsIndex(nextIndex);
    await saveCachedArtifactsIndex(nextIndex);
  };

  const onDeleteArtifact = async (id: string) => {
    if (!token || !manifest) return;
    const { manifest: nextManifest, index } = await deleteArtifact(
      token,
      manifest,
      id,
      artifactsIndex,
    );
    await deleteCachedArtifact(id);
    setManifest(nextManifest);
    await saveCachedManifest(nextManifest);
    setArtifactsIndex(index);
    await saveCachedArtifactsIndex(index);
  };

  const onOpenArtifact = async (id: string): Promise<ArtifactFile | null> => {
    const cached = await loadCachedArtifact(id);
    if (cached) return cached;
    if (!token || !manifest) return null;
    const file = await loadArtifactFile(token, manifest, id);
    if (file) await saveCachedArtifact(file);
    return file;
  };

  const onDownloadData = async () => {
    const blob = await buildDiaryExportZip();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `diary-export-${stamp}.zip`);
  };

  const onCalorieGoalChange = async (goal: number) => {
    if (!manifest) return;
    const next = { ...manifest, calorieGoal: goal };
    setManifest(next);
    await saveCachedManifest(next);
    if (token) await saveManifest(token, next);
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

  const onNeedMonthSummary = useCallback(
    async (year: number, monthIndex: number) => {
      const key = monthKey(year, monthIndex);
      if (monthSummaries[key]) return;
      const cached = await loadCachedMonthSummary(key);
      if (cached) {
        setMonthSummaries((prev) => ({ ...prev, [key]: cached }));
        return;
      }
      if (!token || !manifest) return;
      if (!(manifest.monthSummaries ?? []).some((m) => m.month === key)) return;
      try {
        const remote = await loadMonthSummary(token, manifest, key);
        if (remote) {
          setMonthSummaries((prev) => ({ ...prev, [key]: remote }));
          await saveCachedMonthSummary(remote);
        }
      } catch {
        /* ignore */
      }
    },
    [monthSummaries, token, manifest],
  );

  const onDeleteMonthSummary = async (year: number, monthIndex: number) => {
    const key = monthKey(year, monthIndex);
    setError(null);
    try {
      if (token && manifest) {
        const next = await deleteMonthSummary(token, manifest, key);
        setManifest(next);
        await saveCachedManifest(next);
      }
      await deleteCachedMonthSummary(key);
      setMonthSummaries((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete month summary");
    }
  };

  const onGenerateMonth = async (year: number, monthIndex: number) => {
    const key = monthKey(year, monthIndex);
    const { start, end } = monthRange(`${key}-01`);
    setGeneratingMonth(true);
    setError(null);
    try {
      const { dayFiles, calDays } = await loadRangeData(start, end);
      if (dayFiles.length === 0 && calDays.length === 0) return;
      const packed = packPeriod(dayFiles, calDays, collections, { start, end });
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
        const bounds = collectLogBounds(dayFiles, calDays, collections, range);
        if (!bounds.startLogId) {
          assistantText = `No ${ask.skill} diary, nutrition, or tracked logs in range ${range.start} to ${range.end}.`;
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
        const packed = packPeriod(dayFiles, calDays, collections, range);
        const hash = packedHash(packed);
        const hit = periodQa.answers.find(
          (a) =>
            a.skill === ask.skill &&
            a.question === question &&
            a.startLogId === bounds.startLogId &&
            a.endLogId === bounds.endLogId &&
            a.packedHash === hash,
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
            packedHash: hash,
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
      } else if (extractTrackNote(text) || looksLikeTrackUpdate(text, collections)) {
        const note = extractTrackNote(text) || text;
        if (collections.collections.length === 0) {
          assistantText =
            "Add a collection with variables first (Collections in the rail), then send values like “weight is 72” or @track.";
        } else {
          const result = await callGemini({
            mode: "track_update",
            note,
            today: todayIsoDate(),
            catalog: packTrackCatalog(collections),
          });
          if (!result.ok) {
            assistantText = result.message;
            if (result.quota) setError(result.message);
          } else if (result.mode === "track_update") {
            const hinted = /\b(yesterday|today|tonight|last night|days ago|\d{4}-\d{2}-\d{2})\b/i.test(
              note,
            );
            const fallbackDate = hinted ? parseCalorieLogDate(note) : todayIsoDate();
            const updates = result.data.updates.map((u) => ({
              ...u,
              source: "chat" as const,
              logDate:
                u.logDate && /^\d{4}-\d{2}-\d{2}$/.test(u.logDate) ? u.logDate : fallbackDate,
            }));
            const applied = applyTrackUpdates(collections, updates, userMsg.at, fallbackDate);
            await persistCollections(applied.file);
            assistantText = [result.data.reply.trim(), "", ...applied.lines].filter(Boolean).join("\n");
          } else {
            assistantText = "Could not update variables.";
          }
        }
      } else if (extractCustomSkill(text, customSkills.skills)) {
        const hit = extractCustomSkill(text, customSkills.skills)!;
        const today = todayIsoDate();
        const range =
          hit.skill.uses.range === "week"
            ? weekRange(today)
            : hit.skill.uses.range === "month"
              ? monthRange(today)
              : hit.skill.uses.range === "day"
                ? { start: today, end: today }
                : null;
        let packed = "";
        if (range && (hit.skill.uses.nutrition || hit.skill.uses.diary || hit.skill.uses.collections)) {
          const { dayFiles, calDays } = await loadRangeData(range.start, range.end);
          packed = packPeriod(
            hit.skill.uses.diary ? dayFiles : [],
            hit.skill.uses.nutrition ? calDays : [],
            hit.skill.uses.collections ? collections : undefined,
            range,
          );
        }
        if (hit.skill.uses.collections) {
          packed = [packed, packed ? "" : null, "Catalog:", packTrackCatalog(collections)]
            .filter((x) => x != null)
            .join("\n");
        }
        const result = await callGemini({
          mode: "skill_run",
          tag: hit.skill.tag,
          hint: hit.skill.hint,
          instructions: hit.skill.instructions,
          note: hit.note,
          today,
          packed,
        });
        if (!result.ok) {
          assistantText = result.message;
          if (result.quota) setError(result.message);
        } else if (result.mode === "skill_run") {
          assistantText = result.data.reply;
        } else {
          assistantText = "Could not run skill.";
        }
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

  const trackablesCatalog = useMemo(
    () =>
      [
        packExportCatalog(collections),
        "",
        "Collection details (variables + statics):",
        packTrackCatalog(collections),
      ].join("\n"),
    [collections],
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
      customSkills={customSkills.skills}
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
        days={days}
        calories={calories}
        onOpenDay={onOpenDay}
        selected={
          selectedDate
            ? {
                date: selectedDate,
                day: days[selectedDate] ?? null,
                calories: calories[selectedDate] ?? null,
                tracked: samplesOnDate(collections, selectedDate),
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
        onDeleteMonthSummary={onDeleteMonthSummary}
        onNeedMonthSummary={onNeedMonthSummary}
      />
    ) : (
      <AnalyzeView
        workspaceId={manifest?.folderId ?? ""}
        driveToken={token ?? ""}
        buildSnapshot={buildAnalyzeSnapshot}
        onLogArtifacts={onLogArtifacts}
        loggedArtifacts={artifactsIndex}
        onOpenLoggedArtifact={onOpenArtifact}
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
            <SettingsPanel
              onClose={() => setSettingsOpen(false)}
              onDownloadData={onDownloadData}
              nutritionRows={nutritionTrackables(
                calories,
                manifest?.calorieGoal ?? DEFAULT_CALORIE_GOAL,
              )}
              collectionRows={collectionTrackables(collections)}
              collections={collections}
              collectionsSyncLabel={drivePending ? "Drive sync pending — retrying…" : null}
              onCollectionsChange={persistCollections}
              calorieGoal={manifest?.calorieGoal ?? DEFAULT_CALORIE_GOAL}
              onCalorieGoalChange={onCalorieGoalChange}
              customSkills={customSkills}
              trackablesCatalog={trackablesCatalog}
              onCustomSkillsChange={persistCustomSkills}
              artifactsIndex={artifactsIndex}
              onDeleteArtifact={onDeleteArtifact}
              onOpenArtifact={onOpenArtifact}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
