import { useState, useEffect, useCallback } from "react";
import { type Dataset } from "../domain/model";
import { type InboxItem, type APIStatus } from "../ai/contracts";
import { getInbox, dismissDraft } from "../ai/client";
import { connectionChanged } from "../ai/useAIStatus";
export function IntegrationInbox({
  status,
  data,
  onOpen,
}: {
  status: APIStatus | null;
  data: Dataset;
  onOpen: (item: InboxItem) => void;
}) {
  const [items, setItems] = useState<InboxItem[]>([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!status?.authenticated || !navigator.onLine) return;
    try {
      setItems(await getInbox());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Luonnosten haku epäonnistui.");
    }
  }, [status?.authenticated]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const listener = () => void refresh();
    window.addEventListener("ravintopolku-ai-changed", listener);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("ravintopolku-ai-changed", listener);
    };
  }, [refresh]);
  if (!status?.authenticated || !status.integrationEnabled) return null;
  return (
    <>
      <h3>ILMARIn luonnoslaatikko</h3>
      <p className="small muted">
        Luonnokset säilyvät palvelulla enintään seitsemän päivää. Ne päätyvät
        päiväkirjaan vasta sinun tarkistuksesi ja tallennuksesi jälkeen.
      </p>
      {!items.length && <p className="muted small">Ei odottavia luonnoksia.</p>}
      {items.map((item) => {
        const saved = data.meals.some((m) =>
          m.assumptions.includes("ILMARI-luonnos: " + item.id),
        );
        return (
          <div className="card" key={item.id}>
            <strong>{item.envelope.draft.name}</strong>
            <p className="small muted">
              {item.envelope.source} · {item.envelope.externalId} ·{" "}
              {item.envelope.dataClass === "private"
                ? "yksityinen"
                : "julkinen"}
            </p>
            {saved ? (
              <p className="small">
                Tämä luonnos on jo tallennettu päiväkirjaan.
              </p>
            ) : (
              <button
                type="button"
                className="secondary"
                onClick={() => onOpen(item)}
              >
                Avaa tarkistettavaksi
              </button>
            )}
            <button
              type="button"
              className="quiet"
              onClick={() => {
                if (
                  !saved &&
                  !window.confirm(
                    "Poistetaanko tämä luonnos palvelun laatikosta?",
                  )
                )
                  return;
                void dismissDraft(item.id)
                  .then(() => connectionChanged())
                  .catch((e) =>
                    setError(
                      e instanceof Error ? e.message : "Poisto epäonnistui.",
                    ),
                  );
              }}
            >
              {saved ? "Merkitse käsitellyksi" : "Hylkää luonnos"}
            </button>
          </div>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
