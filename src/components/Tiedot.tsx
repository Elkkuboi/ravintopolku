// Asetusten Tiedot-osio: synkronoinnin tila yhdellä rivillä, varmuuskopion vienti ja tuonti sekä CSV analyysiä varten.
import { useState } from "react";
import { type Dataset, TIMEZONE } from "../domain/model";
import { localDay } from "../domain/dates";
import {
  download,
  exportBackup,
  palautaVahvistettuna,
  palautusVahvistettu,
  parseBackup,
  PALAUTUS_SANA,
  type Backup,
} from "../data/backup";
import { csvExports } from "../data/csv";
import { synkronoiNyt } from "../data/sync";
import { Field, Modal } from "./common";
import { SyncPanel } from "./SyncPanel";
import { synkRivi, useSynk } from "./synkronointi";
import { useFormAction } from "./useFormAction";
import { type NakymaProps } from "../kuori";

const CSV = [
  ["meals", "Ateriarivit"],
  ["weights", "Painot"],
  ["days", "Päivät"],
] as const;
const VARMUUSKOPIO_MAX = 100 * 1024 * 1024;

function Tuonti({
  varmuuskopio,
  vie,
  onValmis,
}: {
  varmuuskopio: Backup;
  vie: () => void;
  onValmis: () => void;
}) {
  const { error, busy, execute } = useFormAction(),
    [vahvistus, setVahvistus] = useState("");
  const d = varmuuskopio.data;
  const viety = new Date(varmuuskopio.exportedAt).toLocaleDateString("fi-FI", {
    timeZone: TIMEZONE,
  });
  return (
    <div className="stack">
      <p>
        Viety {viety} · {d.meals.length} ateriaa · {d.foods.length} ruokaa ·{" "}
        {d.weights.length} painoa · {d.photos.length} kuvaa
      </p>
      <p className="note note--warn">
        Tuonti korvaa nykyiset tiedot myös muilla laitteilla.
      </p>
      <div className="actions">
        <button className="btn" type="button" disabled={busy} onClick={vie}>
          Varmuuskopioi nykyiset ensin
        </button>
      </div>
      <Field label={`Kirjoita ${PALAUTUS_SANA} vahvistaaksesi`}>
        <input
          value={vahvistus}
          onChange={(e) => setVahvistus(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </Field>
      {error && (
        <p className="note note--stop" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          className="btn btn--stop"
          type="button"
          disabled={busy || !palautusVahvistettu(vahvistus)}
          onClick={() =>
            void execute(async () => {
              await palautaVahvistettuna(varmuuskopio, vahvistus);
              onValmis();
            })
          }
        >
          {busy ? "Tuodaan…" : "Korvaa tiedot"}
        </button>
      </div>
    </div>
  );
}

export function Tiedot({
  data,
  notify,
  run,
}: {
  data: Dataset;
  notify: NakymaProps["notify"];
  run: NakymaProps["run"];
}) {
  const { tulos, viimeksi } = useSynk();
  const [tuotava, setTuotava] = useState<Backup | null>(null);
  const vie = () =>
    void run(async () => {
      const b = await exportBackup();
      download(JSON.stringify(b, null, 2), `ravintopolku-${localDay()}.json`);
      notify("Varmuuskopio ladattu.");
    });
  return (
    <section>
      <h2 className="label">
        Tiedot <span className="aside">{synkRivi(tulos, viimeksi)}</span>
      </h2>
      <SyncPanel tulos={tulos} notify={notify} />
      <div className="actions">
        <button className="btn" type="button" onClick={vie}>
          Varmuuskopio
        </button>
        <label className="btn file">
          Tuo varmuuskopio
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f)
                void run(async () => {
                  if (f.size > VARMUUSKOPIO_MAX)
                    throw new Error(
                      "Varmuuskopio on liian suuri (enintään 100 Mt).",
                    );
                  setTuotava(parseBackup(await f.text()));
                });
            }}
          />
        </label>
      </div>
      <details className="fold">
        <summary>Vie CSV</summary>
        <div className="actions">
          {CSV.map(([avain, nimi]) => (
            <button
              key={avain}
              className="btn"
              type="button"
              onClick={() => {
                download(
                  csvExports(data)[avain],
                  `ravintopolku-${avain}-${localDay()}.csv`,
                  "text/csv;charset=utf-8",
                );
                notify("CSV ladattu.");
              }}
            >
              {nimi}
            </button>
          ))}
        </div>
      </details>
      {tuotava && (
        <Modal title="Tuo varmuuskopio" onClose={() => setTuotava(null)}>
          <Tuonti
            varmuuskopio={tuotava}
            vie={vie}
            onValmis={() => {
              setTuotava(null);
              notify("Varmuuskopio tuotu.");
              // Tila heti näkyviin: suuri poistojoukko pysähtyy vahvistettavaksi tämän osion napille.
              void synkronoiNyt();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
