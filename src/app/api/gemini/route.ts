import { NextRequest, NextResponse } from "next/server";
import { resolveServerOrHeaderKey } from "../../../lib/server-ai-auth";

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];

function allowedModel(requested: string | null): string[] {
  if (requested && MODELS.includes(requested)) return [requested, ...MODELS.filter((m) => m !== requested)];
  return MODELS;
}

type ChatImage = { mimeType: string; data: string };

type Body =
  | {
      mode: "chat";
      messages: { role: string; text: string }[];
      packedDays: string;
      images?: ChatImage[];
    }
  | {
      mode: "nutrition";
      note: string;
      today: string;
      images?: ChatImage[];
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
    };

function parseModelJson(raw: string): unknown {
  const t = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(t);
}

const GEMINI_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "aistudio-build",
};

function extractText(data: unknown): string {
  const d = data as {
    output_text?: string;
    steps?: { type?: string; content?: { text?: string; type?: string }[] }[];
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    outputs?: {
      type?: string;
      text?: string;
      content?: string | { text?: string; type?: string }[];
    }[];
    error?: { message?: string };
  };
  if (d.error?.message) throw new Error(d.error.message);
  if (typeof d.output_text === "string" && d.output_text) return d.output_text;
  if (Array.isArray(d.steps)) {
    const parts: string[] = [];
    for (const step of d.steps) {
      if (!Array.isArray(step.content)) continue;
      for (const block of step.content) {
        if (typeof block.text === "string") parts.push(block.text);
      }
    }
    if (parts.length) return parts.join("");
  }
  if (d.outputs?.length) {
    return d.outputs
      .map((o) => {
        if (typeof o.text === "string") return o.text;
        if (typeof o.content === "string") return o.content;
        if (Array.isArray(o.content)) {
          return o.content.map((c) => c.text ?? "").join("");
        }
        return "";
      })
      .join("");
  }
  return d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
  },
  required: ["reply"],
};

const NUTRITION_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    logDate: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string" },
          name: { type: "string" },
          calories: { type: "integer" },
          protein: { type: "integer" },
          carbs: { type: "integer" },
          fat: { type: "integer" },
          minutes: { type: "integer" },
        },
        required: ["kind", "name", "calories", "protein", "carbs", "fat"],
      },
    },
  },
  required: ["reply", "items"],
};

const LOG_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    reply: { type: "string" },
    sessionSummary: { type: "string" },
    daySummary: { type: "string" },
  },
  required: ["title", "tags", "reply", "sessionSummary", "daySummary"],
};

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    usedDates: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "usedDates"],
};

const RANGE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
  },
  required: ["reply"],
};

const PICK_SCHEMA = {
  type: "object",
  properties: {
    dates: { type: "array", items: { type: "string" } },
  },
  required: ["dates"],
};

const TRACK_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    updates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string" },
          id: { type: "string" },
          value: { type: "string" },
          logDate: { type: "string" },
          note: { type: "string" },
        },
        required: ["kind", "id", "value"],
      },
    },
  },
  required: ["reply", "updates"],
};

const EXPORT_CHART_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    series: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          id: { type: "string" },
        },
        required: ["type", "id"],
      },
    },
  },
  required: ["reply", "start", "end", "series"],
};

const SKILL_COMPILE_SCHEMA = {
  type: "object",
  properties: {
    hint: { type: "string" },
    instructions: { type: "string" },
    uses: {
      type: "object",
      properties: {
        nutrition: { type: "boolean" },
        collections: { type: "boolean" },
        diary: { type: "boolean" },
        range: { type: "string" },
      },
      required: ["nutrition", "collections", "diary", "range"],
    },
  },
  required: ["hint", "instructions", "uses"],
};

const SKILL_RUN_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
  },
  required: ["reply"],
};

