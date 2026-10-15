import { useState, useEffect, useCallback } from "react";
import { getStatus } from "./client";
import { type APIStatus } from "./contracts";
export const connectionChanged = () =>
  window.dispatchEvent(new Event("ravintopolku-ai-changed"));
export function useAIStatus() {
  const [status, setStatus] = useState<APIStatus | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setStatus(null);
      setError(
        "AI-palvelu tarvitsee verkkoyhteyden. Päiväkirja toimii offline-tilassa.",
      );
      return;
    }
    try {
      setStatus(await getStatus());
      setError("");
    } catch {
      setStatus(null);
      setError(
        "AI-palvelu ei ole tavoitettavissa. Voit jatkaa kirjaamista käsin.",
      );
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const listener = () => void refresh();
    for (const name of ["ravintopolku-ai-changed", "online", "offline"])
      window.addEventListener(name, listener);
    return () => {
      clearTimeout(timer);
      for (const name of ["ravintopolku-ai-changed", "online", "offline"])
        window.removeEventListener(name, listener);
    };
  }, [refresh]);
  return { status, error, refresh };
}
