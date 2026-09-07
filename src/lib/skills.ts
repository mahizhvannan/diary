import type { CustomSkill, CustomSkillsFile } from "./types";
import type { Skill } from "./types";

export type { Skill };

export const BUILTIN_SKILLS: Skill[] = [
  { id: "calories", tag: "@calories", hint: "Log food or activity with a nutrition estimate" },
  { id: "weekly", tag: "@weekly", hint: "Ask about this week’s diary, calories, and macros" },
  { id: "monthly", tag: "@monthly", hint: "Ask about this month’s diary, calories, and macros" },
  { id: "track", tag: "@track", hint: "Update collection variables (weight, sleep, …)" },
];

/** @deprecated use BUILTIN_SKILLS — kept for older imports */
export const SKILLS = BUILTIN_SKILLS;

export function normalizeSkillTag(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_]/g, "");
  return t ? `@${t}` : "";
}

export function reservedSkillTags(custom: CustomSkill[] = []): Set<string> {
  return new Set([
    ...BUILTIN_SKILLS.map((s) => s.tag.toLowerCase()),
    ...custom.map((s) => s.tag.toLowerCase()),
  ]);
}

export function skillTagConflict(
  tag: string,
  custom: CustomSkill[],
  exceptId?: string,
): string | null {
  const normalized = normalizeSkillTag(tag);
  if (!normalized || normalized.length < 2) return "Trigger must be like @myskill";
  if (normalized.length > 32) return "Trigger is too long";
  for (const s of BUILTIN_SKILLS) {
    if (s.tag.toLowerCase() === normalized) return `${normalized} is a built-in skill`;
  }
  for (const s of custom) {
    if (exceptId && s.id === exceptId) continue;
    if (s.tag.toLowerCase() === normalized) return `${normalized} is already used`;
  }
  return null;
}

export function allSkillsForMention(custom: CustomSkill[]): Skill[] {
  return [
    ...BUILTIN_SKILLS,
    ...custom.map((s) => ({ id: s.id, tag: s.tag, hint: s.hint, custom: true as const })),
  ];
}

export function mentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? " ")) return null;
  const query = before.slice(at);
  if (/\s/.test(query.slice(1))) return null;
  return { start: at, query: query.toLowerCase() };
}

export function matchingSkills(query: string, custom: CustomSkill[] = []): Skill[] {
  const q = query.replace(/^@/, "");
  return allSkillsForMention(custom).filter(
    (s) => s.tag.slice(1).startsWith(q) || s.tag.startsWith(query),
  );
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

export function extractTrackNote(text: string): string | null {
  const match = text.match(/@track\b([\s\S]*)/i);
  if (!match) return null;
  const note = match[1].replace(/^[:\s,-]+/, "").trim();
  return note || text.replace(/@track\b/gi, "").trim() || null;
}

export function extractCustomSkill(
  text: string,
  custom: CustomSkill[],
): { skill: CustomSkill; note: string } | null {
  if (custom.length === 0) return null;
  // Longest tag first so @foo_bar beats @foo
  const sorted = [...custom].sort((a, b) => b.tag.length - a.tag.length);
  for (const skill of sorted) {
    const name = skill.tag.replace(/^@/, "");
    const re = new RegExp(`@${name}\\b([\\s\\S]*)`, "i");
    const match = text.match(re);
    if (!match) continue;
    const note = match[1].replace(/^[:\s,-]+/, "").trim();
    return { skill, note: note || text.replace(re, "").trim() || "" };
  }
  return null;
}

export function emptyCustomSkills(): CustomSkillsFile {
  return { skills: [] };
}