async function generate(
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
  images: { mimeType: string; data: string }[] = [],
  modelPrefer: string[] = MODELS,
): Promise<string> {
  let last = "";
  const input =
    images.length === 0
      ? prompt
      : [
          { type: "text", text: prompt },
          ...images.map((img) => ({
            type: "image",
            mime_type: img.mimeType,
            data: img.data,
          })),
        ];
  for (const model of modelPrefer) {
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...GEMINI_HEADERS,
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        input,
        store: false,
        response_format: schema,
      }),
    });
    const data = await res.json();
    if (res.status === 429) {
      return JSON.stringify({ __quota: true, message: extractText(data) || "quota" });
    }
    if (!res.ok) {
      last = extractText(data) || `HTTP ${res.status}`;
      continue;
    }
    const text = extractText(data);
    if (text) return text;
    last = "Empty Interactions response";
  }
  throw new Error(last || "All Gemini models failed");
}

function chatPrompt(body: Extract<Body, { mode: "chat" }>): string {
  const history = body.messages
    .map((m) => `${m.role === "user" ? "User" : "Clerk"}: ${m.text}`)
    .join("\n");
  return `You are a diary companion in a chat. Answer the user. Be useful and direct.

Rules:
- Do NOT say you logged, recorded, filed, or saved anything. Logging is a separate button the user clicks.
- If they ask a general question (products, APIs, facts), answer it from knowledge.
- If diary excerpts are provided, use them for questions about their past. Cite dates as YYYY-MM-DD when you use them.
- If photos are attached, describe or use what you see.
- A greeting gets a short human reply, not a filing confirmation.

Diary excerpts (may be empty):
${body.packedDays || "(none)"}

Conversation:
${history}

JSON: { "reply": "your answer" }`;
}

function nutritionPrompt(body: Extract<Body, { mode: "nutrition" }>): string {
  return `Estimate nutrition or activity from the user's note and any attached photos. Food calories are positive. Workouts/walks/exercise calories burned are NEGATIVE and include minutes. If a meal photo is attached, identify the foods and estimate portions.

Note:
${body.note}

Today's date (ISO): ${body.today}

If the note refers to yesterday or another day, set logDate to that ISO date (YYYY-MM-DD). Otherwise logDate is today. Diary chat can stay today; only the calorie file uses logDate.

JSON:
{
  "reply": "short plain answer with the breakdown in prose",
  "logDate": "${body.today}",
  "items": [
    {
      "kind": "food or activity",
      "name": "bowl of rice",
      "calories": 200,
      "protein": 4,
      "carbs": 45,
      "fat": 0,
      "minutes": 0
    }
  ]
}`;
}

function logPrompt(body: Extract<Body, { mode: "log" }>): string {
  const history = body.session.messages
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n");
  return `You are filing this chat as one diary entry. Summarize the whole conversation for later retrieval. Do not continue the chat; write the archive fields.

Today's date: ${body.day.date}
Existing day summary: ${body.day.summary || "(none)"}
Other sessions today: ${body.day.otherSessionTitles.join("; ") || "(none)"}

Full chat to file:
${history || "(empty)"}

JSON:
{
  "title": "short session title",
  "tags": ["lowercase", "tags"],
  "reply": "2-4 sentences confirming what was filed in the diary, naming the main facts.",
  "sessionSummary": "one paragraph covering the whole session for later retrieval",
  "daySummary": "one paragraph covering this calendar day after filing this session"
}`;
}

function answerPrompt(body: Extract<Body, { mode: "answer" }>): string {
  return `You answer questions about the user's diary. Use only the sessions below. Cite dates as YYYY-MM-DD. If the diary does not contain it, say so.

Question:
${body.question}

Diary excerpts:
${body.packedDays || "(none)"}

JSON only:
{
  "reply": "answer in plain prose",
  "usedDates": ["YYYY-MM-DD"]
}`;
}

