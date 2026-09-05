export type Skill = {
  id: string;
  tag: string;
  hint: string;
};

export const SKILLS: Skill[] = [
  { id: "calories", tag: "@calories", hint: "Log food or activity with a nutrition estimate" },
  { id: "weekly", tag: "@weekly", hint: "Ask about this week’s diary and calories" },
  { id: "monthly", tag: "@monthly", hint: "Ask about this month’s diary and calories" },
];

export function mentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? " ")) return null;
  const query = before.slice(at);
  if (/\s/.test(query.slice(1))) return null;
  return { start: at, query: query.toLowerCase() };
}

export function matchingSkills(query: string): Skill[] {
  const q = query.replace(/^@/, "");
  return SKILLS.filter((s) => s.tag.slice(1).startsWith(q) || s.tag.startsWith(query));
}

export function extractCaloriesNote(text: string): string | null {
  const match = text.match(/@calories\b([\s\S]*)/i);
  if (!match) return null;
  const note = match[1].replace(/^[:\s,-]+/, "").trim();
  return note || text.replace(/@calories\b/gi, "").trim() || null;
}

export function extractPeriodAsk(
  text: string,
): { skill: "weekly" | "monthly"; question: string } | null {
  const weekly = text.match(/@weekly\b([\s\S]*)/i);
  const monthly = text.match(/@monthly\b([\s\S]*)/i);
  if (weekly && monthly) {
    const wAt = text.search(/@weekly\b/i);
    const mAt = text.search(/@monthly\b/i);
    if (mAt < wAt) {
      return { skill: "monthly", question: monthly[1].replace(/^[:\s,-]+/, "").trim() || text };
    }
  }
  if (weekly) {
    return { skill: "weekly", question: weekly[1].replace(/^[:\s,-]+/, "").trim() || text };
  }
  if (monthly) {
    return { skill: "monthly", question: monthly[1].replace(/^[:\s,-]+/, "").trim() || text };
  }
  return null;
}
