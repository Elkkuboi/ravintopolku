// Synkronoinnin poistovahvistus Asetusten Tiedot-osiossa (aiops ADR-0016): "Lähetä N poistoa", kun viimeisin ajo
// pysähtyi suureen poistojoukkoon. Automaattinen ajo (useAutoSync) ei koskaan lähetä sellaista itse, joten tämä nappi
// on ainoa tapa vahvistaa ne; ilman sitä synkronointi pysähtyisi näkymättömästi. Tilarivi: synkronointi.ts.
import { useState } from "react";
import { synkronoiNyt, type Tulos } from "../data/sync";
import { type NakymaProps } from "../kuori";

export function SyncPanel({
  tulos,
  notify,
}: {
  tulos: Tulos | null;
  notify: NakymaProps["notify"];
}) {
  const [kaynnissa, setKaynnissa] = useState(false);
  if (tulos?.tila !== "vahvista-poistot") return null;
  const laheta = async () => {
    setKaynnissa(true);
    try {
      // Jos automaattinen ajo on kesken, synkronoiNyt palauttaa sen tuloksen; poistot lähtevät vasta seuraavalla.
      let t = await synkronoiNyt(true);
      if (t.tila === "vahvista-poistot") t = await synkronoiNyt(true);
      notify(
        t.tila === "ok"
          ? "Poistot lähetetty."
          : "Synkronointi ei onnistunut. Yritä myöhemmin uudelleen.",
      );
    } finally {
      setKaynnissa(false);
    }
  };
  return (
    <>
      <p className="note note--warn">
        {tulos.poistoja} poistoa odottaa. Lähetä ne vain, jos poistit merkinnät
        itse.
      </p>
      <div className="actions">
        <button
          className="btn"
          type="button"
          disabled={kaynnissa}
          onClick={() => void laheta()}
        >
          {kaynnissa ? "Lähetetään…" : `Lähetä ${tulos.poistoja} poistoa`}
        </button>
      </div>
    </>
  );
}
