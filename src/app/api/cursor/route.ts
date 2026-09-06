import { Agent, CursorAgentError } from "@cursor/sdk";
import { NextRequest, NextResponse } from "next/server";
import {
  clearOutArtifacts,
  listOutArtifacts,
  readOutArtifact,
  writeDiarySnapshot,
  type DiarySnapshot,
  analyzeWorkspaceRoot,
} from "../../../lib/analyze-workspace";
import { resolveServerOrHeaderKey, sanitizeWorkspaceScope, verifyDriveWorkspaceAccess } from "../../../lib/server-ai-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body =
  | { action: "sync"; snapshot: DiarySnapshot }
  | { action: "chat"; message: string; agentId?: string | null; model?: string }
  | { action: "list_out" }
  | { action: "read_out"; relativePath: string }
  | { action: "clear_out" };

/**
 * Authorize Analyze API:
 * 1) Client Cursor key header, or
 * 2) DIARY_ANALYZE_SECRET header matching env, or
 * 3) Server CURSOR_API_KEY only when DIARY_ALLOW_SERVER_KEYS=1 (never via Host spoofing).
 */
function authorizeAnalyze(req: NextRequest): { ok: true; cursorKey: string | null } | { ok: false } {
  const headerKey = req.headers.get("x-diary-cursor-key")?.trim();
  if (headerKey) return { ok: true, cursorKey: headerKey };

  const secretHeader = req.headers.get("x-diary-analyze-secret")?.trim();
  const secretEnv = process.env.DIARY_ANALYZE_SECRET?.trim();
  if (secretHeader && secretEnv && secretHeader === secretEnv) {
    const resolved = resolveServerOrHeaderKey(null, process.env.CURSOR_API_KEY);
    return { ok: true, cursorKey: resolved.key };
  }

  const resolved = resolveServerOrHeaderKey(null, process.env.CURSOR_API_KEY);
  if (resolved.key) return { ok: true, cursorKey: resolved.key };

  return { ok: false };
}

function workspaceScope(req: NextRequest): string | null {
  return sanitizeWorkspaceScope(req.headers.get("x-diary-workspace-id"));
}

function extractAssistantText(event: {
  type: string;
  message?: { content?: { type: string; text?: string }[] };
}): string {
  if (event.type !== "assistant" || !event.message?.content) return "";
  return event.message.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("");
}

function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      message:
        "Unauthorized. Add a Cursor key in Settings, set DIARY_ANALYZE_SECRET, or set DIARY_ALLOW_SERVER_KEYS=1 with CURSOR_API_KEY.",
    },
    { status: 401 },
  );
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 });
  }

  const auth = authorizeAnalyze(req);
  if (!auth.ok) return unauthorized();

  const scopeId = workspaceScope(req);
  if (!scopeId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Missing X-Diary-Workspace-Id (Drive folder id). Reconnect Drive and retry.",
      },
      { status: 400 },
    );
  }

  const driveToken = req.headers.get("x-diary-drive-token")?.trim() || "";
  const ownership = await verifyDriveWorkspaceAccess(driveToken, scopeId);
  if (!ownership.ok) {
    return NextResponse.json(
      { ok: false, message: ownership.message },
      { status: ownership.status },
    );
  }

  try {
    if (body.action === "sync") {
      const { root } = await writeDiarySnapshot(scopeId, body.snapshot);
      return NextResponse.json({ ok: true, root });
    }

    if (body.action === "list_out") {
      const artifacts = await listOutArtifacts(scopeId);
      return NextResponse.json({ ok: true, artifacts });
    }

    if (body.action === "read_out") {
      const file = await readOutArtifact(scopeId, body.relativePath);
      if (!file) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
      return NextResponse.json({ ok: true, file });
    }

    if (body.action === "clear_out") {
      await clearOutArtifacts(scopeId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "chat") {
      const apiKey = auth.cursorKey;
      if (!apiKey) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "No Cursor API key. Add one in Settings → AI provider → Cursor CLI agent, or set CURSOR_API_KEY with DIARY_ALLOW_SERVER_KEYS=1.",
          },
          { status: 401 },
        );
      }
      const message = body.message?.trim();
      if (!message) {
        return NextResponse.json({ ok: false, message: "Empty message" }, { status: 400 });
      }

      const modelId = body.model?.trim() || "composer-2.5";
      const cwd = analyzeWorkspaceRoot(scopeId);
      const prompt = [
        "You are AnalyzeBeta for this diary workspace.",
        "Read SCHEMA.md and data/. Write deliverables only under out/.",
        "Prefer self-contained HTML or SVG charts. For prose answers use GitHub-flavored Markdown with pipe tables.",
        "Be concrete with numbers and dates.",
        "",
        "User request:",
        message,
      ].join("\n");

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (payload: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          };
          let agent: Awaited<ReturnType<typeof Agent.create>> | null = null;
          try {
            if (body.agentId) {
              agent = await Agent.resume(body.agentId, {
                apiKey,
                model: { id: modelId },
                local: { cwd, settingSources: [] },
              });
            } else {
              agent = await Agent.create({
                apiKey,
                model: { id: modelId },
                local: { cwd, settingSources: [] },
              });
            }
            send({ type: "agent", agentId: agent.agentId });

            const run = await agent.send(prompt);
            send({ type: "run", runId: run.id });

            for await (const event of run.stream()) {
              const text = extractAssistantText(event as Parameters<typeof extractAssistantText>[0]);
              if (text) send({ type: "text", text });
              if ((event as { type: string }).type === "status") {
                send({ type: "status", status: (event as { status?: string }).status });
              }
            }

            const result = await run.wait();
            const artifacts = await listOutArtifacts(scopeId);
            const usage = result.usage ?? run.usage;
            send({
              type: "done",
              agentId: agent.agentId,
              status: result.status,
              result: result.result ?? "",
              artifacts,
              usage: usage
                ? {
                    inputTokens: usage.inputTokens ?? 0,
                    outputTokens: usage.outputTokens ?? 0,
                    totalTokens: usage.totalTokens,
                  }
                : null,
            });
          } catch (err) {
            if (err instanceof CursorAgentError) {
              send({
                type: "error",
                message: err.message,
                retryable: err.isRetryable,
              });
            } else {
              send({
                type: "error",
                message: err instanceof Error ? err.message : "Cursor agent failed",
              });
            }
          } finally {
            try {
              if (agent) await agent[Symbol.asyncDispose]();
            } catch {
              /* ignore dispose errors */
            }
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    return NextResponse.json({ ok: false, message: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cursor route failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
