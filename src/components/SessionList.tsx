import type { DiaryEntry } from "../lib/types";
import { formatStamp } from "../lib/dates";
import { useRef } from "react";

type Props = {
  entries: { date: string; entry: DiaryEntry }[];
  currentId: string;
  busy: boolean;
  deletingId: string | null;
  onNew: () => void;
  onSelect: (date: string, entryId: string) => void;
  onDelete: (date: string, entryId: string) => void;
  sheet?: boolean;
  onClose?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export function SessionList({
  entries,
  currentId,
  busy,
  deletingId,
  onNew,
  onSelect,
  onDelete,
  sheet,
  onClose,
  hasMore,
  loadingMore,
  onLoadMore,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  return (
    <aside
      className={`flex flex-col bg-paper-2 ${
        sheet ? "h-full w-full" : "w-full border-ink/15 md:h-full md:w-72 md:border-r"
      }`}
    >
      <div className="border-b border-ink/15 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs tracking-[0.14em] uppercase text-ink-mute">Sessions</p>
          {sheet && onClose ? (
            <button type="button" className="text-sm text-ink-mute" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          className="mt-3 w-full border border-ink bg-ink px-3 py-2.5 text-sm text-paper disabled:opacity-40"
        >
          New session
        </button>
      </div>
      <ul
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={() => {
          if (!hasMore || loadingMore || !onLoadMore || !listRef.current) return;
          const el = listRef.current;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) onLoadMore();
        }}
      >
        {entries.length === 0 ? (
          <li className="px-4 py-6 text-sm text-ink-mute">No sessions yet.</li>
        ) : (
          entries.map(({ date, entry }) => {
            const active = entry.id === currentId;
            return (
              <li
                key={entry.id}
                className={`border-b border-ink/10 ${active ? "bg-paper" : ""}`}
              >
                <div className="flex items-start gap-2 px-3 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(date, entry.id)}
                  >
                    <span className="block truncate font-serif text-[15px] text-ink">
                      {entry.title || "Untitled"}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-mute">
                      {date} · {formatStamp(entry.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 pt-0.5 text-xs text-ink-mute hover:text-ink"
                    disabled={Boolean(deletingId)}
                    onClick={() => onDelete(date, entry.id)}
                  >
                    {deletingId === entry.id ? "…" : "Delete"}
                  </button>
                </div>
              </li>
            );
          })
        )}
        {loadingMore ? (
          <li className="px-4 py-3 text-center text-xs text-ink-mute">Loading…</li>
        ) : null}
        {hasMore && !loadingMore ? (
          <li className="px-4 py-3 text-center">
            <button type="button" className="text-xs text-accent" onClick={onLoadMore}>
              Load older
            </button>
          </li>
        ) : null}
      </ul>
    </aside>
  );
}
