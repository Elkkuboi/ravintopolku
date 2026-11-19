// Asetusten Tavoitteet-osio: tämän päivän tavoitteet lomakkeena, Ilmarin ehdotus omin sanoin ja profiili taitettuina.
import { useState } from "react";
import { type Dataset, type Goal, numberInput } from "../domain/model";
import { localDay } from "../domain/dates";
import { goalForDay } from "../domain/nutrition";
import { saveGoal } from "../data/db";
import {
  TEKSTI_MAX,
  ehdotaTavoitteet,
  hyvaksyTavoite,
  profiiliKuvaus,
  tarkistaRajat,
  tavoiteLomakkeesta,
  vertaaMakroja,
  type TavoiteEhdotus,
} from "../ai/tavoitteet";
import {
  blankNutrientStrings,
  nutrientStrings,
  parseNutrients,
  type NutrientStrings,
} from "./form-values";
import { Decimal, Field } from "./common";
import { ProfileForm } from "./ProfileForm";
import { useFormAction } from "./useFormAction";
import { type NakymaProps } from "../kuori";

type Notify = NakymaProps["notify"];
const KENTAT = [
  ["energy", "Energia kcal"],
  ["protein", "Proteiini g"],
  ["carbs", "Hiilihydraatit g"],
  ["fat", "Rasva g"],
  ["fiber", "Kuitu g"],
] as const;
const MAKROT = KENTAT.slice(0, 4);

function Kentat({
  kentat,
  arvot,
  onChange,
}: {
  kentat: readonly (typeof KENTAT)[number][];
  arvot: NutrientStrings;
  onChange: (v: NutrientStrings) => void;
}) {
  return kentat.map(([k, nimi]) => (
    <Field key={k} label={nimi}>
      <Decimal
        value={arvot[k]}
        onChange={(v) => onChange({ ...arvot, [k]: v })}
        placeholder=""
      />
    </Field>
  ));
}

/** Keskeneräinenkin syöte kelpaa vertailuun: kelvoton teksti on tyhjä arvo, ei virhe. */
function luvut(arvot: NutrientStrings) {
  const luku = (s: string) => {
    const n = Number(s.trim().replace(",", "."));
    return s.trim() && Number.isFinite(n) ? n : null;
  };
  return {
    energy: luku(arvot.energy),
    protein: luku(arvot.protein),
    carbs: luku(arvot.carbs),
    fat: luku(arvot.fat),
  };
}

function TavoiteLomake({
  nykyinen,
  notify,
}: {
  nykyinen?: Goal;
  notify: Notify;
}) {
  const [arvot, setArvot] = useState(() =>
    nykyinen ? nutrientStrings(nykyinen.nutrients) : blankNutrientStrings(),
  );
  const [paino, setPaino] = useState(() =>
    typeof nykyinen?.targetWeight === "number"
      ? String(nykyinen.targetWeight).replace(".", ",")
      : "",
  );
  const { error, busy, execute } = useFormAction();
  return (
    <form
      className="lomake"
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          await saveGoal(
            tavoiteLomakkeesta(
              parseNutrients(arvot),
              numberInput(paino, true),
              localDay(),
              nykyinen,
            ),
          );
          notify("Tavoitteet tallennettu.");
        });
      }}
    >
      <div className="fields">
        <Kentat kentat={KENTAT} arvot={arvot} onChange={setArvot} />
        <Field label="Tavoitepaino kg">
          <Decimal value={paino} onChange={setPaino} placeholder="" />
        </Field>
      </div>
      {error && (
        <p className="note note--stop" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="btn btn--primary" type="submit" disabled={busy}>
          Tallenna
        </button>
      </div>
    </form>
  );
}

function Ehdotus({
  data,
  nykyinen,
  notify,
}: {
  data: Dataset;
  nykyinen?: Goal;
  notify: Notify;
}) {
  const [teksti, setTeksti] = useState(""),
    [ehdotus, setEhdotus] = useState<TavoiteEhdotus | null>(null),
    [arvot, setArvot] = useState<NutrientStrings>(blankNutrientStrings());
  const { error, busy, execute } = useFormAction();
  const varoitus = ehdotus ? vertaaMakroja(luvut(arvot)) : null;
  const pyyda = () =>
    execute(async () => {
      setEhdotus(null);
      const uusinPaino =
        [...data.weights].sort((a, b) => b.date.localeCompare(a.date))[0]?.kg ??
        null;
      const tulos = await ehdotaTavoitteet(teksti, {
        profiili: profiiliKuvaus(data.profiles[0], {
          weight: uusinPaino,
          goalEnergy: nykyinen?.nutrients.energy ?? null,
        }),
      });
      setEhdotus(tulos);
      setArvot(nutrientStrings({ ...tulos.ehdotus, fiber: null }));
    });
  const hyvaksy = () =>
    execute(async () => {
      const uudet = parseNutrients(arvot);
      tarkistaRajat(uudet);
      await saveGoal(hyvaksyTavoite(uudet, localDay(), nykyinen));
      setEhdotus(null);
      setTeksti("");
      notify("Tavoitteet tallennettu.");
    });
  return (
    <details className="fold">
      <summary>Ehdota tavoitteet omin sanoin</summary>
      <div className="stack">
        <textarea
          rows={3}
          aria-label="Tavoite omin sanoin"
          value={teksti}
          maxLength={TEKSTI_MAX}
          placeholder="esim. haluan laihtua rauhallisesti ja syödä enemmän proteiinia"
          onChange={(e) => setTeksti(e.target.value)}
        />
        <div className="actions">
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void pyyda()}
          >
            {busy && !ehdotus ? "Ehdotetaan…" : "Ehdota"}
          </button>
        </div>
        {error && (
          <p className="note note--stop" role="alert">
            {error}
          </p>
        )}
        {ehdotus && (
          <>
            {ehdotus.perustelu && <p>{ehdotus.perustelu}</p>}
            {ehdotus.oletukset.length > 0 && (
              <p className="small muted">{ehdotus.oletukset.join(" · ")}</p>
            )}
            <div className="fields">
              <Kentat kentat={MAKROT} arvot={arvot} onChange={setArvot} />
            </div>
            {varoitus && <p className="note note--warn">{varoitus}</p>}
            <div className="actions">
              <button
                className="btn btn--primary"
                type="button"
                disabled={busy}
                onClick={() => void hyvaksy()}
              >
                Ota käyttöön
              </button>
              <button
                className="btn btn--quiet"
                type="button"
                onClick={() => setEhdotus(null)}
              >
                Hylkää
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

export function Tavoitteet({
  data,
  notify,
}: {
  data: Dataset;
  notify: Notify;
}) {
  const nykyinen = goalForDay(data.goals, localDay()),
    profiili = data.profiles[0];
  return (
    <section>
      <h2 className="label">Tavoitteet</h2>
      {/* Uusi avain, kun tavoite vaihtuu (tallennus tai synkronointi): lomake näyttää voimassa olevat luvut. */}
      <TavoiteLomake
        key={nykyinen?.id ?? "ei"}
        nykyinen={nykyinen}
        notify={notify}
      />
      <Ehdotus data={data} nykyinen={nykyinen} notify={notify} />
      <details className="fold">
        <summary>Profiili</summary>
        <ProfileForm
          key={profiili?.updatedAt ?? "ei"}
          profile={profiili}
          onSaved={() => notify("Profiili tallennettu.")}
        />
      </details>
    </section>
  );
}
