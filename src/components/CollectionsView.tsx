"use client";

import { useEffect, useMemo, useState } from "react";
import { formatStamp, todayIsoDate } from "../lib/dates";
import { applyTrackUpdates, lastSample } from "../lib/track";
import type { CollectionsFile, TrackCollection, TrackVariable } from "../lib/types";

type Props = {
  file: CollectionsFile;
  syncLabel?: string | null;
  onChange: (next: CollectionsFile) => Promise<void> | void;
};

function uid(): string {
  return crypto.randomUUID();
}

function cloneFile(file: CollectionsFile): CollectionsFile {
  return {
    collections: file.collections.map((c) => ({
      ...c,
      statics: c.statics.map((s) => ({ ...s })),
      variables: c.variables.map((v) => ({
        ...v,
        samples: v.samples.map((s) => ({ ...s })),
      })),
    })),
  };
}

function sameFile(a: CollectionsFile, b: CollectionsFile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function CollectionsView({ file, syncLabel, onChange }: Props) {
  const [draft, setDraft] = useState(() => cloneFile(file));
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingVarId, setEditingVarId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newCollection, setNewCollection] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(cloneFile(file));
    setStatus(null);
    setError(null);
  }, [file]);

  const dirty = useMemo(() => !sameFile(draft, file), [draft, file]);

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(draft);
      setStatus("Saved locally — syncing to Drive…");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const addCollection = () => {
    const name = newCollection.trim();
    if (!name) return;
    const id = uid();
    setDraft({
      collections: [...draft.collections, { id, name, statics: [], variables: [] }],
    });
    setNewCollection("");
    setOpenId(id);
    setCreating(false);
    setRenaming(false);
    setEditingVarId(null);
    setStatus("Unsaved — press Save.");
  };

  const patchCollection = (id: string, next: TrackCollection) => {
    setDraft({
      collections: draft.collections.map((c) => (c.id === id ? next : c)),
    });
    setStatus("Unsaved — press Save.");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">Collections</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-mute">
            Open a collection, edit values, then Save. Local write is instant; Drive sync retries in
            the background.
          </p>
        </div>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void save()}
          className="border border-ink bg-ink px-4 py-1.5 text-sm text-paper disabled:opacity-40"
        >
          {busy ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>
      {status ? <p className="mt-2 text-sm text-ink-mute">{status}</p> : null}
      {syncLabel ? <p className="mt-1 text-xs text-ink-mute">{syncLabel}</p> : null}
      {error ? <p className="mt-2 text-sm">{error}</p> : null}

      <div className="mt-6 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          New collection
          <input
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCollection();
              }
            }}
            placeholder="Health"
            className="mt-1 block w-56 border border-ink/20 bg-paper px-2 py-1 text-ink"
          />
        </label>
        <button
          type="button"
          disabled={!newCollection.trim() || busy}
          onClick={addCollection}
          className="border border-ink/40 px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {draft.collections.length === 0 ? (
        <p className="mt-8 text-sm text-ink-mute">No collections yet.</p>
      ) : (
        <ul className="mt-8 max-w-2xl divide-y divide-ink/10 border border-ink/15">
          {draft.collections.map((c) => {
            const open = openId === c.id;
            return (
              <li key={c.id}>
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:opacity-80"
                    aria-expanded={open}
                    onClick={() => {
                      setOpenId(open ? null : c.id);
                      setEditingVarId(null);
                      setCreating(false);
                      setRenaming(false);
                    }}
                  >
                    {renaming && open ? (
                      <span className="font-serif text-lg text-ink-mute">Editing name…</span>
                    ) : (
                      <span className="truncate font-serif text-lg">{c.name}</span>
                    )}
                    <span className="shrink-0 text-xs text-ink-mute">
                      {c.variables.length + c.statics.length} items · {open ? "▴" : "▾"}
                    </span>
                  </button>
                </div>
                {open ? (
                  <CollectionPanel
                    collection={c}
                    busy={busy}
                    creating={creating}
                    renaming={renaming}
                    editingVarId={editingVarId}
                    onCreating={setCreating}
                    onRenaming={setRenaming}
                    onEditingVarId={setEditingVarId}
                    onPatch={(next) => patchCollection(c.id, next)}
                    onRename={(name) => {
                      patchCollection(c.id, { ...c, name });
                      setRenaming(false);
                    }}
                    onDelete={() => {
                      if (!confirm(`Delete collection “${c.name}”?`)) return;
                      setDraft({ collections: draft.collections.filter((x) => x.id !== c.id) });
                      setOpenId(null);
                      setEditingVarId(null);
                      setCreating(false);
                      setRenaming(false);
                      setStatus("Unsaved — press Save.");
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CollectionPanel({
  collection,
  busy,
  creating,
  renaming,
  editingVarId,
  onCreating,
  onRenaming,
  onEditingVarId,
  onPatch,
  onRename,
  onDelete,
}: {
  collection: TrackCollection;
  busy: boolean;
  creating: boolean;
  renaming: boolean;
  editingVarId: string | null;
  onCreating: (v: boolean) => void;
  onRenaming: (v: boolean) => void;
  onEditingVarId: (id: string | null) => void;
  onPatch: (next: TrackCollection) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [renameValue, setRenameValue] = useState(collection.name);

  useEffect(() => {
    setRenameValue(collection.name);
  }, [collection.name]);

  return (
    <div className="border-t border-ink/10 bg-paper-2/40 px-4 py-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {renaming ? (
          <div className="mr-auto flex flex-wrap items-center gap-2">
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="border border-ink/20 bg-paper px-2 py-1 font-serif text-base text-ink"
              aria-label="Rename collection"
            />
            <button
              type="button"
              className="border border-ink bg-ink px-2 py-1 text-xs text-paper"
              onClick={() => {
                const next = renameValue.trim();
                if (next) onRename(next);
                else setRenameValue(collection.name);
              }}
            >
              Apply name
            </button>
            <button type="button" className="text-xs text-ink-mute" onClick={() => onRenaming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="text-xs text-ink-mute"
            onClick={() => {
              onRenaming(true);
              onCreating(false);
              onEditingVarId(null);
            }}
          >
            Rename collection
          </button>
        )}
        <button type="button" disabled={busy} className="text-xs text-ink-mute" onClick={onDelete}>
          Delete collection
        </button>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {collection.variables.length === 0 && collection.statics.length === 0 ? (
          <li className="text-sm text-ink-mute">No variables yet.</li>
        ) : null}
        {collection.variables.map((v) => (
          <li key={v.id} className="border border-ink/10 bg-paper px-3 py-2">
            {editingVarId === v.id ? (
              <VariableEditForm
                variable={v}
                busy={busy}
                onCancel={() => onEditingVarId(null)}
                onApply={(nextVar) => {
                  onPatch({
                    ...collection,
                    variables: collection.variables.map((x) => (x.id === v.id ? nextVar : x)),
                  });
                  onEditingVarId(null);
                }}
                onRemove={() => {
                  onPatch({
                    ...collection,
                    variables: collection.variables.filter((x) => x.id !== v.id),
                  });
                  onEditingVarId(null);
                }}
              />
            ) : (
              <VariableRow
                variable={v}
                onEdit={() => {
                  onEditingVarId(v.id);
                  onCreating(false);
                  onRenaming(false);
                }}
              />
            )}
          </li>
        ))}
        {collection.statics.map((s) => (
          <li key={s.id} className="flex items-start justify-between gap-3 border border-ink/10 bg-paper px-3 py-2 text-sm">
            <div>
              <p>
                <span className="rounded-sm bg-ink/10 px-1 text-[10px] tracking-wide uppercase">static</span>{" "}
                <span className="font-medium">{s.name}</span>
                <span className="text-ink-mute"> · {s.value}</span>
              </p>
              {s.description ? <p className="mt-0.5 text-xs text-ink-mute">{s.description}</p> : null}
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-ink-mute"
              onClick={() =>
                onPatch({
                  ...collection,
                  statics: collection.statics.filter((x) => x.id !== s.id),
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {creating ? (
        <CreateItemForm
          busy={busy}
          onCancel={() => onCreating(false)}
          onCreate={(item) => {
            if (item.kind === "variable") {
              onPatch({
                ...collection,
                variables: [
                  ...collection.variables,
                  {
                    id: uid(),
                    name: item.name,
                    unit: item.unit,
                    description: item.description,
                    samples: [],
                  },
                ],
              });
            } else {
              onPatch({
                ...collection,
                statics: [
                  ...collection.statics,
                  {
                    id: uid(),
                    name: item.name,
                    value: item.value,
                    description: item.description,
                  },
                ],
              });
            }
            onCreating(false);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          className="mt-4 border border-ink/40 px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => {
            onCreating(true);
            onEditingVarId(null);
            onRenaming(false);
          }}
        >
          Create new variable
        </button>
      )}
    </div>
  );
}

function CreateItemForm({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (
    item:
      | { kind: "variable"; name: string; unit: string; description: string }
      | { kind: "static"; name: string; value: string; description: string },
  ) => void;
}) {
  const [kind, setKind] = useState<"variable" | "static">("variable");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="mt-4 border border-ink/15 bg-paper p-3">
      <p className="text-xs tracking-[0.12em] text-ink-mute uppercase">New item</p>
      <div className="mt-2 flex gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="item-kind"
            checked={kind === "variable"}
            onChange={() => setKind("variable")}
          />
          Variable
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="item-kind"
            checked={kind === "static"}
            onChange={() => setKind("static")}
          />
          Static
        </label>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-ink/20 bg-paper px-2 py-1 text-sm"
        />
        {kind === "variable" ? (
          <input
            placeholder="unit (kg, score)"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="border border-ink/20 bg-paper px-2 py-1 text-sm"
          />
        ) : (
          <input
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="border border-ink/20 bg-paper px-2 py-1 text-sm"
          />
        )}
        <input
          placeholder="description (for chat matching)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="border border-ink/20 bg-paper px-2 py-1 text-sm sm:col-span-2"
        />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || !name.trim() || (kind === "static" && !value.trim())}
          className="border border-ink bg-ink px-3 py-1 text-xs text-paper disabled:opacity-40"
          onClick={() => {
            if (kind === "variable") {
              onCreate({
                kind: "variable",
                name: name.trim(),
                unit: unit.trim(),
                description: description.trim(),
              });
            } else {
              onCreate({
                kind: "static",
                name: name.trim(),
                value: value.trim(),
                description: description.trim(),
              });
            }
          }}
        >
          Add
        </button>
        <button type="button" className="text-xs text-ink-mute" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function VariableRow({ variable, onEdit }: { variable: TrackVariable; onEdit: () => void }) {
  const last = lastSample(variable);
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div>
        <p>
          <span className="rounded-sm bg-ink/10 px-1 text-[10px] tracking-wide uppercase">variable</span>{" "}
          <span className="font-medium">{variable.name}</span>
          {variable.unit ? <span className="text-ink-mute"> · {variable.unit}</span> : null}
          {last ? (
            <span className="text-ink-mute">
              {" "}
              · {last.value}
              {variable.unit ? ` ${variable.unit}` : ""}
            </span>
          ) : (
            <span className="text-ink-mute"> · no value yet</span>
          )}
        </p>
        {last ? (
          <p className="mt-0.5 text-xs text-ink-mute">
            {formatStamp(last.at)}
            {last.source ? ` · ${last.source}` : ""}
            {last.date !== todayIsoDate() ? ` · for ${last.date}` : ""}
          </p>
        ) : null}
        {variable.description ? (
          <p className="mt-0.5 text-xs text-ink-mute">{variable.description}</p>
        ) : null}
      </div>
      <button type="button" className="shrink-0 text-xs text-accent" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}

function VariableEditForm({
  variable,
  busy,
  onCancel,
  onApply,
  onRemove,
}: {
  variable: TrackVariable;
  busy: boolean;
  onCancel: () => void;
  onApply: (next: TrackVariable) => void;
  onRemove: () => void;
}) {
  const last = lastSample(variable);
  const [name, setName] = useState(variable.name);
  const [unit, setUnit] = useState(variable.unit);
  const [description, setDescription] = useState(variable.description);
  const [value, setValue] = useState(last ? String(last.value) : "");
  const [logDate, setLogDate] = useState(last?.date || todayIsoDate());

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-xs tracking-[0.12em] text-ink-mute uppercase">Edit variable</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-ink-mute">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink-mute">
          Unit
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink-mute sm:col-span-2">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink-mute">
          Value
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 72.4"
            className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink-mute">
          For date
          <input
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
        </label>
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !name.trim()}
          className="border border-ink bg-ink px-3 py-1 text-xs text-paper disabled:opacity-40"
          onClick={() => {
            const trimmed = value.trim();
            let next: TrackVariable = {
              ...variable,
              name: name.trim(),
              unit: unit.trim(),
              description: description.trim(),
            };
            if (trimmed !== "") {
              const num = Number(trimmed);
              if (!Number.isFinite(num)) return;
              const tempFile = {
                collections: [{ id: "tmp", name: "tmp", statics: [], variables: [next] }],
              };
              const applied = applyTrackUpdates(
                tempFile,
                [
                  {
                    kind: "variable",
                    id: variable.id,
                    value: num,
                    logDate: logDate || todayIsoDate(),
                    note: "edited in Collections",
                    source: "ui",
                  },
                ],
                new Date().toISOString(),
                todayIsoDate(),
              );
              next = applied.file.collections[0].variables[0];
            }
            onApply(next);
          }}
        >
          Apply
        </button>
        <button type="button" className="border border-ink/30 px-3 py-1 text-xs" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="ml-auto text-xs text-ink-mute"
          onClick={() => {
            if (confirm(`Remove variable “${variable.name}”?`)) onRemove();
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
