import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  reauthenticateWithPopup,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";
import firebaseConfig from "./firebase-applet-config.json";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const STORE_KEY = "diary.driveToken";
const OAUTH_CLIENT_ID =
  "896798852345-s0nnos28spu1jaiud4mb59bkq8bmvbql.apps.googleusercontent.com";

const app = getApps()[0] ?? initializeApp(firebaseConfig);
export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence);

type StoredToken = { accessToken: string; expiresAt: number };

export function readStoredDriveToken(): StoredToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.accessToken || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredDriveToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORE_KEY);
}

export function clearDriveAuth(): void {
  clearStoredDriveToken();
  if (typeof window === "undefined") return;
  localStorage.removeItem("diary.driveGranted");
}

export async function persistDriveToken(accessToken: string): Promise<void> {
  const expiresAt = await expiryFromToken(accessToken);
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({ accessToken, expiresAt } satisfies StoredToken),
  );
  localStorage.setItem("diary.driveGranted", "1");
}

async function expiryFromToken(accessToken: string): Promise<number> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    const info = (await res.json()) as { exp?: string; expires_in?: string };
    if (info.exp) return Number(info.exp) * 1000;
    if (info.expires_in) return Date.now() + Number(info.expires_in) * 1000;
  } catch {
    /* fall through */
  }
  return Date.now() + 50 * 60 * 1000;
}

export async function tokenHasDrive(accessToken: string): Promise<boolean> {
  const res = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) return false;
  const info = (await res.json()) as { scope?: string };
  const scopes = (info.scope ?? "").split(/\s+/);
  return scopes.some(
    (s) =>
      s === DRIVE_SCOPE ||
      s === "https://www.googleapis.com/auth/drive" ||
      s.endsWith("/auth/drive.file") ||
      s.endsWith("/auth/drive"),
  );
}

function driveProvider(forceConsent: boolean) {
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);
  if (forceConsent) {
    provider.setCustomParameters({ prompt: "consent" });
  }
  return provider;
}

async function accessTokenFromPopup(forceConsent: boolean) {
  const provider = driveProvider(forceConsent);
  const result = auth.currentUser
    ? await reauthenticateWithPopup(auth.currentUser, provider)
    : await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error("Google did not return a Drive access token. Try Connect again.");
  }
  return credential.accessToken;
}

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("GSI failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("GSI failed"));
    document.head.appendChild(script);
  });
}

/** No popup if the user already granted Drive to this Google client. */
export async function trySilentDriveToken(): Promise<string | null> {
  try {
    await loadGsi();
    const g = window.google;
    if (!g?.accounts?.oauth2) return null;
    return await new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 4000);
      const client = g.accounts.oauth2.initTokenClient({
        client_id: OAUTH_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (r: { access_token?: string; error?: string }) => {
          window.clearTimeout(timer);
          resolve(r.access_token && !r.error ? r.access_token : null);
        },
      });
      client.requestAccessToken({ prompt: "" });
    });
  } catch {
    return null;
  }
}

export async function restoreDriveToken(): Promise<string | null> {
  const stored = readStoredDriveToken();
  if (stored && Date.now() < stored.expiresAt - 30_000) {
    if (await tokenHasDrive(stored.accessToken)) return stored.accessToken;
    clearStoredDriveToken();
  }
  await auth.authStateReady();
  if (!auth.currentUser && !localStorage.getItem("diary.driveGranted")) {
    return null;
  }
  const silent = await trySilentDriveToken();
  if (silent && (await tokenHasDrive(silent))) {
    await persistDriveToken(silent);
    return silent;
  }
  return null;
}

export async function googleDriveSignIn(forceConsent = false): Promise<string> {
  const accessToken = await accessTokenFromPopup(forceConsent);
  if (!(await tokenHasDrive(accessToken))) {
    const again = await accessTokenFromPopup(true);
    if (!(await tokenHasDrive(again))) {
      throw new Error(
        "Google signed you in but did not grant Drive. Allow Drive on the permission screen.",
      );
    }
    await persistDriveToken(again);
    return again;
  }
  await persistDriveToken(accessToken);
  return accessToken;
}

export async function googleDriveSignOut(): Promise<void> {
  clearDriveAuth();
  await signOut(auth);
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (r: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  }
}
