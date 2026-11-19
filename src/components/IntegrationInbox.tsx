// Ilmarin odottavat aterialuonnokset työaseman palvelimelta (/api/luonnokset, aiops ADR-0026). Osio näkyy vain, kun
// luonnoksia on: ilman palvelinta, offline-tilassa tai tyhjällä laatikolla siitä ei jää riviäkään.
import { useState, useEffect, useCallback } from "react";
import { type Dataset } from "../domain/model";
import { type Luonnos } from "../ai/contracts";
import { haeLuonnokset, poistaLuonnos } from "../ai/luonnokset";
const aika = new Intl.DateTimeFormat("fi-FI", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Helsinki",
});
export function IntegrationInbox({
  data,
  paivitys,
  onOpen,
}: {
  data: Dataset;
  /** Kasvaa, kun luonnos on tallennettu ja kuitattu: laatikko haetaan uudelleen. */
  paivitys: number;
  onOpen: (item: Luonnos) => void;
}) {
  const [items, setItems] = useState<Luonnos[]>([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    const tulos = await haeLuonnokset();
    if (tulos.tila === "ok") setItems(tulos.luonnokset);
    else if (tulos.tila === "ei-palvelinta") setItems([]);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const listener = () => void refresh();
    window.addEventListener("online", listener);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", listener);
    };
  }, [refresh, paivitys]);
  if (!items.length) return null;
  return (
    <section aria-label="Ilmarin luonnokset">
      <h2 className="label">
        Ilmarin luonnokset <span className="aside">{items.length}</span>
      </h2>
      <ul className="rows">
        {items.map((item) => {
          const saved = data.meals.some((m) =>
            m.assumptions.includes("ILMARI-luonnos: " + item.id),
          );
          const saapui = new Date(item.saapunut);
          return (
            <li className="luonnos" key={item.id}>
              <span>{item.draft.name}</span>
              <span className="when">
                {saved
                  ? "tallennettu"
                  : Number.isNaN(saapui.getTime())
                    ? ""
                    : aika.format(saapui).replace(" klo", "")}
              </span>
              <span className="actions">
                {!saved && (
                  <button
                    type="button"
                    className="btn--quiet"
                    onClick={() => onOpen(item)}
                  >
                    Tarkista
                  </button>
                )}
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => {
                    if (
                      !saved &&
                      !window.confirm("Hylätäänkö Ilmarin luonnos?")
                    )
                      return;
                    setError("");
                    void poistaLuonnos(item.id)
                      .then(refresh)
                      .catch((e) =>
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Poisto epäonnistui.",
                        ),
                      );
                  }}
                >
                  {saved ? "Kuittaa" : "Hylkää"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="note note--stop" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
