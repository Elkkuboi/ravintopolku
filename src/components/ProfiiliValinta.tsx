// Profiilien valinta ja luonti (yritys 167): profiilit ovat laitteella paikallisia ja synkronointi
// käyttää aktiivisen profiilin palvelin-id:ää X-Profiili-otsakkeessa. Profiilivaihto käynnistää
// synkronoinnin uudelleen, jotta uuden profiilin tiet lähetetään palvelimelle.
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { listProfiilit, luoProfiili, setAktiivinenProfiili } from "../data/db";
import { synkronoiNyt } from "../data/sync";
import { type NakymaProps } from "../kuori";

export function ProfiiliValinta({ notify, run }: Pick<NakymaProps, "notify" | "run">) {
  const profiilit = useLiveQuery(() => listProfiilit(), []);
  const [avaa, setAvaa] = useState(false);
  const [nimi, setNimi] = useState("");
  if (!profiilit) return null;
  const aktiivinen = profiilit.find((p) => p.aktiivinen);
  const valitse = async (id: string) => {
    setAvaa(false);
    await run(async () => {
      await setAktiivinenProfiili(id);
      // Profiilivaihto: käynnistä synkronointi, jotta uusi profiili lähetetään palvelimelle.
      void synkronoiNyt();
    });
  };
  const luo = async () => {
    const uudenNimi = nimi.trim();
    if (!uudenNimi) return;
    await run(async () => {
      const uusi = await luoProfiili(uudenNimi);
      setNimi("");
      setAvaa(false);
      await setAktiivinenProfiili(uusi.id);
      notify(`Profiili "${uusi.name}" luotu ja valittu.`);
      void synkronoiNyt();
    });
  };
  return (
    <details className="profiilit" open={avaa} onToggle={(e) => setAvaa((e.target as HTMLDetailsElement).open)}>
      <summary className="profiili-valinta">
        <span className="muted">Profiili</span>
        <span>{aktiivinen?.name ?? "–"}</span>
        <span className="muted" aria-hidden="true">▾</span>
      </summary>
      <div className="stack">
        <ul className="rows">
          {profiilit.map((p) => (
            <li key={p.id}>
              <button
                className={p.aktiivinen ? "ruoka ruoka--aktiivinen" : "ruoka"}
                type="button"
                aria-pressed={p.aktiivinen}
                onClick={() => void valitse(p.id)}
              >
                <span>{p.name}</span>
                {p.serverId && <span className="muted">{p.serverId}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="actions lomake">
          <input
            type="text"
            aria-label="Uuden profiilin nimi"
            placeholder="Uuden profiilin nimi"
            value={nimi}
            maxLength={100}
            onChange={(e) => setNimi(e.target.value)}
          />
          <button
            className="btn"
            type="button"
            disabled={!nimi.trim()}
            onClick={() => void luo()}
          >
            Luo uusi profiili
          </button>
        </div>
        <p className="muted note">
          Profiili vaihdetaan laitteella; palvelin-tunniste (serverId) asetetaan palvelimella.
        </p>
      </div>
    </details>
  );
}
