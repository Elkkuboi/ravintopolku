// Asetusten osio Promptit: ohjeet, jotka palvelin antaa kielimallille, sellaisinaan ja vain luettavina. Tekstit haetaan
// vasta, kun osio avataan. Ilmarin omat promptit ovat Hubissa.
import { useState } from "react";
import { haeKehotteet, type Kehote } from "../ai/kehotteet";
import { hubOsoite } from "../kuori";

export type PromptiTila = Kehote[] | "haetaan" | "virhe" | null;

export function PromptiLista({ tila }: { tila: PromptiTila }) {
  if (tila === null) return null;
  if (tila === "haetaan") return <p className="empty">Haetaan…</p>;
  if (tila === "virhe")
    return <p className="empty">Prompteja ei saatu työasemalta.</p>;
  return (
    <>
      {tila.map((k) => (
        <div className="stack" key={k.tunniste}>
          <p>
            <strong>{k.otsikko}</strong>
            <br />
            <small className="muted">{k.kuvaus}</small>
          </p>
          <div className="sheet pre">{k.teksti}</div>
        </div>
      ))}
    </>
  );
}

export function Promptit({
  hae = haeKehotteet,
}: {
  hae?: typeof haeKehotteet;
}) {
  const [tila, setTila] = useState<PromptiTila>(null);
  const avattu = (auki: boolean) => {
    if (!auki || (tila !== null && tila !== "virhe")) return;
    setTila("haetaan");
    void hae().then((k) => setTila(k ?? "virhe"));
  };
  return (
    <section>
      <h2 className="label">Promptit</h2>
      <details className="fold" onToggle={(e) => avattu(e.currentTarget.open)}>
        <summary>Näytä kielimallin ohjeet</summary>
        <div className="stack">
          <PromptiLista tila={tila} />
          <p className="muted">
            Ilmarin promptit ovat{" "}
            <a href={hubOsoite(location.hostname) + "/kehotteet"}>Hubissa</a>.
          </p>
        </div>
      </details>
    </section>
  );
}