function rangePrompt(body: Extract<Body, { mode: "range_summary" }>): string {
  return `Summarize this diary + calorie range in plain prose (one to three short paragraphs). Mention total eaten, burned, net vs goal if present, protein/carbs/fat when listed, and notable diary themes. Do not invent days that are missing.

Range: ${body.start} to ${body.end}

Data:
${body.packed || "(none)"}

JSON: { "reply": "summary" }`;
}

function periodAskPrompt(body: Extract<Body, { mode: "period_ask" }>): string {
  return `Answer the user's ${body.skill} question using only the diary, nutrition, and tracked-variable data for this range. Calorie logs include per-item and per-day calories plus protein, carbs, and fat, and a Range totals line. Tracked lines list collection variables (weight, sleep, etc.) with units. Prefer those numbers for food or tracker questions even if diary text is empty. Be concrete with grams, kcal, and variable units. Sum from the provided data; do not invent missing days or values.

Range: ${body.start} to ${body.end}
Question: ${body.question}

Data:
${body.packed || "(none)"}

JSON: { "reply": "answer" }`;
}

function pickPrompt(body: Extract<Body, { mode: "pick_dates" }>): string {
  return `Pick up to 5 diary dates whose summaries might answer the question. JSON only: {"dates":["YYYY-MM-DD"]}

Question: ${body.question}

Index:
${body.index.map((d) => `${d.date}: ${d.summary}`).join("\n")}`;
}

function trackUpdatePrompt(body: Extract<Body, { mode: "track_update" }>): string {
  return `The user wants to record values for existing collection variables (and optionally statics). Match using name and description. You may update several variables in one request. Do not create new variables or collections. Ignore diary chat that is not a measurement.

Today (ISO): ${body.today}

Catalog:
${body.catalog}

User note:
${body.note}

For each match, kind is "variable" or "static", id is the catalog id, value is the number (variables) or text (statics). logDate is YYYY-MM-DD; use today unless the note names another day. If nothing matches, updates is [].

JSON:
{
  "reply": "short confirmation of what you matched",
  "updates": [
    { "kind": "variable", "id": "uuid", "value": "72.4", "logDate": "${body.today}", "note": "optional" }
  ]
}`;
}

function exportChartPrompt(body: Extract<Body, { mode: "export_chart" }>): string {
  return `Parse a chart request. Pick a date range and one or more series from the catalog. Do not invent series ids.

Today (ISO): ${body.today}
Default range if unspecified: the last 7 days including today.
start and end must be YYYY-MM-DD, start <= end, at most 93 days.

User prompt:
${body.prompt}

Catalog:
${body.catalog}

series[].type is "builtin" or "variable". series[].id is the catalog id (builtin id like carbs, or a variable uuid).

JSON:
{
  "reply": "one sentence naming the series and range",
  "start": "YYYY-MM-DD",
  "end": "YYYY-MM-DD",
  "series": [{ "type": "builtin", "id": "carbs" }]
}`;
}

function skillCompilePrompt(body: Extract<Body, { mode: "skill_compile" }>): string {
  return `You design a reusable diary chat skill. The user will later invoke it with ${body.tag} plus optional free text.

Trigger: ${body.tag}
Reserved triggers (do not invent overlapping behavior for these): ${body.reservedTags.join(", ")}

User intent (natural language):
${body.intent}

Available trackables / variables / nutrition builtins:
${body.catalog}

Write a clear skill definition the runtime can follow later.
- hint: one short autocomplete line
- instructions: detailed steps for the model when the skill runs (what data to use, how to answer, what not to invent)
- uses.nutrition / collections / diary: which data sources to load
- uses.range: none | day | week | month (how much history to pack)

JSON only:
{
  "hint": "short hint",
  "instructions": "multi-sentence procedure",
  "uses": { "nutrition": true, "collections": true, "diary": false, "range": "week" }
}`;
}

