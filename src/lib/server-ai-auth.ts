/** Server-only helpers for AI route auth. Never trust Host / X-Forwarded-For for key access. */

/** Explicit opt-in: allow falling back to GEMINI_API_KEY / CURSOR_API_KEY from env. */
export function allowServerEnvKeys(): boolean {
  return process.env.DIARY_ALLOW_SERVER_KEYS === "1";
}

export function resolveServerOrHeaderKey(
  headerKey: string | null | undefined,
  envKey: string | null | undefined,
): { key: string | null; usedEnv: boolean } {
  const header = headerKey?.trim() || null;
  if (header) return { key: header, usedEnv: false };
  const env = envKey?.trim() || null;
  if (env && allowServerEnvKeys()) return { key: env, usedEnv: true };
  return { key: null, usedEnv: false };
}

export function sanitizeWorkspaceScope(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return s.length >= 8 ? s : null;
}

/**
 * Prove the caller owns/can access the Drive folder used as Analyze workspace scope.
 * Prevents cross-tenant access when only a folder id is known.
 */
export async function verifyDriveWorkspaceAccess(
  driveAccessToken: string,
  folderId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const scope = sanitizeWorkspaceScope(folderId);
  if (!scope) {
    return { ok: false, status: 400, message: "Invalid workspace id" };
  }
  const token = driveAccessToken.trim();
  if (!token) {
    return { ok: false, status: 401, message: "Missing Google Drive access token" };
  }

  const params = new URLSearchParams({
    fields: "id,name,mimeType,trashed",
    supportsAllDrives: "true",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${scope}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: 403,
      message: "Drive token cannot access this workspace folder.",
    };
  }
  if (res.status === 404) {
    return { ok: false, status: 403, message: "Workspace folder not found for this Drive account." };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: 502,
      message: `Drive verification failed (${res.status}): ${text.slice(0, 200)}`,
    };
  }

  const file = (await res.json()) as {
    id?: string;
    mimeType?: string;
    trashed?: boolean;
  };
  if (file.trashed) {
    return { ok: false, status: 403, message: "Workspace folder is trashed." };
  }
  if (file.mimeType !== "application/vnd.google-apps.folder") {
    return { ok: false, status: 403, message: "Workspace id is not a Drive folder." };
  }
  if (file.id !== scope) {
    return { ok: false, status: 403, message: "Workspace id mismatch." };
  }
  return { ok: true };
}
