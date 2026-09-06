import type { DayFile, GeminiAnswerResult, GeminiLogResult, GeminiNutritionResult } from "@/lib/types";
import { loadAiSettings, recordAiRequest } from "@/lib/ai-settings";

export type GeminiRequest =
  | {
      mode: "chat";
      messages: { role: string; text: string }[];
      packedDays: string;
      images?: { mimeType: string; data: string }[];
    }
  | {
      mode: "nutrition";
      note: string;
      today: string;
      images?: { mimeType: string; data: string }[];
    }
  | {
      mode: "log";
      userText: string;
      session: { title: string; summary: string; messages: { role: string; text: string }[] };
      day: { date: string; summary: string; otherSessionTitles: string[] };
    }
  | {
      mode: "answer";
      question: string;
      packedDays: string;
    }
  | {
      mode: "range_summary";
      start: string;
      end: string;
      packed: string;
    }
  | {
      mode: "period_ask";
      skill: "weekly" | "monthly";
      question: string;
      start: string;
      end: string;
      packed: string;
    }
  | {
      mode: "pick_dates";
      question: string;
      index: { date: string; summary: string }[];
    }
  | {
      mode: "track_update";
      note: string;
      today: string;
      catalog: string;
    }
  | {
      mode: "export_chart";
      prompt: string;
      today: string;
      catalog: string;
    }
  | {
      mode: "skill_compile";
      tag: string;
      intent: string;
      catalog: string;
      reservedTags: string[];
    }
  | {
      mode: "skill_run";
      tag: string;
      hint: string;
      instructions: string;
      note: string;
      today: string;
      packed: string;
    }
  | {
      mode: "analyze";
      question: string;
      today: string;
      catalog: string;
      packed: string;
      history?: { role: string; text: string }[];
    };

export type GeminiOk =
  | { ok: true; mode: "chat"; data: { reply: string } }
  | { ok: true; mode: "nutrition"; data: GeminiNutritionResult }
  | { ok: true; mode: "log"; data: GeminiLogResult }
  | { ok: true; mode: "answer"; data: GeminiAnswerResult }
  | { ok: true; mode: "range_summary"; data: { reply: string } }
  | { ok: true; mode: "period_ask"; data: { reply: string } }
  | { ok: true; mode: "pick_dates"; dates: string[] }
  | {
      ok: true;
      mode: "track_update";
      data: {
        reply: string;
        updates: { kind: "variable" | "static"; id: string; value: string | number; logDate?: string; note?: string }[];
      };
    }
  | {
      ok: true;
      mode: "export_chart";
      data: {
        reply: string;
        start: string;
        end: string;
        series: { type: "builtin" | "variable"; id: string }[];
      };
    }
  | {
      ok: true;
      mode: "skill_compile";
      data: {
        hint: string;
        instructions: string;
        uses: {
          nutrition: boolean;
          collections: boolean;
          diary: boolean;
          range: "none" | "day" | "week" | "month";
        };
      };
    }
  | { ok: true; mode: "skill_run"; data: { reply: string } }
  | {
      ok: true;
      mode: "analyze";
      data: {
        reply: string;
        artifact: { title: string; kind: "html" | "svg" | "md"; content: string } | null;
        chart: {
          start: string;
          end: string;
          series: { type: "builtin" | "variable"; id: string }[];
        } | null;
      };
    };

export type GeminiErr = { ok: false; quota: boolean; message: string };

export async function callGemini(body: GeminiRequest): Promise<GeminiOk | GeminiErr> {
  const settings = loadAiSettings();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.model) headers["X-Diary-Model"] = settings.model;
  if (settings.geminiApiKey.trim()) {
    headers["X-Diary-Gemini-Key"] = settings.geminiApiKey.trim();
  }

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as GeminiOk | GeminiErr | { error: string; quota?: boolean };
  if (!res.ok || (json as GeminiErr).ok === false) {
    const err = json as GeminiErr & { error?: string };
    return {
      ok: false,
      quota: Boolean(err.quota) || res.status === 429,
      message: err.message || err.error || `Gemini ${res.status}`,
    };
  }
  recordAiRequest("gemini");
  return json as GeminiOk;
}

export function emptyDay(date: string, timezone: string): DayFile {
  return { date, timezone, summary: "", entries: [] };
}
