import MiniSearch from "minisearch";
import type { DayFile, Manifest } from "./types";

export type SummaryHit = {
  date: string;
  score: number;
  summary: string;
};

export function searchSummaryDates(
  manifest: Manifest,
  query: string,
  limit = 5,
): SummaryHit[] {
  if (manifest.days.length === 0) return [];

  const mini = new MiniSearch({
    fields: ["date", "summary", "tags"],
    storeFields: ["date", "summary"],
    searchOptions: { prefix: true, fuzzy: 0.15 },
  });

  mini.addAll(
    manifest.days.map((d) => ({
      id: d.date,
      date: d.date,
      summary: d.summary,
      tags: d.tags.join(" "),
    })),
  );

  const dateHint = query.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (dateHint && manifest.days.some((d) => d.date === dateHint)) {
    const day = manifest.days.find((d) => d.date === dateHint)!;
    return [{ date: day.date, score: 999, summary: day.summary }];
  }

  const results = mini.search(query);
  if (results.length > 0) {
    return results.slice(0, limit).map((r) => ({
      date: String(r.id),
      score: r.score,
      summary: String(r.summary ?? ""),
    }));
  }

  return [];
}

export function packDaysForLlm(days: DayFile[]): string {
  return days
    .map((day) => {
      const sessions = day.entries
        .map((e) => {
          const turns = e.messages
            .map((m) => `${m.role === "user" ? "You" : "Diary"} (${m.at}): ${m.text}`)
            .join("\n");
          return `### Session ${e.id} — ${e.title}\n${turns}`;
        })
        .join("\n\n");
      return `## ${day.date}\nDay summary: ${day.summary}\n\n${sessions}`;
    })
    .join("\n\n");
}
