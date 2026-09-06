/** Client-side AI provider prefs. User keys never go to Drive. */

export type AiProviderId = "gemini";

export type AiSettings = {
  provider: AiProviderId;
  /** Optional BYOK; empty means use server GEMINI_API_KEY */
  geminiApiKey: string;
  model: string;
  /** Soft daily Gemini request budget */
  dailyRequestBudget: number;
};

export type AiUsageDay = {
  date: string;
  /** @deprecated prefer geminiRequests */
  requests?: number;
  geminiRequests: number;
};

const SETTINGS_KEY = "diary.aiSettings";
const USAGE_KEY = "diary.aiUsage";

export const CHEAP_GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (cheap)" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite (cheap)" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
] as const;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "gemini",
  geminiApiKey: "",
  model: "gemini-3.5-flash-lite",
  dailyRequestBudget: 100,
};

export function loadAiSettings(): AiSettings {
  if (typeof window === "undefined") return DEFAULT_AI_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      ...DEFAULT_AI_SETTINGS,
      ...parsed,
      geminiApiKey: typeof parsed.geminiApiKey === "string" ? parsed.geminiApiKey : "",
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      provider: settings.provider,
      geminiApiKey: settings.geminiApiKey,
      model: settings.model,
      dailyRequestBudget: settings.dailyRequestBudget,
    }),
  );
}

export function loadAiUsage(): AiUsageDay {
  const today = new Date().toLocaleDateString("en-CA");
  if (typeof window === "undefined") return { date: today, geminiRequests: 0 };
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return { date: today, geminiRequests: 0 };
    const parsed = JSON.parse(raw) as AiUsageDay & { cursorRequests?: number };
    if (parsed.date !== today) return { date: today, geminiRequests: 0 };
    const gemini =
      Number(parsed.geminiRequests) ||
      (parsed.geminiRequests == null && parsed.requests != null ? Number(parsed.requests) : 0) ||
      0;
    return { date: today, geminiRequests: gemini };
  } catch {
    return { date: today, geminiRequests: 0 };
  }
}

export function recordAiRequest(_kind: "gemini" | "cursor" = "gemini"): AiUsageDay {
  const usage = loadAiUsage();
  const next: AiUsageDay = {
    date: usage.date,
    geminiRequests: usage.geminiRequests + 1,
  };
  localStorage.setItem(USAGE_KEY, JSON.stringify(next));
  return next;
}
