import type { DiaryEntry } from "../lib/types";
import { formatStamp } from "../lib/dates";

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
}: Props) {
  return (
    <aside
      className={`flex flex-col bg-paper-2 ${
        sheet ? "h-full w-full" : "w-full border-ink/15 md:h-full md:w-72 md:border-r"
      }`}
    >
      <div className="flex items-center justify-between border-b border-ink/15 px-4 py-3">
        <p className="text-xs tracking-[0.14em] uppercase text-ink-mute">Sessions</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onNew}
            disabled={busy}
            className="text-sm text-accent underline-offset-4 hover:underline disabled:opacity-40"
          >
            New
          </button>
          {sheet && onClose ? (
            <button type="button" className="text-sm text-ink-mute" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
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
      </ul>
    </aside>
  );
}
