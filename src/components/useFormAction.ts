import { useState } from "react";
import { storageError } from "../data/db";
export function useFormAction() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const execute = async (fn: () => Promise<void> | void) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(storageError(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, execute, setError };
}
