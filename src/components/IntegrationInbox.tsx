// ILMARIn luonnoslaatikko: työaseman palvelimen /api/luonnokset (aiops ADR-0026), ei Node-palvelimen /api/inbox.
import { useState, useEffect, useCallback } from "react";
import { type Dataset } from "../domain/model";
import { type Luonnos } from "../ai/contracts";
import { haeLuonnokset, poistaLuonnos } from "../ai/luonnokset";
import { connectionChanged } from "../ai/useAIStatus";
export function IntegrationInbox({
  data,
  onOpen,
}: {
  data: Dataset;
  onOpen: (item: Luonnos) => void;
}) {
  const [items, setItems] = useState<Luonnos[]>([]),
    [available, setAvailable] = useState<boolean | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    const tulos = await haeLuonnokset();
    if (tulos.tila === "ok") {
      setItems(tulos.luonnokset);
      setAvailable(true);
      setError("");
    } else if (tulos.tila === "ei-palvelinta") {
      setItems([]);
      setAvailable(false);
      setError("");
    } else {
      setError("Luonnosten haku epäonnistui: " + tulos.viesti);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const listener = () => void refresh();
    for (const name of ["ravintopolku-ai-changed", "online"])
      window.addEventListener(name, listener);
    return () => {
      clearTimeout(timer);
      for (const name of ["ravintopolku-ai-changed", "online"])
        window.removeEventListener(name, listener);
    };
  }, [refresh]);
  return (
    <>
      <h3>ILMARIn luonnoslaatikko</h3>
      <p className="small muted">
        Ilmari jättää aterialuonnokset työaseman palvelimelle, jossa ne
        säilyvät enintään seitsemän päivää. Ne päätyvät päiväkirjaan vasta
        sinun tarkistuksesi ja tallennuksesi jälkeen.
      </p>
      {available === false && (
        <p className="muted small">
          Luonnoslaatikko on käytettävissä työaseman palvelimen kautta tai
          kirjautuneena AI-palveluun.
        </p>
      )}
      {available && !items.length && (
        <p className="muted small">Ei odottavia luonnoksia.</p>
      )}
      {items.map((item) => {
        const saved = data.meals.some((m) =>
          m.assumptions.includes("ILMARI-luonnos: " + item.id),
        );
        return (
          <div className="card" key={item.id}>
            <strong>{item.draft.name}</strong>
            <p className="small muted">
              {item.source} · {item.externalId} ·{" "}
              {new Date(item.saapunut).toLocaleString("fi-FI")}
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
                    "Poistetaanko tämä luonnos palvelimen laatikosta?",
                  )
                )
                  return;
                void poistaLuonnos(item.id)
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
