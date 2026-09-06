"use client";

import type { ArtifactFile } from "../lib/types";
import { formatStamp } from "../lib/dates";
import { MarkdownBody } from "./MarkdownBody";

function htmlSrcDoc(artifact: ArtifactFile): string {
  if (artifact.kind === "svg" || artifact.mimeType.includes("svg")) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{max-width:100%;height:auto;display:block;margin:12px auto}</style></head><body>${artifact.content}</body></html>`;
  }
  return artifact.content;
}

export function ArtifactRenderer({ artifact }: { artifact: ArtifactFile }) {
  if (artifact.kind === "html" || artifact.kind === "svg" || artifact.mimeType.includes("html")) {
    return (
      <iframe
        title={artifact.title}
        srcDoc={htmlSrcDoc(artifact)}
        sandbox="allow-scripts"
        className="h-[min(70vh,520px)] w-full border border-ink/15 bg-white"
      />
    );
  }

  if (artifact.kind === "md" || artifact.mimeType.includes("markdown")) {
    return <MarkdownBody text={artifact.content} />;
  }

  if (artifact.kind === "png" || artifact.encoding === "base64") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:${artifact.mimeType};base64,${artifact.content}`}
        alt={artifact.title}
        className="max-h-[70vh] max-w-full border border-ink/15"
      />
    );
  }

  if (artifact.kind === "json") {
    let pretty = artifact.content;
    try {
      pretty = JSON.stringify(JSON.parse(artifact.content), null, 2);
    } catch {
      /* keep raw */
    }
    return (
      <pre className="overflow-x-auto border border-ink/15 bg-paper-2 p-3 font-mono text-sm leading-6">
        {pretty}
      </pre>
    );
  }

  return (
    <pre className="whitespace-pre-wrap border border-ink/15 bg-paper-2 p-3 font-serif text-sm leading-6">
      {artifact.content}
    </pre>
  );
}

export function ArtifactViewerPanel({
  artifact,
  onClose,
  onDelete,
  deleting,
}: {
  artifact: ArtifactFile;
  onClose: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-ink/15 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{artifact.title}</p>
          <p className="mt-1 text-xs text-ink-mute">
            {artifact.kind} · {formatStamp(artifact.createdAt)}
            {artifact.sourcePath ? ` · ${artifact.sourcePath}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {onDelete ? (
            <button
              type="button"
              disabled={deleting}
              className="text-xs text-ink-mute disabled:opacity-40"
              onClick={onDelete}
            >
              {deleting ? "…" : "Delete"}
            </button>
          ) : null}
          <button type="button" className="text-sm text-ink-mute" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ArtifactRenderer artifact={artifact} />
      </div>
    </div>
  );
}
