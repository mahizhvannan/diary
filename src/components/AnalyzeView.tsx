"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearAnalyzeOut,
  listAnalyzeOut,
  readAnalyzeOut,
  streamCursorChat,
  syncAnalyzeWorkspace,
  type OutArtifactMeta,
} from "../lib/cursor-client";
import type { DiarySnapshot } from "../lib/analyze-types";
import type { ArtifactFile, ArtifactsIndex } from "../lib/types";
import { artifactFromOutFile } from "../lib/artifacts";
import { formatStamp } from "../lib/dates";
import { MarkdownBody } from "./MarkdownBody";
import { ArtifactRenderer, ArtifactViewerPanel } from "./ArtifactViewer";

type ChatLine = { id: string; role: "user" | "assistant"; text: string; at: string };

type Preview = {
  relativePath: string;
  mimeType: string;
  content: string;
  kind: "html" | "svg" | "md";
};

type Props = {
  workspaceId: string;
  driveToken: string;
  buildSnapshot: () => Promise<DiarySnapshot>;
  onLogArtifacts: (files: ArtifactFile[]) => Promise<void> | void;
  loggedArtifacts: ArtifactsIndex;
  onOpenLoggedArtifact: (id: string) => Promise<ArtifactFile | null>;
};

function previewKind(path: string, mime?: string): Preview["kind"] | null {
  const lower = path.toLowerCase();
  if (mime?.includes("html") || lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (mime?.includes("svg") || lower.endsWith(".svg")) return "svg";
  if (mime?.includes("markdown") || lower.endsWith(".md")) return "md";
  return null;
}

export function AnalyzeView({
  workspaceId,
  driveToken,
  buildSnapshot,
  onLogArtifacts,
  loggedArtifacts,
  onOpenLoggedArtifact,
}: Props) {
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [pending, setPending] = useState<OutArtifactMeta[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [logging, setLogging] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<{ input: number; output: number } | null>(null);
  const [viewingLogged, setViewingLogged] = useState<ArtifactFile | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, busy, previews, viewingLogged]);

  const loadPreviews = async (artifacts: OutArtifactMeta[]) => {
    const next: Preview[] = [];
    for (const meta of artifacts) {
      const kind = previewKind(meta.relativePath);
      if (!kind) continue;
      if (next.length >= 4) break;
      try {
        const file = await readAnalyzeOut(workspaceId, driveToken, meta.relativePath);
        const k = previewKind(file.relativePath, file.mimeType);
        if (!k) continue;
        next.push({
          relativePath: file.relativePath,
          mimeType: file.mimeType,
          content: file.content,
          kind: k,
        });
      } catch {
        /* skip */
      }
    }
    setPreviews(next);
  };

  const refreshPending = async () => {
    try {
      const list = await listAnalyzeOut(workspaceId, driveToken);
      setPending(list);
      await loadPreviews(list);
    } catch {
      /* workspace may not exist yet */
    }
  };

  useEffect(() => {
    if (!workspaceId || !driveToken) return;
    void refreshPending();
  }, [workspaceId, driveToken]);

  const syncLocal = async () => {
    setSyncing(true);
    setError(null);
    try {
      if (!workspaceId || !driveToken) throw new Error("Connect Google Drive before Analyze.");
      const snapshot = await buildSnapshot();
      await syncAnalyzeWorkspace(workspaceId, driveToken, snapshot);
      setSyncedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
      throw e;
    } finally {
      setSyncing(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!workspaceId || !driveToken) {
      setError("Connect Google Drive before Analyze.");
      return;
    }
    setDraft("");
    setError(null);
    setViewingLogged(null);
    const userLine: ChatLine = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      at: new Date().toISOString(),
    };
    setLines((prev) => [...prev, userLine]);
    setBusy(true);

    const assistantId = crypto.randomUUID();
    setLines((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", text: "", at: new Date().toISOString() },
    ]);

    try {
      if (!syncedAt) await syncLocal();
      const done = await streamCursorChat({
        workspaceId,
        driveToken,
        message: text,
        agentId,
        onAgent: setAgentId,
        onText: (chunk) => {
          setLines((prev) =>
            prev.map((l) => (l.id === assistantId ? { ...l, text: l.text + chunk } : l)),
          );
        },
      });
      setAgentId(done.agentId || agentId);
      if (done.result) {
        setLines((prev) =>
          prev.map((l) =>
            l.id === assistantId && !l.text.trim() ? { ...l, text: done.result } : l,
          ),
        );
      }
      if (done.usage) {
        setLastUsage({ input: done.usage.inputTokens, output: done.usage.outputTokens });
      }
      setPending(done.artifacts);
      await loadPreviews(done.artifacts);
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
      const files: ArtifactFile[] = [];
      for (const meta of pending) {
        const file = await readAnalyzeOut(workspaceId, driveToken, meta.relativePath);
        files.push(
          artifactFromOutFile({
            relativePath: file.relativePath,
            content: file.content,
            mimeType: file.mimeType,
          }),
        );
      }
      await onLogArtifacts(files);
      await clearAnalyzeOut(workspaceId, driveToken);
      setPending([]);
      setPreviews([]);
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
          Cursor agent over your local diary copy. Charts and Markdown render inline. Log saves to
          Drive — reopen from Logged below or Settings → Artifacts.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-mute">
          <button
            type="button"
            disabled={syncing || busy}
            className="border border-ink/30 px-2 py-1 disabled:opacity-40"
            onClick={() => void syncLocal().catch(() => undefined)}
          >
            {syncing ? "Syncing…" : "Refresh local data"}
          </button>
          {syncedAt ? <span>Synced {formatStamp(syncedAt)}</span> : <span>Not synced yet</span>}
          {agentId ? <span className="font-mono">agent {agentId.slice(0, 12)}…</span> : null}
          {lastUsage ? (
            <span>
              Last run · in {lastUsage.input.toLocaleString()} / out {lastUsage.output.toLocaleString()}{" "}
              tok
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {lines.length === 0 ? (
          <p className="max-w-xl font-serif text-[17px] leading-7 text-ink-mute">
            Ask for trends, comparisons, or a chart. Example: “Plot carbs vs weight for the last 30
            days as an HTML chart.”
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {lines.map((l) => (
              <li key={l.id} className="max-w-3xl">
                <p className="text-xs tracking-[0.12em] text-ink-mute uppercase">
                  {l.role === "user" ? "You" : "Cursor"} · {formatStamp(l.at)}
                </p>
                {l.role === "assistant" ? (
                  <div className="mt-1">
                    {l.text || (busy ? "…" : "") ? (
                      <MarkdownBody text={l.text || (busy ? "…" : "")} />
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap font-serif text-[17px] leading-7">{l.text}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {previews.length > 0 ? (
          <div className="mt-6 flex flex-col gap-4">
            <p className="text-xs tracking-[0.12em] text-ink-mute uppercase">Pending preview</p>
            {previews.map((p) => (
              <div key={p.relativePath} className="max-w-3xl">
                <p className="mb-2 text-xs text-ink-mute">{p.relativePath}</p>
                {p.kind === "md" ? (
                  <div className="border border-ink/15 p-3">
                    <MarkdownBody text={p.content} />
                  </div>
                ) : (
                  <ArtifactRenderer
                    artifact={{
                      id: p.relativePath,
                      title: p.relativePath,
                      kind: p.kind,
                      mimeType: p.mimeType,
                      content: p.content,
                      encoding: "utf8",
                      createdAt: new Date().toISOString(),
                      sourcePath: p.relativePath,
                    }}
                  />
                )}
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
        <div className="border-t border-ink/15 px-6 py-3">
          <div className="flex items-center justify-between gap-3">
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
          <ul className="mt-2 max-h-28 overflow-y-auto text-xs text-ink-mute">
            {pending.map((a) => (
              <li key={a.relativePath}>
                {a.relativePath} · {Math.round(a.size / 1024)}kb · {formatStamp(a.updatedAt)}
              </li>
            ))}
          </ul>
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
          placeholder="Ask AnalyzeBeta…"
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
