// Kuori: yläpalkki, sivun valinta, päivityspalkki, ilmoitukset ja alapalkki. Sivujen sisältö on tiedostoissa
// src/nakymat/*; kuori antaa niille vain NakymaProps-propit (src/kuori.ts).
import { useState, useEffect, lazy, Suspense } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import { readDataset, storageError } from "./data/db";
import { useAutoSync } from "./data/useAutoSync";
import { SYNK_TAPAHTUMA, synkTila, viimeisinTulos } from "./data/sync";
import { tabs, tabFromHash, type Tab } from "./components/nav";
import {
  hubOsoite,
  tallennusRivi,
  type Ilmoitus,
  type NakymaProps,
} from "./kuori";
import Tanaan from "./nakymat/Tanaan";
const Kehitys = lazy(() => import("./nakymat/Kehitys"));
const Asetukset = lazy(() => import("./nakymat/Asetukset"));

function useSivu(): Tab {
  const [tab, setTab] = useState<Tab>(() => tabFromHash(location.hash));
  useEffect(() => {
    const vaihda = () => {
      setTab(tabFromHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", vaihda);
    return () => window.removeEventListener("hashchange", vaihda);
  }, []);
  return tab;
}

function useSynkTulos() {
  const [tulos, setTulos] = useState(viimeisinTulos);
  useEffect(() => {
    const kuuntelija = () => setTulos(viimeisinTulos());
    window.addEventListener(SYNK_TAPAHTUMA, kuuntelija);
    return () => window.removeEventListener(SYNK_TAPAHTUMA, kuuntelija);
  }, []);
  return tulos;
}

export default function App() {
  useAutoSync();
  const data = useLiveQuery(() => readDataset(), []),
    viimeksi = useLiveQuery(async () => (await synkTila()).viimeksi, [], null),
    tulos = useSynkTulos(),
    tab = useSivu(),
    [ilmoitus, setIlmoitus] = useState<Ilmoitus | null>(null),
    [error, setError] = useState("");
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const notify: NakymaProps["notify"] = (text, action) =>
    setIlmoitus({ text, action });
  const run: NakymaProps["run"] = async (f) => {
    setError("");
    try {
      await f();
    } catch (e) {
      setError(storageError(e));
    }
  };
  useEffect(() => {
    if (!ilmoitus) return;
    const ajastin = setTimeout(
      () => setIlmoitus(null),
      ilmoitus.action ? 12000 : 6000,
    );
    return () => clearTimeout(ajastin);
  }, [ilmoitus]);
  const paivita = () => {
    // Päivitys lataa sivun uudelleen: avoimen lomakkeen tiedot hävisivät.
    if (document.querySelector(".modal")) {
      notify("Tallenna tai sulje avoin lomake ennen päivitystä.");
      return;
    }
    void updateServiceWorker(true);
  };
  const props: NakymaProps | null = data ? { data, notify, run } : null;
  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="brand" href="#">
            RAVINTOPOLKU
          </a>
          <nav className="nav" aria-label="Sivut">
            {tabs.map((t) => (
              <a
                key={t.id}
                href={"#" + t.hash}
                aria-current={tab === t.id ? "page" : undefined}
              >
                {t.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      {needRefresh && (
        <div className="paivitys" role="status">
          <div className="wrap">
            <span>Uusi versio</span>
            <button className="btn--quiet" onClick={paivita}>
              Päivitä
            </button>
          </div>
        </div>
      )}
      <main>
        <div className="wrap">
          {!props ? (
            <p className="muted" role="status">
              Avataan…
            </p>
          ) : (
            <Suspense
              fallback={
                <p className="muted" role="status">
                  Avataan…
                </p>
              }
            >
              {tab === "progress" ? (
                <Kehitys {...props} />
              ) : tab === "settings" ? (
                <Asetukset {...props} />
              ) : (
                <Tanaan {...props} />
              )}
            </Suspense>
          )}
        </div>
      </main>
      <footer className="foot">
        <div className="wrap">
          <a className="back" href={hubOsoite(location.hostname)}>
            Ilmari Hub
          </a>
          <span>{tallennusRivi(tulos, viimeksi)}</span>
        </div>
      </footer>
      {(error || ilmoitus) && (
        <div className="ilmoitukset">
          {error && (
            <div className="ilmoitus ilmoitus--virhe" role="alert">
              <div className="wrap">
                <span>{error}</span>
                <button className="btn--quiet" onClick={() => setError("")}>
                  Sulje
                </button>
              </div>
            </div>
          )}
          {ilmoitus && (
            <div className="ilmoitus" role="status">
              <div className="wrap">
                <span>{ilmoitus.text}</span>
                {ilmoitus.action && (
                  <button
                    className="btn--quiet"
                    onClick={() => {
                      const toiminto = ilmoitus.action!.run;
                      setIlmoitus(null);
                      toiminto();
                    }}
                  >
                    {ilmoitus.action.label}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
