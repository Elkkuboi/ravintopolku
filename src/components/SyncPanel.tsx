// Asetusten Synkronointi-osio (aiops ADR-0016).
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { synkronoiNyt, synkTila, type Tulos } from "../data/sync";

function kuvaus(tulos: Tulos | null): string {
  if (!tulos) return "";
  switch (tulos.tila) {
    case "ok": return `Synkronoitu: lähetetty ${tulos.lahetetty}, vastaanotettu ${tulos.vastaanotettu}.`;
    case "ei-palvelinta": return "Työaseman palvelinta ei tavoitettu. Päiväkirja toimii laitteella, ja synkronointi jatkuu myöhemmin.";
    case "vahvista-poistot": return `Synkronointi lähettäisi ${tulos.poistoja} poistoa kaikille laitteille. Vahvista vain, jos poistit merkinnät tarkoituksella.`;
    case "virhe": return `Synkronointi epäonnistui: ${tulos.viesti}`;
  }
}

export function SyncPanel() {
  const viimeksi = useLiveQuery(async () => (await synkTila()).viimeksi, [], null);
  const [tulos, setTulos] = useState<Tulos | null>(null);
  const [kaynnissa, setKaynnissa] = useState(false);
  const aja = async (sallipoistot = false) => {
    setKaynnissa(true);
    try {
      setTulos(await synkronoiNyt(sallipoistot));
    } finally {
      setKaynnissa(false);
    }
  };
  return (
    <section className="card">
      <h2>Synkronointi</h2>
      <p className="muted small">
        {viimeksi ? `Viimeksi synkronoitu ${new Date(viimeksi).toLocaleString("fi-FI")}.` : "Ei vielä synkronoitu."}
      </p>
      {tulos && <p className="small">{kuvaus(tulos)}</p>}
      <button className="secondary" disabled={kaynnissa} onClick={() => void aja()}>
        {kaynnissa ? "Synkronoidaan…" : "Synkronoi nyt"}
      </button>
      {tulos?.tila === "vahvista-poistot" && (
        <button className="secondary" disabled={kaynnissa} onClick={() => void aja(true)}>
          Lähetä {tulos.poistoja} poistoa
        </button>
      )}
      <p className="small muted">
        Päiväkirja synkronoituu työasemalle ja muille laitteillesi. Kuvat pysyvät laitteella.
      </p>
    </section>
  );
}
