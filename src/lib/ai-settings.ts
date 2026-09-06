/** Client-side AI provider prefs. User keys never go to Drive. */

export type AiProviderId = "gemini";

export type CursorApiKeyEntry = {
  id: string;
  label: string;
  key: string;
  createdAt: string;
};

export type AiSettings = {
  provider: AiProviderId;
  /** Optional BYOK; empty means use server GEMINI_API_KEY */
  geminiApiKey: string;
  model: string;
  /** Soft daily Gemini chat request budget */
  dailyRequestBudget: number;
  /** Soft daily Cursor token budget (input + output) */
  dailyCursorTokenBudget: number;
  /** Rotatable Cursor CLI / SDK keys (device only) */
  cursorApiKeys: CursorApiKeyEntry[];
  activeCursorKeyId: string | null;
  cursorModel: string;
};

export type AiUsageDay = {
  date: string;
  /** @deprecated prefer geminiRequests; kept for older localStorage */
  requests?: number;
  geminiRequests: number;
  cursorRequests: number;
  cursorInputTokens: number;
  cursorOutputTokens: number;
};

const SETTINGS_KEY = "diary.aiSettings";
const USAGE_KEY = "diary.aiUsage";

export const CHEAP_GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (cheap)" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite (cheap)" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
] as const;

export const CURSOR_MODELS = [
  { id: "composer-2.5", label: "Composer 2.5" },
  { id: "auto", label: "Auto" },
] as const;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "gemini",
  geminiApiKey: "",
  model: "gemini-3.5-flash-lite",
  dailyRequestBudget: 100,
  dailyCursorTokenBudget: 500_000,
  cursorApiKeys: [],
  activeCursorKeyId: null,
  cursorModel: "composer-2.5",
};

export function loadAiSettings(): AiSettings {
  if (typeof window === "undefined") return DEFAULT_AI_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const keys = Array.isArray(parsed.cursorApiKeys)
      ? parsed.cursorApiKeys.filter(
          (k): k is CursorApiKeyEntry =>
            Boolean(k && typeof k.id === "string" && typeof k.key === "string"),
        )
      : [];
    return {
      ...DEFAULT_AI_SETTINGS,
      ...parsed,
      geminiApiKey: typeof parsed.geminiApiKey === "string" ? parsed.geminiApiKey : "",
      dailyCursorTokenBudget:
        typeof parsed.dailyCursorTokenBudget === "number" && parsed.dailyCursorTokenBudget > 0
          ? parsed.dailyCursorTokenBudget
          : DEFAULT_AI_SETTINGS.dailyCursorTokenBudget,
      cursorApiKeys: keys,
      activeCursorKeyId:
        typeof parsed.activeCursorKeyId === "string" ? parsed.activeCursorKeyId : null,
      cursorModel: typeof parsed.cursorModel === "string" ? parsed.cursorModel : "composer-2.5",
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...settings,
      geminiApiKey: settings.geminiApiKey,
      cursorApiKeys: settings.cursorApiKeys,
    }),
  );
}

export function activeCursorApiKey(settings = loadAiSettings()): string {
  if (!settings.activeCursorKeyId) return "";
  return settings.cursorApiKeys.find((k) => k.id === settings.activeCursorKeyId)?.key?.trim() || "";
}

function emptyUsage(date: string): AiUsageDay {
  return {
    date,
    geminiRequests: 0,
    cursorRequests: 0,
    cursorInputTokens: 0,
    cursorOutputTokens: 0,
  };
}

export function loadAiUsage(): AiUsageDay {
  const today = new Date().toLocaleDateString("en-CA");
  if (typeof window === "undefined") return emptyUsage(today);
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return emptyUsage(today);
    const parsed = JSON.parse(raw) as AiUsageDay;
    if (parsed.date !== today) return emptyUsage(today);
    const gemini =
      Number(parsed.geminiRequests) ||
      (parsed.geminiRequests == null && parsed.requests != null ? Number(parsed.requests) : 0) ||
      0;
    return {
      date: today,
      geminiRequests: gemini,
      cursorRequests: Number(parsed.cursorRequests) || 0,
      cursorInputTokens: Number(parsed.cursorInputTokens) || 0,
      cursorOutputTokens: Number(parsed.cursorOutputTokens) || 0,
    };
  } catch {
    return emptyUsage(today);
  }
}

/** @deprecated Use gemini + cursor rows separately */
export function usageTotal(usage: AiUsageDay): number {
  return (usage.geminiRequests || 0) + (usage.cursorRequests || 0);
}

export function cursorTokensUsed(usage: AiUsageDay): number {
  return (usage.cursorInputTokens || 0) + (usage.cursorOutputTokens || 0);
}

export function recordAiRequest(kind: "gemini" | "cursor" = "gemini"): AiUsageDay {
  const usage = loadAiUsage();
  const next: AiUsageDay = {
    ...usage,
    geminiRequests: usage.geminiRequests + (kind === "gemini" ? 1 : 0),
    cursorRequests: usage.cursorRequests + (kind === "cursor" ? 1 : 0),
  };
  localStorage.setItem(USAGE_KEY, JSON.stringify(next));
  return next;
}

export function recordCursorUsage(tokens: {
  inputTokens?: number;
  outputTokens?: number;
}): AiUsageDay {
  const usage = loadAiUsage();
  const next: AiUsageDay = {
    ...usage,
    cursorRequests: usage.cursorRequests + 1,
    cursorInputTokens: usage.cursorInputTokens + Math.max(0, Math.round(tokens.inputTokens || 0)),
    cursorOutputTokens:
      usage.cursorOutputTokens + Math.max(0, Math.round(tokens.outputTokens || 0)),
  };
  localStorage.setItem(USAGE_KEY, JSON.stringify(next));
  return next;
}
