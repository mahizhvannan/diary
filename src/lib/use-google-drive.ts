"use client";

import { useCallback, useEffect, useState } from "react";
import {
  googleDriveSignIn,
  googleDriveSignOut,
  restoreDriveToken,
} from "./firebase";

export function useGoogleDriveToken() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const restored = await restoreDriveToken();
        if (!cancelled && restored) setToken(restored);
      } catch {
        /* show connect */
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const grantedBefore = localStorage.getItem("diary.driveGranted") === "1";
      const access = await googleDriveSignIn(!grantedBefore);
      setToken(access);
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await googleDriveSignOut();
    setToken(null);
  }, []);

  return { token, ready: !busy && !hydrating, hydrating, error, connect, disconnect };
}
