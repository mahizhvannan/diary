import { NextRequest, NextResponse } from "next/server";

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

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

async function generate(
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
  images: { mimeType: string; data: string }[] = [],
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
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: GEMINI_HEADERS,
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
  return `Summarize this diary + calorie range in plain prose (one to three short paragraphs). Mention total eaten, burned, net vs goal if present, and notable diary themes. Do not invent days that are missing.

Range: ${body.start} to ${body.end}

Data:
${body.packed || "(none)"}

JSON: { "reply": "summary" }`;
}

function periodAskPrompt(body: Extract<Body, { mode: "period_ask" }>): string {
  return `Answer the user's ${body.skill} question using only the diary and nutrition data for this range. Be concrete with numbers when the question is about calories. Do not invent missing days.

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

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, quota: false, message: "GEMINI_API_KEY is missing in .env.local" },
      { status: 500 },
    );
  }

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
      const raw = await generate(apiKey, chatPrompt(body), CHAT_SCHEMA, body.images ?? []);
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
      const raw = await generate(apiKey, nutritionPrompt(body), NUTRITION_SCHEMA, body.images ?? []);
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
      const raw = await generate(apiKey, logPrompt(body), LOG_SCHEMA);
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
      const raw = await generate(apiKey, answerPrompt(body), ANSWER_SCHEMA);
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
      const raw = await generate(apiKey, pickPrompt(body), PICK_SCHEMA);
      const parsed = parseModelJson(raw) as { __quota?: boolean; dates?: string[]; message?: string };
      if (parsed.__quota) {
        return NextResponse.json({ ok: false, quota: true, message: parsed.message || "quota" }, { status: 429 });
      }
      const dates = Array.isArray(parsed.dates) ? parsed.dates.map(String) : [];
      return NextResponse.json({ ok: true, mode: "pick_dates", dates });
    }

    if (body.mode === "range_summary") {
      const raw = await generate(apiKey, rangePrompt(body), RANGE_SCHEMA);
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
      const raw = await generate(apiKey, periodAskPrompt(body), RANGE_SCHEMA);
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

    return NextResponse.json({ ok: false, quota: false, message: "Unknown mode" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gemini failed";
    const quota = /429|resource exhausted|quota/i.test(message);
    return NextResponse.json({ ok: false, quota, message }, { status: quota ? 429 : 500 });
  }
}
