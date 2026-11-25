// Asetusten Tavoitteet-osio: tämän päivän tavoitteet lomakkeena, tavoitealue (sallittu poikkeama prosentteina),
// Ilmarin ehdotus omin sanoin ja profiili taitettuina.
import { useState } from "react";
import {
  type Dataset,
  type Goal,
  type NutrientKey,
  keys,
  labels,
  numberInput,
} from "../domain/model";
import { localDay } from "../domain/dates";
import {
  OLETUSALUEET,
  goalForDay,
  tavoitteenAlueet,
} from "../domain/nutrition";
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
  alueStrings,
  blankNutrientStrings,
  nutrientStrings,
  parseAlue,
  parseAlueet,
  parseNutrients,
  type AlueStrings,
  type NutrientStrings,
} from "./form-values";
import { alueTeksti } from "./makromittarit";
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
/** Ehdotuksen luvut, joille malli antaa myös tavoitealueen (kuitu ei kuulu ehdotukseen). */
const EHDOTETUT = ["energy", "protein", "carbs", "fat"] as const;

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
    fiber: luku(arvot.fiber),
  };
}

/** Alueen prosentit lyhyesti: "−10/+5 %", ilman ylärajaa "−10 %". */
const prosentit = (a: { alle: number; yli: number | null }) =>
  a.yli === null ? `−${a.alle} %` : `−${a.alle}/+${a.yli} %`;

/**
 * Tavoitealueen säätö: jokaiselle luvulle, kuinka monta prosenttia päivä saa jäädä alle ja mennä yli tavoitteen.
 * Rivin alla näkyy alue yksikköinä lomakkeen sen hetken luvuista, joten prosentin merkitys näkyy heti.
 */
function AlueKentat({
  alueet,
  tavoitteet,
  onChange,
}: {
  alueet: AlueStrings;
  tavoitteet: NutrientStrings;
  onChange: (a: AlueStrings) => void;
}) {
  const t = luvut(tavoitteet);
  const muuta = (k: NutrientKey, kentta: "alle" | "yli", v: string) =>
    onChange({ ...alueet, [k]: { ...alueet[k], [kentta]: v } });
  return (
    <div className="alueet">
      <p className="muted small">
        Kuinka monta prosenttia päivä saa jäädä alle tavoitteen ja mennä sen
        yli. Tyhjä yli tarkoittaa, ettei ylärajaa ole.
      </p>
      <div className="alue-rivi muted small" aria-hidden="true">
        <span />
        <span>alle %</span>
        <span>yli %</span>
      </div>
      {keys.map((k) => {
        const alue = parseAlue(alueet[k]);
        const teksti = alue
          ? alueTeksti(k, t[k], { ...OLETUSALUEET, [k]: alue })
          : "";
        return (
          <div className="alue-rivi" key={k}>
            <span>
              {labels[k]}
              <small className="muted">{teksti || "\u00a0"}</small>
            </span>
            <input
              inputMode="numeric"
              autoComplete="off"
              aria-label={`${labels[k]}: alle tavoitteen, prosenttia`}
              value={alueet[k].alle}
              onChange={(e) => muuta(k, "alle", e.target.value)}
            />
            <input
              inputMode="numeric"
              autoComplete="off"
              aria-label={`${labels[k]}: yli tavoitteen, prosenttia`}
              placeholder="–"
              value={alueet[k].yli}
              onChange={(e) => muuta(k, "yli", e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
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
  const [alueet, setAlueet] = useState(() =>
    alueStrings(tavoitteenAlueet(nykyinen)),
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
              parseAlueet(alueet),
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
      <details className="fold">
        <summary>Tavoitealue</summary>
        <AlueKentat alueet={alueet} tavoitteet={arvot} onChange={setAlueet} />
      </details>
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
  const ehdotetut = luvut(arvot);
  const varoitus = ehdotus ? vertaaMakroja(ehdotetut) : null;
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
      await saveGoal(
        hyvaksyTavoite(uudet, localDay(), nykyinen, ehdotus?.alueet),
      );
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
            {/* Ehdotetut tavoitealueet lomakkeen sen hetken luvuista. Niitä säädetään käyttöönoton jälkeen yllä. */}
            <p className="small muted">Tavoitealue</p>
            <ul className="alue-lista small muted" aria-label="Tavoitealue">
              {EHDOTETUT.map((k) => {
                const alue = ehdotus.alueet[k];
                const teksti = alueTeksti(k, ehdotetut[k], {
                  ...OLETUSALUEET,
                  [k]: alue,
                });
                return (
                  <li key={k}>
                    {labels[k]}: {teksti && `${teksti}, `}
                    {prosentit(alue)}
                  </li>
                );
              })}
            </ul>
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
