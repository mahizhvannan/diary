import type { ChatAttachment, CustomSkill, DiaryEntry } from "../lib/types";
import { formatStamp } from "../lib/dates";
import { matchingSkills, mentionQuery } from "../lib/skills";
import { useEffect, useRef, useState } from "react";

type Props = {
  entry: DiaryEntry;
  savedToDrive: boolean;
  busy: boolean;
  error: string | null;
  draft: string;
  pending: ChatAttachment[];
  compact?: boolean;
  customSkills?: CustomSkill[];
  onDraft: (v: string) => void;
  onPending: (files: ChatAttachment[]) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onSend: () => void;
  onLog: () => void;
  onNew?: () => void;
};

export function ChatPane({
  entry,
  savedToDrive,
  busy,
  error,
  draft,
  pending,
  compact,
  customSkills = [],
  onDraft,
  onPending,
  onAddFiles,
  onSend,
  onLog,
  onNew,
}: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLFormElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const mention = mentionQuery(draft, cursor);
  const skills = mention ? matchingSkills(mention.query, customSkills) : [];
  const showMenu = menuOpen && skills.length > 0;

  useEffect(() => {
    if (mention && matchingSkills(mention.query, customSkills).length > 0) setMenuOpen(true);
    else setMenuOpen(false);
  }, [mention?.query, mention?.start, draft, customSkills]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const insertSkill = (tag: string) => {
    const start = mention?.start ?? 0;
    const next = `${draft.slice(0, start)}${tag} ${draft.slice(cursor)}`;
    const pos = start + tag.length + 1;
    setMenuOpen(false);
    onDraft(next);
    setCursor(pos);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };

  const canLog = entry.messages.length > 0 && !busy;
  const canSend = !busy && (Boolean(draft.trim()) || pending.length > 0);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className={`border-b border-ink/15 ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <div className="flex items-start justify-between gap-3">
          <h1 className={`min-w-0 font-serif text-ink ${compact ? "text-xl" : "text-2xl"}`}>
            {entry.title || "New session"}
          </h1>
          {onNew ? (
            <button
              type="button"
              disabled={busy}
              onClick={onNew}
              className="shrink-0 border border-ink px-3 py-1.5 text-sm text-ink disabled:opacity-40"
            >
              New
            </button>
          ) : null}
        </div>
        {compact ? null : (
          <p className="mt-1 text-sm text-ink-mute">
            Chat as usual. Type @ for skills. Log files the conversation on Drive.
            {savedToDrive ? " Already on Drive; Log again to update." : ""}
          </p>
        )}
      </header>

      <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-4 py-4" : "px-5 py-6"}`}>
        {entry.messages.length === 0 ? (
          <p className="max-w-xl font-serif text-lg leading-relaxed text-ink-mute">
            Talk first. Try @calories for food, @track for weight and other variables, or attach a meal photo.
            Nothing is filed in the diary until you press Log.
          </p>
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-8">
            {entry.messages.map((m) => (
              <li key={m.id} className="flex flex-col gap-1">
                <span className="text-xs tracking-wide text-ink-mute uppercase">
                  {m.role === "user" ? "You" : "Clerk"} · {formatStamp(m.at)}
                </span>
                {m.attachments?.length ? (
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {m.attachments.map((a) => (
                      <li key={a.id}>
                        {a.mimeType.startsWith("image/") ? (
                          <img
                            src={a.dataUrl}
                            alt={a.name}
                            className="max-h-40 max-w-full border border-ink/15 object-cover"
                          />
                        ) : (
                          <span className="border border-ink/20 px-2 py-1 text-xs">{a.name}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.text ? (
                  <p
                    className={`whitespace-pre-wrap font-serif text-[17px] leading-7 ${
                      m.role === "user" ? "text-ink" : "text-ink/90"
                    }`}
                  >
                    {m.text}
                  </p>
                ) : null}
                {m.period ? (
                  <span className="text-[11px] text-ink-mute">
                    {m.period.skill}
                    {m.period.cached ? " · cached" : ""} · {m.period.startLogId.slice(0, 8)}
                    {m.period.startLogId === m.period.endLogId
                      ? ""
                      : ` → ${m.period.endLogId.slice(0, 8)}`}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <footer className={`border-t border-ink/15 ${compact ? "p-3" : "p-4"}`}>
        {error ? <p className="mb-2 text-sm text-ink">{error}</p> : null}
        <form
          ref={box}
          className="relative mx-auto flex max-w-2xl flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          {showMenu ? (
            <ul className="absolute bottom-full left-0 z-20 mb-1 w-64 border border-ink/20 bg-paper shadow-none">
              {skills.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-paper-2"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertSkill(s.tag);
                    }}
                  >
                    <span className="font-medium">{s.tag}</span>
                    <span className="mt-0.5 block text-xs text-ink-mute">{s.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {pending.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {pending.map((a) => (
                <li key={a.id} className="relative">
                  {a.mimeType.startsWith("image/") ? (
                    <img src={a.dataUrl} alt={a.name} className="h-14 w-14 object-cover border border-ink/20" />
                  ) : (
                    <span className="block max-w-[9rem] truncate border border-ink/20 px-2 py-1 text-xs">
                      {a.name}
                    </span>
                  )}
                  <button
                    type="button"
                    className="absolute -top-1 -right-1 bg-ink px-1 text-[10px] text-paper"
                    onClick={() => onPending(pending.filter((p) => p.id !== a.id))}
                    aria-label={`Remove ${a.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={area}
            value={draft}
            onChange={(e) => {
              onDraft(e.target.value);
              setCursor(e.target.selectionStart);
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            rows={compact ? 4 : 5}
            placeholder="Chat, photo, @calories, @track, @weekly, or @monthly"
            className={`w-full resize-y border border-ink/20 bg-paper px-3 py-2.5 font-serif text-base leading-6 text-ink outline-none focus:border-accent ${
              compact ? "min-h-[6.5rem]" : "min-h-[8rem]"
            }`}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setMenuOpen(false);
                return;
              }
              if (showMenu && (e.key === "Tab" || e.key === "Enter") && !e.shiftKey) {
                e.preventDefault();
                insertSkill(skills[0].tag);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onAddFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={files}
            type="file"
            accept="image/*,.pdf,.txt,.csv,.json"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onAddFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Take photo"
                aria-label="Take photo"
                className="flex h-9 w-9 items-center justify-center text-ink-mute"
                onClick={() => camera.current?.click()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="3" y="7" width="18" height="13" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="12" cy="13.5" r="3.2" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M8 7 9.5 4h5L16 7" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
              <button
                type="button"
                title="Attach files"
                aria-label="Attach files"
                className="flex h-9 w-9 items-center justify-center text-ink-mute"
                onClick={() => files.current?.click()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M8 12.5V8.2A4 4 0 0 1 16 8v9.2a3.2 3.2 0 1 1-6.4 0V9.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </svg>
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canLog}
                onClick={onLog}
                className="border border-ink px-4 py-1.5 text-sm text-ink disabled:opacity-40"
              >
                Log
              </button>
              <button
                type="submit"
                disabled={!canSend}
                className="border border-ink bg-ink px-4 py-1.5 text-sm text-paper disabled:opacity-40"
              >
                {busy ? "Working…" : "Send"}
              </button>
            </div>
          </div>
        </form>
      </footer>
    </section>
  );
}
