import type { DayFile, GeminiAnswerResult, GeminiLogResult, GeminiNutritionResult } from "@/lib/types";

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
    };

export type GeminiOk =
  | { ok: true; mode: "chat"; data: { reply: string } }
  | { ok: true; mode: "nutrition"; data: GeminiNutritionResult }
  | { ok: true; mode: "log"; data: GeminiLogResult }
  | { ok: true; mode: "answer"; data: GeminiAnswerResult }
  | { ok: true; mode: "range_summary"; data: { reply: string } }
  | { ok: true; mode: "period_ask"; data: { reply: string } }
  | { ok: true; mode: "pick_dates"; dates: string[] };

export type GeminiErr = { ok: false; quota: boolean; message: string };

export async function callGemini(body: GeminiRequest): Promise<GeminiOk | GeminiErr> {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  return json as GeminiOk;
}

export function emptyDay(date: string, timezone: string): DayFile {
  return { date, timezone, summary: "", entries: [] };
}
