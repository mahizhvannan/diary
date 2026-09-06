"use client";

import { useEffect, useRef, useState } from "react";
import { callGemini } from "../lib/gemini-client";
import { packDiarySnapshotForAnalyze } from "../lib/analyze-pack";
import type { DiarySnapshot } from "../lib/analyze-types";
import type { ArtifactFile, ArtifactsIndex, CalorieDay, CollectionsFile } from "../lib/types";
import { artifactFromOutFile } from "../lib/artifacts";
import { formatStamp, todayIsoDate } from "../lib/dates";
import { addDaysIso } from "../lib/parse-date";
import { datesInRange } from "../lib/period";
import {
  formatTick,
  niceTicks,
  packExportCatalog,
  resolveChartSeries,
  seriesExtent,
  type ChartSeries,
} from "../lib/track";
import { MarkdownBody } from "./MarkdownBody";
import { ArtifactRenderer, ArtifactViewerPanel } from "./ArtifactViewer";

type ChatLine = { id: string; role: "user" | "assistant"; text: string; at: string };

type PendingArtifact = {
  title: string;
  kind: "html" | "svg" | "md";
  content: string;
};

type Props = {
  collections: CollectionsFile;
  buildSnapshot: () => Promise<DiarySnapshot>;
  onNeedRange: (start: string, end: string) => Promise<Record<string, CalorieDay>>;
  onLogArtifacts: (files: ArtifactFile[]) => Promise<void> | void;
  loggedArtifacts: ArtifactsIndex;
  onOpenLoggedArtifact: (id: string) => Promise<ArtifactFile | null>;
};

const STROKES = [
  { width: 1.8, dash: undefined as string | undefined, opacity: 1 },
  { width: 1.5, dash: "6 4", opacity: 1 },
  { width: 1.4, dash: "2 3", opacity: 0.9 },
];

