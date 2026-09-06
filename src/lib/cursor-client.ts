import { activeCursorApiKey, loadAiSettings, recordCursorUsage } from "./ai-settings";
import type { DiarySnapshot } from "./analyze-types";

export type OutArtifactMeta = {
  relativePath: string;
  name: string;
  size: number;
  updatedAt: string;
};

export type CursorTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
};

export type CursorChatDone = {
  agentId: string;
  status: string;
  result: string;
  artifacts: OutArtifactMeta[];
  usage: CursorTokenUsage | null;
};

function cursorHeaders(workspaceId: string, driveToken: string): Record<string, string> {
  if (!workspaceId.trim()) {
    throw new Error("Missing Drive workspace id. Reconnect Google Drive.");
  }
  if (!driveToken.trim()) {
    throw new Error("Missing Google Drive token. Reconnect Google Drive.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Diary-Workspace-Id": workspaceId.trim(),
    "X-Diary-Drive-Token": driveToken.trim(),
  };
  const key = activeCursorApiKey();
  if (key) headers["X-Diary-Cursor-Key"] = key;
  return headers;
}

export async function syncAnalyzeWorkspace(
  workspaceId: string,
  driveToken: string,
  snapshot: DiarySnapshot,
): Promise<void> {
  const res = await fetch("/api/cursor", {
    method: "POST",
    headers: cursorHeaders(workspaceId, driveToken),
    body: JSON.stringify({ action: "sync", snapshot }),
  });
  const json = (await res.json()) as { ok?: boolean; message?: string };
  if (!res.ok || !json.ok) throw new Error(json.message || `Sync failed (${res.status})`);
}

export async function listAnalyzeOut(
  workspaceId: string,
  driveToken: string,
): Promise<OutArtifactMeta[]> {
  const res = await fetch("/api/cursor", {
    method: "POST",
    headers: cursorHeaders(workspaceId, driveToken),
    body: JSON.stringify({ action: "list_out" }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    artifacts?: OutArtifactMeta[];
    message?: string;
  };
  if (!res.ok || !json.ok) throw new Error(json.message || "List failed");
  return json.artifacts ?? [];
}

export async function readAnalyzeOut(
  workspaceId: string,
  driveToken: string,
  relativePath: string,
): Promise<{
  relativePath: string;
  content: string;
  mimeType: string;
}> {
  const res = await fetch("/api/cursor", {
    method: "POST",
    headers: cursorHeaders(workspaceId, driveToken),
    body: JSON.stringify({ action: "read_out", relativePath }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    file?: { relativePath: string; content: string; mimeType: string };
    message?: string;
  };
  if (!res.ok || !json.ok || !json.file) throw new Error(json.message || "Read failed");
  return json.file;
}

export async function clearAnalyzeOut(workspaceId: string, driveToken: string): Promise<void> {
  const res = await fetch("/api/cursor", {
    method: "POST",
    headers: cursorHeaders(workspaceId, driveToken),
    body: JSON.stringify({ action: "clear_out" }),
  });
  const json = (await res.json()) as { ok?: boolean; message?: string };
  if (!res.ok || !json.ok) throw new Error(json.message || "Clear failed");
}

export async function streamCursorChat(opts: {
  workspaceId: string;
  driveToken: string;
  message: string;
  agentId?: string | null;
  onText?: (chunk: string) => void;
  onAgent?: (agentId: string) => void;
}): Promise<CursorChatDone> {
  const settings = loadAiSettings();
  const res = await fetch("/api/cursor", {
    method: "POST",
    headers: cursorHeaders(opts.workspaceId, opts.driveToken),
    body: JSON.stringify({
      action: "chat",
      message: opts.message,
      agentId: opts.agentId || null,
      model: settings.cursorModel,
    }),
  });

  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(json.message || `Cursor chat failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: CursorChatDone | null = null;
  let errorMessage: string | null = null;

  while (true) {
    const { value, done: eof } = await reader.read();
    if (eof) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.type === "text" && typeof event.text === "string") {
        opts.onText?.(event.text);
      } else if (event.type === "agent" && typeof event.agentId === "string") {
        opts.onAgent?.(event.agentId);
      } else if (event.type === "done") {
        const usageRaw = event.usage as CursorTokenUsage | null | undefined;
        done = {
          agentId: String(event.agentId || opts.agentId || ""),
          status: String(event.status || ""),
          result: String(event.result || ""),
          artifacts: (event.artifacts as OutArtifactMeta[]) || [],
          usage: usageRaw
            ? {
                inputTokens: Number(usageRaw.inputTokens) || 0,
                outputTokens: Number(usageRaw.outputTokens) || 0,
                totalTokens: usageRaw.totalTokens,
              }
            : null,
        };
      } else if (event.type === "error") {
        errorMessage = String(event.message || "Cursor error");
      }
    }
  }

  if (errorMessage) throw new Error(errorMessage);
  if (!done) throw new Error("Cursor stream ended without a result");
  recordCursorUsage({
    inputTokens: done.usage?.inputTokens,
    outputTokens: done.usage?.outputTokens,
  });
  return done;
}
