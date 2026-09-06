/** Static schema text shipped into the AnalyzeBeta agent workspace. */

export const ANALYZE_SCHEMA_MD = `# Diary data schema (AnalyzeBeta)

You are a local analysis agent for a personal diary app.
- Read only \`SCHEMA.md\` and \`data/\`.
- Write charts, reports, and other artifacts only under \`out/\`.
- Prefer self-contained \`.html\` or \`.svg\` for graphs; \`.md\` for write-ups; \`.json\` for structured extracts.
- Do not access Google Drive, cloud APIs, or credentials. There are none in this workspace.
- Do not invent missing numbers. Say when data is absent.
- Name files clearly, e.g. \`out/carbs-vs-weight-2026-09.html\`.

## Layout

\`\`\`
data/
  collections.json       # trackable collections, variables, statics, samples
  custom-skills.json     # user-defined @skills
  period-qa.json         # cached @weekly/@monthly answers
  days/day-YYYY-MM-DD.json
  calories/cal-YYYY-MM-DD.json
  month-summaries/month-YYYY-MM.json
\`\`\`

## DayFile (\`days/day-YYYY-MM-DD.json\`)

\`\`\`
{ date, timezone, summary, entries: DiaryEntry[] }
DiaryEntry: { id, title, summary, tags[], messages: ChatMessage[], createdAt, updatedAt, filedAt? }
ChatMessage: { id, role: "user"|"assistant", text, at, attachments?, period? }
\`\`\`

## CalorieDay (\`calories/cal-YYYY-MM-DD.json\`)

\`\`\`
{ date, goalKcal, items: CalorieItem[] }
CalorieItem: {
  id, kind: "food"|"activity", name, calories,
  protein?, carbs?, fat?, minutes?, at, raw?
}
\`\`\`
Macros are grams. Activity uses \`minutes\` and \`calories\` burned.

## CollectionsFile (\`collections.json\`)

\`\`\`
{ collections: TrackCollection[] }
TrackCollection: { id, name, variables: TrackVariable[], statics: TrackStatic[] }
TrackVariable: { id, name, unit, description, samples: TrackSample[] }
TrackSample: { date, value: number|string, at, note?, source? }
TrackStatic: { id, name, value, description }
\`\`\`

## Built-in nutrition series (for charts)

- calorie_goal, eaten, burned, calorie_deficit (goal − net), protein, carbs, fat
- net = eaten − burned

## MonthSummaryFile

\`\`\`
{ month: "YYYY-MM", summary, generatedAt }
\`\`\`

## Custom skills

\`\`\`
{ skills: [{ id, tag, hint, intent, instructions, uses, createdAt, updatedAt }] }
\`\`\`
`;

export const ANALYZE_AGENTS_MD = `# AnalyzeBeta agent

Follow SCHEMA.md. Analyze the diary snapshot in data/. Put every deliverable in out/.
When asked for a graph, write a self-contained HTML or SVG file under out/ that renders without external deps.
Keep answers concrete with dates and units from the data.
`;
