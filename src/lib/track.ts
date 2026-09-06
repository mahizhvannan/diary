import { dayCalorieTotals, dayMacroTotals } from "./nutrition";
import { addDaysIso } from "./parse-date";
import type {
  CalorieDay,
  CollectionsFile,
  CollectionsMetaFile,
  TrackCollection,
  TrackMonthFile,
  TrackSample,
  TrackVariable,
} from "./types";

function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

export const emptyCollections = (): CollectionsFile => ({ collections: [] });

export function collectionsToMeta(file: CollectionsFile): CollectionsMetaFile {
  return {
    collections: file.collections.map((c) => ({
      id: c.id,
      name: c.name,
      statics: c.statics.map((s) => ({ ...s })),
      variables: c.variables.map(({ id, name, description, unit }) => ({
        id,
        name,
        description,
        unit,
      })),
    })),
  };
}

export function monthsTouched(file: CollectionsFile): string[] {
  const months = new Set<string>();
  for (const c of file.collections) {
    for (const v of c.variables) {
      for (const s of v.samples) months.add(s.date.slice(0, 7));
    }
  }
  return [...months].sort();
}

export function splitTrackMonths(file: CollectionsFile): TrackMonthFile[] {
  const byMonth = new Map<string, TrackMonthFile["samples"]>();
  for (const c of file.collections) {
    for (const v of c.variables) {
      for (const s of v.samples) {
        const month = s.date.slice(0, 7);
        const row = byMonth.get(month) ?? [];
        row.push({
          variableId: v.id,
          date: s.date,
          value: s.value,
          at: s.at,
          note: s.note,
          source: s.source,
        });
        byMonth.set(month, row);
      }
    }
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, samples]) => ({
      month,
      samples: samples.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at)),
    }));
}

export function mergeTrackMonths(
  meta: CollectionsMetaFile | CollectionsFile,
  months: TrackMonthFile[],
): CollectionsFile {
  const byVar = new Map<string, TrackSample[]>();
  for (const m of months) {
    for (const s of m.samples) {
      const list = byVar.get(s.variableId) ?? [];
      list.push({
        date: s.date,
        value: s.value,
        at: s.at,
        note: s.note,
        source: s.source,
      });
      byVar.set(s.variableId, list);
    }
  }
  return {
    collections: (meta.collections ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      statics: c.statics ?? [],
      variables: (c.variables ?? []).map((v) => {
        const samples = (byVar.get(v.id) ?? []).sort(
          (a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at),
        );
        return {
          id: v.id,
          name: v.name,
          description: v.description,
          unit: v.unit,
          samples,
        };
      }),
    })),
  };
}

export type BuiltinSeriesId =
  | "calorie_deficit"
  | "eaten"
  | "burned"
  | "net"
  | "protein"
  | "carbs"
  | "fat";

export const BUILTIN_SERIES: {
  id: BuiltinSeriesId;
  name: string;
  unit: string;
  description: string;
}[] = [
  {
    id: "calorie_deficit",
    name: "calorie deficit",
    unit: "kcal",
    description: "Daily calorie deficit: goal minus net (eaten minus burned). Negative is a surplus.",
  },
  { id: "eaten", name: "calories eaten", unit: "kcal", description: "Food calories logged that day." },
  { id: "burned", name: "calories burned", unit: "kcal", description: "Activity calories logged that day." },
  { id: "net", name: "net calories", unit: "kcal", description: "Eaten minus burned." },
  { id: "protein", name: "protein", unit: "g", description: "Protein grams from food that day." },
  { id: "carbs", name: "carbs", unit: "g", description: "Carbohydrate grams from food that day." },
  { id: "fat", name: "fat", unit: "g", description: "Fat grams from food that day." },
];

export function lastSample(variable: TrackVariable): TrackSample | undefined {
  if (variable.samples.length === 0) return undefined;
  return [...variable.samples].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at)).at(-1);
}

export function allVariables(
  file: CollectionsFile,
): { collection: TrackCollection; variable: TrackVariable }[] {
  return file.collections.flatMap((collection) =>
    collection.variables.map((variable) => ({ collection, variable })),
  );
}

export function samplesOnDate(file: CollectionsFile, date: string): { name: string; unit: string; value: number }[] {
  const out: { name: string; unit: string; value: number }[] = [];
  for (const { variable } of allVariables(file)) {
    const hit = [...variable.samples]
      .filter((s) => s.date === date)
      .sort((a, b) => a.at.localeCompare(b.at))
      .at(-1);
    if (hit) out.push({ name: variable.name, unit: variable.unit, value: hit.value });
  }
  return out;
}

