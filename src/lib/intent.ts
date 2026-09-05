const QUESTION =
  /^(when|what|where|who|why|how|did i|do i|have i|was i|were we|do you remember|can you (find|recall|remember)|recall|remember)\b/i;

const PAST =
  /\b(last (week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|yesterday|the other day|a few days ago|remember when|that day I)\b/i;

export function isRetrievalQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  if (QUESTION.test(t)) return true;
  if (PAST.test(t)) return true;
  return false;
}