function skillRunPrompt(body: Extract<Body, { mode: "skill_run" }>): string {
  return `Execute this diary skill. Follow the skill instructions. Use only the packed data. Be concrete with numbers and units. Do not invent missing values. Today is ${body.today}.

Skill: ${body.tag}
Hint: ${body.hint}

Instructions:
${body.instructions}

User note after the trigger:
${body.note || "(none)"}

Data:
${body.packed || "(none)"}

JSON: { "reply": "answer for the user" }`;
}

export async function POST(req: NextRequest) {
  const headerKey = req.headers.get("x-diary-gemini-key")?.trim();
  const envKey = process.env.GEMINI_API_KEY?.trim();
  const resolved = resolveServerOrHeaderKey(headerKey, envKey);
  const apiKey = resolved.key;
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        quota: false,
        message: envKey
          ? "Server GEMINI_API_KEY requires DIARY_ALLOW_SERVER_KEYS=1, or add a device key in Settings."
          : "GEMINI_API_KEY is missing in .env.local (or provide a key in Settings)",
      },
      { status: envKey ? 401 : 500 },
    );
  }
  const models = allowedModel(req.headers.get("x-diary-model"));

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, quota: false, message: "Invalid JSON" },
      { status: 400 },
    );
  }

  try {
    if (body.mode === "chat") {
      const raw = await generate(apiKey, chatPrompt(body), CHAT_SCHEMA, body.images ?? [], models);
      const parsed = parseModelJson(raw) as { __quota?: boolean; reply?: string; message?: string };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      return NextResponse.json({
        ok: true,
        mode: "chat",
        data: { reply: parsed.reply || raw },
      });
    }

    if (body.mode === "nutrition") {
      const raw = await generate(apiKey, nutritionPrompt(body), NUTRITION_SCHEMA, body.images ?? [], models);
      const parsed = parseModelJson(raw) as {
        __quota?: boolean;
        reply?: string;
        logDate?: string;
        items?: {
          kind?: string;
          name?: string;
          calories?: number;
          protein?: number;
          carbs?: number;
          fat?: number;
          minutes?: number;
        }[];
        message?: string;
      };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      const items = (parsed.items ?? []).map((i) => {
        const kind = i.kind === "activity" || (i.calories ?? 0) < 0 ? "activity" : "food";
        return {
          kind,
          name: i.name || "item",
          calories: Number(i.calories) || 0,
          protein: Number(i.protein) || 0,
          carbs: Number(i.carbs) || 0,
          fat: Number(i.fat) || 0,
          minutes: i.minutes ? Number(i.minutes) : kind === "activity" ? 0 : null,
        };
      });
      return NextResponse.json({
        ok: true,
        mode: "nutrition",
        data: {
          reply: parsed.reply || "Logged nutrition.",
          logDate: parsed.logDate,
          items,
        },
      });
    }

    if (body.mode === "log") {
      const raw = await generate(apiKey, logPrompt(body), LOG_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as { __quota?: boolean; title?: string; tags?: string[]; reply?: string; sessionSummary?: string; daySummary?: string; message?: string };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      return NextResponse.json({
        ok: true,
        mode: "log",
        data: {
          title: parsed.title || "Untitled",
          tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
          reply: parsed.reply || "Logged.",
          sessionSummary: parsed.sessionSummary || parsed.reply || "",
          daySummary: parsed.daySummary || parsed.sessionSummary || "",
        },
      });
    }

    if (body.mode === "answer") {
      const raw = await generate(apiKey, answerPrompt(body), ANSWER_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as { __quota?: boolean; reply?: string; usedDates?: string[]; message?: string };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      return NextResponse.json({
        ok: true,
        mode: "answer",
        data: {
          reply: parsed.reply || raw,
          usedDates: Array.isArray(parsed.usedDates) ? parsed.usedDates.map(String) : [],
        },
      });
    }

    if (body.mode === "pick_dates") {
      const raw = await generate(apiKey, pickPrompt(body), PICK_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as { __quota?: boolean; dates?: string[]; message?: string };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      const dates = Array.isArray(parsed.dates) ? parsed.dates.map(String) : [];
      return NextResponse.json({ ok: true, mode: "pick_dates", dates });
    }

    if (body.mode === "range_summary") {
      const raw = await generate(apiKey, rangePrompt(body), RANGE_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as { __quota?: boolean; reply?: string; message?: string };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      return NextResponse.json({
        ok: true,
        mode: "range_summary",
        data: { reply: parsed.reply || raw },
      });
    }

    if (body.mode === "period_ask") {
      const raw = await generate(apiKey, periodAskPrompt(body), RANGE_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as { __quota?: boolean; reply?: string; message?: string };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      return NextResponse.json({
        ok: true,
        mode: "period_ask",
        data: { reply: parsed.reply || raw },
      });
    }

    if (body.mode === "track_update") {
      const raw = await generate(apiKey, trackUpdatePrompt(body), TRACK_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as {
        __quota?: boolean;
        reply?: string;
        message?: string;
        updates?: { kind?: string; id?: string; value?: string | number; logDate?: string; note?: string }[];
      };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      const updates = (parsed.updates ?? [])
        .filter((u) => u.id && (u.kind === "variable" || u.kind === "static"))
        .map((u) => ({
          kind: u.kind as "variable" | "static",
          id: String(u.id),
          value: u.value ?? "",
          logDate: u.logDate,
          note: u.note,
        }));
      return NextResponse.json({
        ok: true,
        mode: "track_update",
        data: { reply: parsed.reply || "Updated.", updates },
      });
    }

    if (body.mode === "export_chart") {
      const raw = await generate(apiKey, exportChartPrompt(body), EXPORT_CHART_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as {
        __quota?: boolean;
        reply?: string;
        message?: string;
        start?: string;
        end?: string;
        series?: { type?: string; id?: string }[];
      };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      const series = (parsed.series ?? [])
        .filter((s) => s.id && (s.type === "builtin" || s.type === "variable"))
        .map((s) => ({ type: s.type as "builtin" | "variable", id: String(s.id) }));
      return NextResponse.json({
        ok: true,
        mode: "export_chart",
        data: {
          reply: parsed.reply || "Chart ready.",
          start: parsed.start || "",
          end: parsed.end || "",
          series,
        },
      });
    }

    if (body.mode === "skill_compile") {
      const raw = await generate(apiKey, skillCompilePrompt(body), SKILL_COMPILE_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as {
        __quota?: boolean;
        message?: string;
        hint?: string;
        instructions?: string;
        uses?: {
          nutrition?: boolean;
          collections?: boolean;
          diary?: boolean;
          range?: string;
        };
      };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      const rangeRaw = String(parsed.uses?.range || "week").toLowerCase();
      const range =
        rangeRaw === "none" || rangeRaw === "day" || rangeRaw === "month" || rangeRaw === "week"
          ? rangeRaw
          : "week";
      return NextResponse.json({
        ok: true,
        mode: "skill_compile",
        data: {
          hint: (parsed.hint || body.intent).slice(0, 120),
          instructions: parsed.instructions || body.intent,
          uses: {
            nutrition: Boolean(parsed.uses?.nutrition),
            collections: Boolean(parsed.uses?.collections),
            diary: Boolean(parsed.uses?.diary),
            range,
          },
        },
      });
    }

    if (body.mode === "skill_run") {
      const raw = await generate(apiKey, skillRunPrompt(body), SKILL_RUN_SCHEMA, [], models);
      const parsed = parseModelJson(raw) as { __quota?: boolean; reply?: string; message?: string };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      return NextResponse.json({
        ok: true,
        mode: "skill_run",
        data: { reply: parsed.reply || raw },
      });
    }

    return NextResponse.json({ ok: false, quota: false, message: "Unknown mode" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gemini failed";
    const quota = /429|resource exhausted|quota/i.test(message);
    return NextResponse.json({ ok: false, quota, message }, { status: quota ? 429 : 500 });
  }
}