export function trackDates(file: CollectionsFile): Set<string> {
  const s = new Set<string>();
  for (const { variable } of allVariables(file)) {
    for (const sample of variable.samples) s.add(sample.date);
  }
  return s;
}

export function packTrackCatalog(file: CollectionsFile): string {
  if (file.collections.length === 0) return "(no collections)";
  return file.collections
    .map((c) => {
      const vars =
        c.variables
          .map((v) => {
            const last = lastSample(v);
            return `  VAR id=${v.id} name="${v.name}" unit="${v.unit || ""}" description="${v.description}" last=${last ? `${last.value} on ${last.date}` : "none"}`;
          })
          .join("\n") || "  (no variables)";
      const statics =
        c.statics
          .map((s) => `  STATIC id=${s.id} name="${s.name}" value="${s.value}" description="${s.description}"`)
          .join("\n") || "  (no statics)";
      return `Collection "${c.name}" id=${c.id}\n${vars}\n${statics}`;
    })
    .join("\n\n");
}

export function packExportCatalog(file: CollectionsFile): string {
  const builtins = BUILTIN_SERIES.map(
    (s) => `builtin id=${s.id} name="${s.name}" unit=${s.unit} description="${s.description}"`,
  ).join("\n");
  const vars = allVariables(file)
    .map(
      ({ collection, variable }) =>
        `variable id=${variable.id} collection="${collection.name}" name="${variable.name}" unit="${variable.unit || ""}" description="${variable.description}"`,
    )
    .join("\n");
  return `Built-in nutrition series:\n${builtins}\n\nCollection variables:\n${vars || "(none)"}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameTokens(name: string, description: string): string[] {
  const skip = new Set(["the", "and", "for", "with", "from", "that", "this", "daily", "body", "your"]);
  const raw = `${name} ${description}`.toLowerCase().replace(/[_-]+/g, " ");
  const parts = raw.split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !skip.has(t));
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [...new Set([...parts, compact].filter((t) => t.length >= 3))];
}

export function looksLikeTrackUpdate(text: string, file: CollectionsFile): boolean {
  if (/@calories\b|@weekly\b|@monthly\b/i.test(text)) return false;
  if (/@track\b/i.test(text)) return true;
  if (/\?/.test(text)) return false;
  if (file.collections.length === 0) return false;
  if (!/\d/.test(text)) return false;
  const t = text.toLowerCase().replace(/[_-]+/g, " ");
  return allVariables(file).some(({ variable }) =>
    nameTokens(variable.name, variable.description).some((tok) => {
      const folded = tok.replace(/[_-]+/g, " ");
      return new RegExp(`\\b${escapeRe(folded)}\\b`, "i").test(t);
    }),
  );
}

export type TrackUpdate = {
  kind: "variable" | "static";
  id: string;
  value: number | string;
  logDate?: string;
  note?: string;
  source?: "chat" | "ui";
};

export function applyTrackUpdates(
  file: CollectionsFile,
  updates: TrackUpdate[],
  at: string,
  today: string,
): { file: CollectionsFile; lines: string[] } {
  let next: CollectionsFile = {
    collections: file.collections.map((c) => ({
      ...c,
      statics: c.statics.map((s) => ({ ...s })),
      variables: c.variables.map((v) => ({ ...v, samples: [...v.samples] })),
    })),
  };
  const lines: string[] = [];
  for (const u of updates) {
    if (u.kind === "static") {
      let hit = false;
      next = {
        collections: next.collections.map((c) => ({
          ...c,
          statics: c.statics.map((s) => {
            if (s.id !== u.id) return s;
            hit = true;
            const value = String(u.value);
            lines.push(`• ${c.name} / ${s.name}: ${value}`);
            return { ...s, value };
          }),
        })),
      };
      if (!hit) lines.push(`• skipped unknown static ${u.id}`);
      continue;
    }
    const value = typeof u.value === "number" ? u.value : Number(u.value);
    if (!Number.isFinite(value)) {
      lines.push(`• skipped ${u.id}: not a number`);
      continue;
    }
    const date = u.logDate && /^\d{4}-\d{2}-\d{2}$/.test(u.logDate) ? u.logDate : undefined;
    let hit = false;
    next = {
      collections: next.collections.map((c) => ({
        ...c,
        variables: c.variables.map((v) => {
          if (v.id !== u.id) return v;
          hit = true;
          const logDate = date || today;
          const sample: TrackSample = {
            date: logDate,
            value,
            at,
            note: u.note,
            source: u.source ?? "chat",
          };
          // Keep prior same-day points so edits stay in the timestamp history;
          // charts/lastSample still use the latest by `at`.
          const samples = [...v.samples, sample].sort(
            (a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at),
          );
          lines.push(`• ${c.name} / ${v.name}: ${value}${v.unit ? ` ${v.unit}` : ""} on ${logDate}`);
          return { ...v, samples };
        }),
      })),
    };
    if (!hit) lines.push(`• skipped unknown variable ${u.id}`);
  }
  return { file: next, lines };
}

export function builtinValue(id: BuiltinSeriesId, day: CalorieDay | null | undefined): number | null {
  if (!day || day.items.length === 0) return null;
  const tot = dayCalorieTotals(day);
  const macros = dayMacroTotals(day);
  switch (id) {
    case "calorie_deficit":
      return day.goalKcal - tot.net;
    case "eaten":
      return tot.eaten;
    case "burned":
      return tot.burned;
    case "net":
      return tot.net;
    case "protein":
      return macros.protein;
    case "carbs":
      return macros.carbs;
    case "fat":
      return macros.fat;
    default:
      return null;
  }
}

export type ChartSeries = {
  key: string;
  label: string;
  unit: string;
  points: { date: string; value: number | null }[];
};

export function variableSeries(
  variable: TrackVariable,
  collectionName: string,
  start: string,
  end: string,
): ChartSeries {
  const byDate = new Map<string, number>();
  for (const s of variable.samples) {
    if (s.date < start || s.date > end) continue;
    byDate.set(s.date, s.value);
  }
  return {
    key: variable.id,
    label: `${collectionName} / ${variable.name}`,
    unit: variable.unit || "",
    points: datesInRange(start, end).map((date) => ({
      date,
      value: byDate.has(date) ? byDate.get(date)! : null,
    })),
  };
}

export function builtinSeries(
  id: BuiltinSeriesId,
  calories: Record<string, CalorieDay>,
  start: string,
  end: string,
): ChartSeries {
  const meta = BUILTIN_SERIES.find((s) => s.id === id)!;
  return {
    key: id,
    label: meta.name,
    unit: meta.unit,
    points: datesInRange(start, end).map((date) => ({
      date,
      value: builtinValue(id, calories[date]),
    })),
  };
}

export function seriesExtent(series: ChartSeries): { min: number; max: number } | null {
  const nums = series.points.map((p) => p.value).filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  return { min, max };
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const step = span / count;
  const mag = 10 ** Math.floor(Math.log10(step));
  const norm = step / mag;
  const nice = norm >= 7.5 ? 10 * mag : norm >= 3 ? 5 * mag : norm >= 1.5 ? 2 * mag : mag;
  const start = Math.ceil(min / nice) * nice;
  const ticks: number[] = [];
  for (let v = start; v <= max + nice * 0.01; v += nice) ticks.push(v);
  if (ticks.length === 0) return [min, max];
  return ticks;
}

export function formatTick(n: number, unit: string): string {
  const abs = Math.abs(n);
  const text = abs >= 100 ? n.toFixed(0) : abs >= 10 ? n.toFixed(1) : n.toFixed(2);
  return unit ? `${text} ${unit}` : text;
}

export function resolveChartSeries(
  sel: { type: string; id: string },
  collections: CollectionsFile,
  calories: Record<string, CalorieDay>,
  start: string,
  end: string,
): ChartSeries | null {
  const raw = sel.id.trim().toLowerCase();
  const key = raw.replace(/[\s-]+/g, "_");
  const builtin = BUILTIN_SERIES.find(
    (b) =>
      b.id === sel.id ||
      b.id === key ||
      b.name.toLowerCase() === raw ||
      b.name.toLowerCase().replace(/[\s-]+/g, "_") === key,
  );
  if (sel.type === "builtin" || builtin) {
    if (builtin) return builtinSeries(builtin.id, calories, start, end);
  }
  const hit = allVariables(collections).find(
    ({ variable }) =>
      variable.id === sel.id ||
      variable.name.toLowerCase() === raw ||
      variable.name.toLowerCase().replace(/[\s-]+/g, "_") === key,
  );
  if (hit) return variableSeries(hit.variable, hit.collection.name, start, end);
  return null;
}