function ScaledChart({ series }: { series: ChartSeries[] }) {
  const w = 720;
  const h = 280;
  const padL = 58;
  const padR = series.length > 1 ? 58 : 28;
  const padY = 24;
  const innerW = w - padL - padR;
  const innerH = h - padY * 2;
  const dates = series[0]?.points.map((p) => p.date) ?? [];
  const n = Math.max(1, dates.length - 1);
  const x = (i: number) => padL + (i * innerW) / n;
  const extents = series.map(seriesExtent);
  const yFor = (si: number, value: number) => {
    const ext = extents[si];
    if (!ext) return padY + innerH / 2;
    const t = (value - ext.min) / (ext.max - ext.min || 1);
    return padY + (1 - t) * innerH;
  };
  const pathFor = (si: number) => {
    const pts = series[si].points;
    let d = "";
    let drawing = false;
    pts.forEach((p, i) => {
      if (p.value == null) {
        drawing = false;
        return;
      }
      const cmd = drawing ? "L" : "M";
      d += `${cmd} ${x(i)} ${yFor(si, p.value)} `;
      drawing = true;
    });
    return d.trim();
  };
  const xLabels = dates.filter(
    (_, i) => i === 0 || i === dates.length - 1 || i % Math.ceil(dates.length / 6) === 0,
  );
  if (series.length === 0 || dates.length === 0) {
    return <p className="text-sm text-ink-mute">No series to plot.</p>;
  }
  const left = extents[0];
  const right = extents[1];
  const leftTicks = left ? niceTicks(left.min, left.max) : [];
  const rightTicks = right ? niceTicks(right.min, right.max) : [];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-3xl text-ink" role="img">
      <line x1={padL} y1={h - padY} x2={w - padR} y2={h - padY} stroke="currentColor" opacity="0.3" />
      <line x1={padL} y1={padY} x2={padL} y2={h - padY} stroke="currentColor" opacity="0.25" />
      {series.length > 1 ? (
        <line x1={w - padR} y1={padY} x2={w - padR} y2={h - padY} stroke="currentColor" opacity="0.25" />
      ) : null}
      {leftTicks.map((t) => (
        <text key={`l-${t}`} x={padL - 6} y={yFor(0, t) + 3} textAnchor="end" fontSize="9" fill="currentColor" opacity="0.7">
          {formatTick(t, series[0].unit)}
        </text>
      ))}
      {right && series[1]
        ? rightTicks.map((t) => (
            <text key={`r-${t}`} x={w - padR + 6} y={yFor(1, t) + 3} textAnchor="start" fontSize="9" fill="currentColor" opacity="0.7">
              {formatTick(t, series[1].unit)}
            </text>
          ))
        : null}
      {series.map((s, si) => {
        const st = STROKES[si % STROKES.length];
        return (
          <path
            key={s.key}
            d={pathFor(si)}
            fill="none"
            stroke="currentColor"
            strokeWidth={st.width}
            strokeDasharray={st.dash}
            opacity={st.opacity}
          />
        );
      })}
      {xLabels.map((date) => {
        const i = dates.indexOf(date);
        return (
          <text key={date} x={x(i)} y={h - 6} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.65">
            {date.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

export function AnalyzeView({
  collections,
  buildSnapshot,
  onNeedRange,
  onLogArtifacts,
  loggedArtifacts,
  onOpenLoggedArtifact,
}: Props) {
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<ChartSeries[]>([]);
  const [pending, setPending] = useState<PendingArtifact[]>([]);
  const [logging, setLogging] = useState(false);
  const [viewingLogged, setViewingLogged] = useState<ArtifactFile | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, busy, series, pending, viewingLogged]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    setViewingLogged(null);
    const userLine: ChatLine = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      at: new Date().toISOString(),
    };
    const nextLines = [...lines, userLine];
    setLines(nextLines);
    setBusy(true);

    const assistantId = crypto.randomUUID();
    setLines((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", text: "", at: new Date().toISOString() },
    ]);

    try {
      const snapshot = await buildSnapshot();
      const packed = packDiarySnapshotForAnalyze(snapshot);
      const result = await callGemini({
        mode: "analyze",
        question: text,
        today: todayIsoDate(),
        catalog: packExportCatalog(collections),
        packed,
        history: nextLines.map((l) => ({ role: l.role, text: l.text })),
      });
      if (!result.ok) {
        setError(result.message);
        setLines((prev) =>
          prev.map((l) => (l.id === assistantId ? { ...l, text: result.message } : l)),
        );
        return;
      }
      if (result.mode !== "analyze") {
        setError("Could not analyze.");
        return;
      }

      setLines((prev) =>
        prev.map((l) => (l.id === assistantId ? { ...l, text: result.data.reply } : l)),
      );

      if (result.data.artifact) {
        setPending((prev) => [...prev, result.data.artifact!]);
      } else {
        setPending([]);
      }

      const chart = result.data.chart;
      if (chart) {
        let { start, end } = chart;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
          setSeries([]);
        } else {
          if (start > end) [start, end] = [end, start];
          if (datesInRange(start, end).length > 93) start = addDaysIso(end, -92);
          const calMap = await onNeedRange(start, end);
          const built: ChartSeries[] = [];
          for (const sel of chart.series) {
            const row = resolveChartSeries(sel, collections, calMap, start, end);
            if (row && !built.some((s) => s.key === row.key)) built.push(row);
          }
          setSeries(built);
        }
      } else {
        setSeries([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analyze failed";
      setError(msg);
      setLines((prev) =>
        prev.map((l) => (l.id === assistantId && !l.text.trim() ? { ...l, text: msg } : l)),
      );
    } finally {
      setBusy(false);
    }
  };

  const onLog = async () => {
    if (logging || pending.length === 0) return;
    setLogging(true);
    setError(null);
    try {
      const files = pending.map((p) =>
        artifactFromOutFile({
          relativePath: `${p.title.replace(/\s+/g, "-").toLowerCase()}.${p.kind === "md" ? "md" : p.kind === "svg" ? "svg" : "html"}`,
          content: p.content,
          mimeType:
            p.kind === "md" ? "text/markdown" : p.kind === "svg" ? "image/svg+xml" : "text/html",
        }),
      );
      await onLogArtifacts(files);
      setPending([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Log failed");
    } finally {
      setLogging(false);
    }
  };

  if (viewingLogged) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactViewerPanel artifact={viewingLogged} onClose={() => setViewingLogged(null)} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-ink/15 px-6 py-4">
        <h1 className="flex items-baseline gap-2 font-serif text-2xl">
          Analyze
          <span className="rounded-sm bg-accent px-1.5 py-0.5 font-sans text-[10px] tracking-wide text-paper uppercase">
            beta
          </span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-mute">
          Gemini (AI Studio API) over your local diary copy — works on phone. Charts and Markdown
          render inline; Log saves artifacts to Drive.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {lines.length === 0 ? (
          <p className="max-w-xl font-serif text-[17px] leading-7 text-ink-mute">
            Ask for trends or a chart. Example: “Pie chart of macros for 2026-09-06” or “Carbs vs
            weight last 30 days”.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {lines.map((l) => (
              <li key={l.id} className="max-w-3xl">
                <p className="text-xs tracking-[0.12em] text-ink-mute uppercase">
                  {l.role === "user" ? "You" : "Gemini"} · {formatStamp(l.at)}
                </p>
                {l.role === "assistant" ? (
                  <div className="mt-1">
                    {l.text ? <MarkdownBody text={l.text} /> : busy ? <p className="font-serif">…</p> : null}
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap font-serif text-[17px] leading-7">{l.text}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {series.length > 0 ? (
          <div className="mt-6 max-w-3xl">
            <p className="mb-2 text-xs tracking-[0.12em] text-ink-mute uppercase">Chart</p>
            <ScaledChart series={series} />
          </div>
        ) : null}

        {pending.length > 0 ? (
          <div className="mt-6 flex flex-col gap-4">
            <p className="text-xs tracking-[0.12em] text-ink-mute uppercase">Pending artifact</p>
            {pending.map((p, i) => (
              <div key={`${p.title}-${i}`} className="max-w-3xl">
                <p className="mb-2 text-xs text-ink-mute">{p.title}</p>
                <ArtifactRenderer
                  artifact={{
                    id: `pending-${i}`,
                    title: p.title,
                    kind: p.kind,
                    mimeType:
                      p.kind === "md"
                        ? "text/markdown"
                        : p.kind === "svg"
                          ? "image/svg+xml"
                          : "text/html",
                    content: p.content,
                    encoding: "utf8",
                    createdAt: new Date().toISOString(),
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}

        {loggedArtifacts.items.length > 0 ? (
          <div className="mt-8 max-w-3xl border-t border-ink/15 pt-4">
            <p className="text-xs tracking-[0.12em] text-ink-mute uppercase">Logged</p>
            <ul className="mt-2 divide-y divide-ink/10">
              {loggedArtifacts.items.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                    disabled={openingId === a.id}
                    onClick={() => {
                      setOpeningId(a.id);
                      setError(null);
                      void Promise.resolve(onOpenLoggedArtifact(a.id))
                        .then((file) => {
                          if (!file) {
                            setError("Could not open artifact.");
                            return;
                          }
                          setViewingLogged(file);
                        })
                        .catch((e) => setError(e instanceof Error ? e.message : "Open failed"))
                        .finally(() => setOpeningId(null));
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.title}</span>
                      <span className="mt-0.5 block text-xs text-ink-mute">
                        {a.kind} · {formatStamp(a.createdAt)}
                        {openingId === a.id ? " · opening…" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-mute">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div ref={bottom} />
      </div>

      {error ? <p className="px-6 pb-2 text-sm">{error}</p> : null}

      {pending.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-ink/15 px-6 py-3">
          <p className="text-sm">Pending artifacts · {pending.length}</p>
          <button
            type="button"
            disabled={logging || busy}
            className="border border-ink bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-40"
            onClick={() => void onLog()}
          >
            {logging ? "Logging…" : "Log"}
          </button>
        </div>
      ) : null}

      <form
        className="flex gap-2 border-t border-ink/15 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Ask Analyze…"
          className="min-h-[2.75rem] flex-1 resize-y border border-ink/20 bg-paper px-3 py-2 font-serif text-base leading-6 outline-none focus:border-accent"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="self-end border border-ink bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-40"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
