// Asetukset-sivu: Tavoitteet, Omat ruuat (taitettuna), Tiedot, Promptit (taitettuna) ja Ulkoasu. Värit valitaan
// Ilmari Hubissa.
import { useEffect, useState } from "react";
import { type Food } from "../domain/model";
import { formatNumber } from "../domain/nutrition";
import { removeFood } from "../data/db";
import { FoodForm } from "../components/FoodForm";
import { Modal } from "../components/common";
import { Promptit } from "../components/Promptit";
import { Tavoitteet } from "../components/Tavoitteet";
import { Tiedot } from "../components/Tiedot";
import { APIAvainAsetukset } from "../components/APIAvainAsetukset";
import { hubOsoite, type NakymaProps } from "../kuori";
import { normalisoiVari, type Vari } from "../vari";
import "../tyylit/asetukset.css";

const HAKU_KUN_YLI = 8;

function OmatRuuat({ data, notify, run }: NakymaProps) {
  const [haku, setHaku] = useState(""),
    [auki, setAuki] = useState<Food | "uusi" | null>(null);
  const sana = haku.trim().toLocaleLowerCase("fi");
  const ruuat = [...data.foods]
    .sort((a, b) => a.name.localeCompare(b.name, "fi"))
    .filter((f) => f.name.toLocaleLowerCase("fi").includes(sana));
  const muokattava = auki === "uusi" ? undefined : (auki ?? undefined);
  return (
    <section>
      <h2 className="label">
        Omat ruuat{" "}
        {data.foods.length > 0 && (
          <span className="aside">{data.foods.length} ruokaa</span>
        )}
      </h2>
      <details className="fold">
        <summary>Näytä ja muokkaa</summary>
        <div className="stack">
          <div className="actions">
            <button
              className="btn"
              type="button"
              onClick={() => setAuki("uusi")}
            >
              Uusi ruoka
            </button>
            {data.foods.length > HAKU_KUN_YLI && (
              <input
                type="search"
                aria-label="Hae ruokaa"
                placeholder="Hae"
                value={haku}
                onChange={(e) => setHaku(e.target.value)}
              />
            )}
          </div>
          {ruuat.length ? (
            <ul className="rows ruuat">
              {ruuat.map((f) => (
                <li key={f.id}>
                  <button
                    className="ruoka"
                    type="button"
                    onClick={() => setAuki(f)}
                  >
                    <span>{f.name}</span>
                    <span className="muted">
                      {formatNumber(f.per100.energy, 0)} kcal / 100 g
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">
              {data.foods.length ? "Ei osumia." : "Ei omia ruokia."}
            </p>
          )}
        </div>
      </details>
      {auki && (
        <Modal
          title={muokattava ? "Muokkaa ruokaa" : "Uusi ruoka"}
          onClose={() => setAuki(null)}
        >
          <FoodForm
            food={muokattava}
            onSaved={() => {
              setAuki(null);
              notify("Ruoka tallennettu.");
            }}
          />
          {muokattava && (
            <div className="actions poisto">
              <button
                className="btn btn--stop"
                type="button"
                onClick={() =>
                  void run(async () => {
                    if (
                      !window.confirm(
                        `Poistetaanko ${muokattava.name}? Aiemmat ateriat säilyvät.`,
                      )
                    )
                      return;
                    await removeFood(muokattava.id);
                    setAuki(null);
                    notify("Ruoka poistettu.");
                  })
                }
              >
                Poista ruoka
              </button>
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}

const VARIEN_NIMET: Record<Vari, string> = {
  paperi: "Paperi",
  liitu: "Liitu",
  terminaali: "Terminaali",
  fosfori: "Fosfori",
};
const nykyinenVari = () =>
  normalisoiVari(document.documentElement.dataset.vari);

/** Nykyinen väri <html data-vari>:sta; päivittyy, kun kuori hakee uuden arvon Hubista. */
function useVari(): Vari {
  const [vari, setVari] = useState(nykyinenVari);
  useEffect(() => {
    const tarkkailija = new MutationObserver(() => setVari(nykyinenVari()));
    tarkkailija.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-vari"],
    });
    return () => tarkkailija.disconnect();
  }, []);
  return vari;
}

function Ulkoasu() {
  const vari = useVari();
  return (
    <section>
      <h2 className="label">
        Ulkoasu <span className="aside">{VARIEN_NIMET[vari]}</span>
      </h2>
      <p className="muted">
        Värit vaihdetaan{" "}
        <a href={hubOsoite(location.hostname) + "/asetukset#ulkoasu"}>
          Hubin asetuksista
        </a>
        .
      </p>
    </section>
  );
}

export default function Asetukset(props: NakymaProps) {
  return (
    <>
      <Tavoitteet data={props.data} notify={props.notify} />
      <APIAvainAsetukset notify={props.notify} />
      <OmatRuuat {...props} />
      <Tiedot {...props} />
      <Promptit />
      <Ulkoasu />
    </>
  );
}
