import { useState, useRef, useEffect } from "react";
import { Field } from "./common";
import { AIConnection } from "./AIConnection";
import { useAIStatus } from "../ai/useAIStatus";
import { HttpProvider } from "../ai/client";
import { type AIDraft, type AITask } from "../ai/provider";
export function AIPanel({
  photo,
  onDraft,
}: {
  photo: Blob | null;
  onDraft: (draft: AIDraft) => void;
}) {
  const { status, error, refresh } = useAIStatus();
  const [task, setTask] = useState<AITask>("portion"),
    [text, setText] = useState(""),
    [sendImage, setSendImage] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  const controller = useRef<AbortController | null>(null);
  const currentOnDraft = useRef(onDraft);
  useEffect(() => {
    currentOnDraft.current = onDraft;
  }, [onDraft]);
  useEffect(() => () => controller.current?.abort(), []);
  const provider = status?.providers[0];
  return (
    <details>
      <summary>Pyydä AI-luonnos</summary>
      <AIConnection status={status} error={error} onRefresh={refresh} />
      {status?.authenticated && provider && (
        <>
          <Field label="AI-tehtävä">
            <select
              value={task}
              onChange={(e) => setTask(e.target.value as AITask)}
              disabled={busy}
            >
              <option value="portion">Annoksen tulkinta</option>
              <option value="package">
                Pakkauksen ravintoarvojen tulkinta
              </option>
              <option value="suggestion">Ateriaehdotus</option>
            </select>
          </Field>
          <Field label="Kuvaus tekoälylle">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={12000}
              disabled={busy}
              placeholder="Kerro ruuat, tunnetut määrät ja valmistustila. Älä lisää tarpeettomia henkilötietoja."
            />
          </Field>
          {photo && provider.capabilities.imageInput && (
            <label className="check">
              <input
                type="checkbox"
                checked={sendImage}
                onChange={(e) => setSendImage(e.target.checked)}
                disabled={busy}
              />{" "}
              Lähetä myös tämän aterian valittu kuva
            </label>
          )}
          <p className="small muted">
            Vain tähän kenttään kirjoittamasi kuvaus
            {sendImage ? " ja valittu kuva" : ""} lähetetään palveluun{" "}
            {provider.destination}. Profiilia, muita aterioita tai painoja ei
            lähetetä. API-kutsu voi aiheuttaa kustannuksia. Tarkka annosmassa ei
            selviä pelkästä kuvasta.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={busy}
            />{" "}
            Hyväksyn tämän syötteen lähettämisen AI-palveluun
          </label>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              disabled={
                busy || !consent || (!text.trim() && !(sendImage && photo))
              }
              onClick={() => {
                setBusy(true);
                setProblem("");
                const abort = new AbortController();
                controller.current = abort;
                void new HttpProvider(provider.capabilities, abort.signal)
                  .interpret(task, {
                    text,
                    image: sendImage && photo ? photo : undefined,
                  })
                  .then((d) => {
                    if (!abort.signal.aborted) currentOnDraft.current(d);
                  })
                  .catch((e) =>
                    setProblem(
                      e instanceof Error ? e.message : "AI-pyyntö epäonnistui.",
                    ),
                  )
                  .finally(() => {
                    setBusy(false);
                    controller.current = null;
                  });
              }}
            >
              {busy
                ? "Valmistellaan luonnosta…"
                : "Pyydä tarkistettava luonnos"}
            </button>
            {busy && (
              <button
                type="button"
                className="quiet"
                onClick={() => controller.current?.abort()}
              >
                Keskeytä pyyntö
              </button>
            )}
          </div>
          {problem && (
            <p className="error" role="alert">
              {problem}
            </p>
          )}
        </>
      )}
    </details>
  );
}
