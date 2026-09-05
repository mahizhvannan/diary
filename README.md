# Diary

Personal diary: each **chat session** (your messages and the clerk’s replies) is one stored entry. Ask about the past and it searches **daily summaries**, then loads those days. Files live in a `DiaryApp` folder on your Google Drive. Calendar view is not in this first pass.

The UI is paper and ink (warm off-white, olive accent). It does not use a violet AI-studio theme.

## What you need

1. A [Gemini API key](https://aistudio.google.com/apikey) on your Google account (Flash / Flash-Lite free tier — this is the developer API, not gemini.google.com chat).
2. A Google Cloud project with **Google Drive API** enabled and an **OAuth 2.0 Client ID** (application type: Web application).

### OAuth client

- Authorized JavaScript origins: `http://localhost:3000`
- Authorized redirect URIs: `http://localhost:3000`
- Scope used by the app: `drive.file` (only files this app creates)

Copy [`.env.example`](.env.example) to `.env.local`:

```
GEMINI_API_KEY=your_key
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
```

If the OAuth screen is in Testing mode, add your Google account as a test user.

## Run

```
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect Drive, then write an entry.

## Storage

`My Drive / DiaryApp /`

- `manifest.json` — dates, daily summaries (the retrieval index)
- `day-YYYY-MM-DD.json` — sessions for that day, each with the full message list

If Gemini hits a daily quota, the app still writes your text into the session.

## First-pass behavior

- **Log:** a non-question is cleaned and appended to the current session.
- **Retrieve:** a question searches summaries, loads 3–5 matching days, then answers with citations.
- **Delete:** removes that entire session from Drive.
- **New:** starts another session (another entry).

## Hosting

Localhost is enough ($0). Do not put this on a public URL without extra access control — the Gemini key lives on the server and the quota is yours.
