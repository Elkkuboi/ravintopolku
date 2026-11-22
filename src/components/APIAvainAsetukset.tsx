// API-avainasetukset (yritys 167): avain jaetaan kaverille, jotta hän voi käyttää
// Ravintopolku-palvelinta. Tallennetaan localStorageiin; synkronointi lähettää sen
// Authorization-otsakeena, jos se on asetettu. "Testaa yhteys" kutsuu GET /api/profiilit
// avaimella ja kertoo, onko palvelin vastaanottanut sen.
import { useState } from "react";
import { getAPIAvain, setAPIAvain } from "../data/db";

export function APIAvainAsetukset({
  notify,
}: {
  notify: (text: string) => void;
}) {
  const [avain, setAvain] = useState(() => getAPIAvain());
  const [tarkistetaan, setTarkistetaan] = useState(false);
  const tallenna = () => {
    setAPIAvain(avain.trim());
    notify(avain.trim() ? "API-avain tallennettu." : "API-avain poistettu.");
  };
  const testaa = async () => {
    if (!avain.trim()) {
      notify("Ei API-avainta testattavaksi.");
      return;
    }
    setTarkistetaan(true);
    try {
      const r = await fetch("/api/profiilit", {
        method: "GET",
        credentials: "same-origin",
        headers: { Authorization: "Bearer " + avain.trim() },
      });
      if (r.ok) notify("Yhteys palvelimeen toimii: avain hyväksytty.");
      else notify(`Yhteys epäonnistui: palvelin vastasi ${r.status}.`);
    } catch {
      notify("Yhteys epäonnistui: palvelimeen ei päästä.");
    } finally {
      setTarkistetaan(false);
    }
  };
  return (
    <section>
      <h2 className="label">API-avain</h2>
      <div className="lomake stack">
        <input
          type="password"
          aria-label="API-avain"
          placeholder="Bearer ..."
          value={avain}
          onChange={(e) => setAvain(e.target.value)}
        />
        <div className="actions">
          <button className="btn" type="button" onClick={tallenna}>
            Tallenna
          </button>
          <button
            className="btn btn--quiet"
            type="button"
            disabled={tarkistetaan || !avain.trim()}
            onClick={() => void testaa()}
          >
            {tarkistetaan ? "Tarkistetaan…" : "Testaa yhteys"}
          </button>
        </div>
        <p className="muted note">
          Anna tämä avain kaverillesi, jotta hän voi käyttää Ravintopolku-palvelinta.
        </p>
      </div>
    </section>
  );
}
