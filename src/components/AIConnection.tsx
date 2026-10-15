import { useState } from "react";
import { Field } from "./common";
import { login, logout } from "../ai/client";
import { connectionChanged } from "../ai/useAIStatus";
import { type APIStatus } from "../ai/contracts";
export function AIConnection({
  status,
  error,
  onRefresh,
}: {
  status: APIStatus | null;
  error: string;
  onRefresh: () => Promise<void>;
}) {
  const [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="ai-connection">
      {!status ? (
        <>
          <p className="muted small">{error || "Tarkistetaan AI-palvelua…"}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => void onRefresh()}
          >
            Tarkista yhteys
          </button>
        </>
      ) : status.authenticated ? (
        <>
          <p className="notice">
            {status.providers.length
              ? `AI-palvelu: ${status.providers[0].name} · ${status.providers[0].model}`
              : "Palveluun kirjauduttu. OpenAI-avain ja malli pitää vielä määrittää palvelimen asetuksiin."}
          </p>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void logout()
                .then(() => {
                  connectionChanged();
                  setMessage("AI-palvelusta kirjauduttu ulos.");
                })
                .catch((e) =>
                  setMessage(
                    e instanceof Error
                      ? e.message
                      : "Uloskirjautuminen epäonnistui.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            Kirjaudu AI-palvelusta ulos
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            Kirjaudu omaan AI-palveluusi. Paikallinen päiväkirja ei tarvitse
            kirjautumista. OpenAI-avain säilyy palvelimella.
          </p>
          <Field label="AI-palvelun salasana">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={200}
            />
          </Field>
          <button
            type="button"
            className="secondary"
            disabled={busy || !password}
            onClick={() => {
              setBusy(true);
              setMessage("");
              void login(password)
                .then(() => {
                  setPassword("");
                  connectionChanged();
                })
                .catch((e) => {
                  setPassword("");
                  setMessage(
                    e instanceof Error
                      ? e.message
                      : "Kirjautuminen epäonnistui.",
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Kirjaudutaan…" : "Kirjaudu AI-palveluun"}
          </button>
        </>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
