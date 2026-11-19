// Tänään-sivu: päivän kirjaukset. Siirretty App.tsx:stä sellaisenaan (kokeilutila ja kuvakkeet pois); uusi ulkoasu
// tehdään tähän tiedostoon ja tyylit tiedostoon src/tyylit/tanaan.css.
import { type AIDraft } from "../ai/provider";
import { poistaLuonnos } from "../ai/luonnokset";
import {
  tulkitseKuva,
  ateriaKuvasta,
  OLETUSROOLI,
  OLETUSLAHDE,
  ROOLIN_NIMI,
  LISATIEDOT_MAX,
} from "../ai/kuva-ateria";
import { compressPhoto } from "../data/photos";
import { connectionChanged } from "../ai/useAIStatus";
import { useState, lazy, Suspense } from "react";
import {
  type Meal,
  type Photo,
  keys,
  labels,
  stamped,
  id,
} from "../domain/model";
import { localDay, displayDay, addDays, wallTimestamp } from "../domain/dates";
import {
  dayTotals,
  mealTotals,
  formatNumber,
  goalForDay,
} from "../domain/nutrition";
import { saveRecord, deleteMeal, saveMeal, defaultMealTime } from "../data/db";
import { FoodForm } from "../components/FoodForm";
import { MealEditor } from "../components/MealEditor";
import {
  WeightForm,
  LifestyleForm,
  PainonKirjaus,
} from "../components/DailyForms";
import { MakroMittarit } from "../components/MakroMittarit";
import { IntegrationInbox } from "../components/IntegrationInbox";
import { Modal, BlobImage, Field } from "../components/common";
import { type NakymaProps } from "../kuori";
import "../tyylit/vanha-tanaan.css";
// Recharts ladataan vasta makrokuvaajien mukana, jotta ensivälitys pysyy pienenä.
const MakroKuvaajat = lazy(() =>
  import("../components/MakroKuvaajat").then((m) => ({
    default: m.MakroKuvaajat,
  })),
);
type Dialog =
  | { kind: "meal"; meal?: Meal; initialDraft?: AIDraft; inboxId?: string }
  | { kind: "weight" }
  | { kind: "lifestyle" }
  | null;
export default function Tanaan({ data, notify, run }: NakymaProps) {
  const [date, setDate] = useState(localDay()),
    [dialog, setDialog] = useState<Dialog>(null),
    [nestedFood, setNestedFood] = useState(false),
    [kuvaKesken, setKuvaKesken] = useState(false),
    [kuvaLisatiedot, setKuvaLisatiedot] = useState("");
  const saved = () => {
    if (dialog?.kind === "meal" && dialog.inboxId)
      void poistaLuonnos(dialog.inboxId)
        .then(() => connectionChanged())
        .catch(() =>
          notify(
            "Ateria tallennettu laitteelle. Luonnos jäi palvelimen laatikkoon; merkitse se käsitellyksi myöhemmin.",
          ),
        );
    setDialog(null);
    notify("Tallennettu.");
    void navigator.storage?.persist?.().catch(() => {});
  };
  const p = data.profiles[0],
    meals = data.meals
      .filter((m) => m.date === date)
      .sort((a, b) => a.time.localeCompare(b.time)),
    totals = dayTotals(meals),
    goal = goalForDay(data.goals, date),
    weight = data.weights.find((w) => w.date === date),
    lifestyle = data.lifestyles.find((l) => l.date === date),
    status = data.days.find((d) => d.date === date),
    isToday = date === localDay();
  const open = (d: Dialog) => setDialog(d);
  const kuvaRooli = data.settings[0]?.kuvantulkinta ?? OLETUSROOLI;
  const kuvaLahde = data.settings[0]?.kuvantunnistus ?? OLETUSLAHDE;
  // Kuvasta ateria (aiops ADR-0027): kuva ja vapaat lisätiedot -> lähde (paikallinen Ilmari työaseman palvelimen
  // kautta tai palvelimen API-avain) -> ateria heti päiväkirjaan.
  const kuvaaAteria = (file: File) =>
    void run(async () => {
      setKuvaKesken(true);
      try {
        let photo: Photo | null = null;
        try {
          photo = { ...stamped(), blob: await compressPhoto(file) };
        } catch {
          photo = null; // kuva lähetetään silti; ateriaan jää merkintä, ettei kuvaa tallennettu
        }
        // Lisätiedot lähtevät kuvan mukana välittäjälle ja jäävät ateriaan näkyviin tarkistusta varten.
        const tulos = await tulkitseKuva(
          photo?.blob ?? file,
          kuvaRooli,
          date,
          kuvaLisatiedot,
          fetch,
          kuvaLahde,
        );
        const meal = ateriaKuvasta(
          tulos,
          date,
          defaultMealTime(date),
          photo,
          kuvaLisatiedot,
        );
        await saveMeal(meal, photo);
        setKuvaLisatiedot("");
        notify("Ateria lisätty kuvasta – tarkista tarvittaessa", {
          label: "Avaa",
          run: () => open({ kind: "meal", meal }),
        });
        void navigator.storage?.persist?.().catch(() => {});
      } finally {
        setKuvaKesken(false);
      }
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">HYVINVOINTIA OMAAN TAHTIIN</p>
          <h1>
            {isToday
              ? `Hei${p?.name ? ", " + p.name : ""}.`
              : "Oma päiväkirjasi."}
          </h1>
          <p className="muted">
            {isToday
              ? "Miltä sinun päiväsi näyttää?"
              : "Palaa kirjauksiisi ja täydennä omaa polkuasi."}
          </p>
        </div>
        <button
          className="primary add-desktop"
          onClick={() => open({ kind: "meal" })}
        >
          Lisää ruoka
        </button>
      </div>
      <div className="day-selector">
        <button
          className="icon-button"
          aria-label="Edellinen päivä"
          onClick={() => setDate(addDays(date, -1))}
        >
          ‹
        </button>
        <div>
          <strong>{isToday ? "Tänään" : displayDay(date)}</strong>
          <label>
            <span className="sr-only">Valitse päivä</span>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </label>
        </div>
        <button
          className="icon-button"
          aria-label="Seuraava päivä"
          onClick={() => setDate(addDays(date, 1))}
        >
          ›
        </button>
        {!isToday && (
          <button className="quiet" onClick={() => setDate(localDay())}>
            Tänään
          </button>
        )}
      </div>
      <section className="card kuva-ateria">
        <label
          className={"primary file-button" + (kuvaKesken ? " busy" : "")}
          aria-disabled={kuvaKesken}
        >
          {kuvaKesken ? "Tulkitaan kuvaa…" : "Kuvaa ateria"}
          <input
            type="file"
            accept="image/*"
            disabled={kuvaKesken}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) kuvaaAteria(f);
              e.target.value = "";
            }}
          />
        </label>
        <div>
          <Field
            label="Lisätiedot tekoälylle (vapaaehtoinen)"
            hint={`Teksti lähtee kuvan mukana tulkitsijalle ja näkyy ateriaan tallennetuissa tiedoissa. Enintään ${LISATIEDOT_MAX} merkkiä.`}
          >
            <textarea
              value={kuvaLisatiedot}
              onChange={(e) => setKuvaLisatiedot(e.target.value)}
              disabled={kuvaKesken}
              maxLength={LISATIEDOT_MAX}
              rows={2}
              placeholder="Esim. leivässä on kaksi viipaletta Oltermanni light -juustoa"
            />
          </Field>
          <div>
            {kuvaKesken ? (
              <p className="small" role="status">
                Kuva lähetetty tulkittavaksi. Tämä voi kestää 10–60 sekuntia.
              </p>
            ) : (
              <p className="small muted">
                {`Ateria tai pakkauksen tuoteseloste yhdestä kuvasta, ilman muita kenttiä. Ota kuva kameralla tai valitse se galleriasta. Kuva tulkitaan ${
                  kuvaLahde === "api"
                    ? "palvelimen API-avaimella (OpenAI)"
                    : `työaseman palvelimen kautta paikallisella Ilmarilla (rooli ${ROOLIN_NIMI[kuvaRooli]})`
                }. Ateria tallentuu heti; voit muokata sitä.`}
              </p>
            )}
          </div>
        </div>
      </section>
      <section className="card">
        <IntegrationInbox
          data={data}
          onOpen={(item) =>
            open({
              kind: "meal",
              initialDraft: item.draft,
              inboxId: String(item.id),
            })
          }
        />
      </section>
      <MakroMittarit totals={totals} goal={goal} />
      <Suspense
        fallback={
          <p className="muted" role="status">
            Ladataan makrokuvaajia…
          </p>
        }
      >
        <MakroKuvaajat data={data} end={date} />
      </Suspense>
      <div className="dashboard-grid">
        <section className="card energy-card">
          <div className="section-heading">
            <h2>Päivän energia</h2>
          </div>
          <div className="energy-value">
            {formatNumber(totals.energy.value, 0)} <span>kcal</span>
          </div>
          <p className="muted">
            {totals.energy.value === null
              ? "Ei energiatietoa"
              : totals.energy.partial
                ? "Kirjattu osittainen summa"
                : "Kirjattu yhteensä"}
            {goal?.nutrients.energy !== null &&
            goal?.nutrients.energy !== undefined
              ? ` · tavoite ${formatNumber(goal.nutrients.energy, 0)} kcal`
              : ""}
          </p>
          <div className="coverage">
            <span
              className={
                status?.complete ? "status-dot complete" : "status-dot"
              }
            />
            <span>
              {status?.complete
                ? "Päivän kirjaukset merkitty valmiiksi"
                : meals.length
                  ? "Kirjaukset keskeneräiset"
                  : "Päivää ei ole vielä kirjattu"}
            </span>
          </div>
        </section>
        <section className="card nutrients-card">
          <h2>Ravintoaineet</h2>
          {keys
            .filter((k) => k !== "energy")
            .map((k) => (
              <div className="nutrient-row" key={k}>
                <div>
                  <span className={"nutrient-dot " + k} />
                  <span>{labels[k]}</span>
                  {totals[k].partial && <small>Osittainen</small>}
                </div>
                <strong>
                  {formatNumber(totals[k].value)} <span>g</span>
                </strong>
                {goal?.nutrients[k] !== null &&
                  goal?.nutrients[k] !== undefined && (
                    <small className="target">
                      Tavoite {formatNumber(goal.nutrients[k])} g
                    </small>
                  )}
              </div>
            ))}
        </section>
      </div>
      {keys.some((k) => totals[k].partial) && (
        <p className="missing-notice">
          Puuttuvia tietoja:{" "}
          {keys
            .filter((k) => totals[k].partial)
            .map((k) => labels[k].toLocaleLowerCase("fi"))
            .join(", ")}
          . Osittainen summa ei kerro koko saannista.
        </p>
      )}
      <section className="meals-section">
        <div className="section-heading">
          <h2>
            Päivän ateriat <span className="count">{meals.length}</span>
          </h2>
          <button className="quiet" onClick={() => open({ kind: "meal" })}>
            Lisää ateria
          </button>
        </div>
        {!meals.length ? (
          <div className="card empty-state">
            <h3>Ensimmäinen kirjaus on hyvä alku.</h3>
            <p className="muted">
              Lisää ruoka omasta kirjastosta tai kirjaa annoksen arvot käsin.
            </p>
            <button className="primary" onClick={() => open({ kind: "meal" })}>
              Lisää ruoka
            </button>
          </div>
        ) : (
          meals.map((meal) => {
            const total = mealTotals(meal),
              photo = data.photos.find((p) => p.id === meal.photoId);
            return (
              <article className="card meal-card" key={meal.id}>
                <div className="meal-main">
                  {photo && (
                    <BlobImage
                      blob={photo.blob}
                      alt={`${meal.type}, aterian kuva`}
                      className="meal-thumb"
                    />
                  )}
                  <div className="meal-description">
                    <p className="meal-time">
                      {meal.time} · {meal.type}
                    </p>
                    <h3>{meal.lines.map((l) => l.name).join(", ")}</h3>
                    <p className="small muted">
                      {meal.lines
                        .map((l) =>
                          l.mode === "per100"
                            ? `${formatNumber(l.grams)} g${l.state ? " " + l.state : ""}`
                            : "Annoksen arvot",
                        )
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="meal-calories">
                    <strong>{formatNumber(total.energy.value, 0)}</strong>
                    <span>kcal{total.energy.partial ? " *" : ""}</span>
                  </div>
                </div>
                {meal.note && <p className="small meal-note">{meal.note}</p>}
                <div className="meal-bottom">
                  <span className="small muted">
                    P {formatNumber(total.protein.value)} g · H{" "}
                    {formatNumber(total.carbs.value)} g · R{" "}
                    {formatNumber(total.fat.value)} g
                    {total.protein.partial ||
                    total.carbs.partial ||
                    total.fat.partial
                      ? " · osittainen"
                      : ""}
                  </span>
                  <details
                    className="meal-actions"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button"))
                        e.currentTarget.open = false;
                    }}
                  >
                    <summary>Toiminnot</summary>
                    <div className="action-menu">
                      <button onClick={() => open({ kind: "meal", meal })}>
                        Muokkaa / siirrä
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            const target = window.prompt(
                              "Kopioi päivälle (vvvv-kk-pp):",
                              date,
                            );
                            if (!target) return;
                            const photo = photoClone(
                              data.photos.find((p) => p.id === meal.photoId),
                            );
                            const time = defaultMealTime(target);
                            await saveMeal(
                              {
                                ...meal,
                                ...stamped(),
                                date: target,
                                time,
                                timestamp: wallTimestamp(target, time),
                                lines: meal.lines.map((l) => ({
                                  ...l,
                                  id: id(),
                                })),
                                photoId: photo?.id ?? null,
                              },
                              photo,
                            );
                            notify("Ateria kopioitu.");
                          })
                        }
                      >
                        Kopioi toiselle päivälle
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            const name = window.prompt(
                              "Vakioaterian nimi:",
                              meal.type,
                            );
                            if (!name) return;
                            await saveRecord("templates", {
                              ...stamped(),
                              name,
                              lines: structuredClone(meal.lines),
                              type: meal.type,
                            });
                            notify("Vakioateria tallennettu määrineen.");
                          })
                        }
                      >
                        Tallenna vakioateriaksi
                      </button>
                      <button
                        className="danger-link"
                        onClick={() =>
                          void run(async () => {
                            if (
                              window.confirm(
                                "Poistetaanko ateria ja siihen liitetty kuva?",
                              )
                            ) {
                              await deleteMeal(meal);
                              notify("Ateria poistettu.");
                            }
                          })
                        }
                      >
                        Poista
                      </button>
                    </div>
                  </details>
                </div>
              </article>
            );
          })
        )}
      </section>
      <div className="daily-extras">
        <section className="card">
          <div className="section-heading">
            <h2>Paino</h2>
            <button className="quiet" onClick={() => open({ kind: "weight" })}>
              {weight ? "Muokkaa" : "Kirjaa paino"}
            </button>
          </div>
          <div className="small-stat">
            {formatNumber(weight?.kg ?? null)} <span>kg</span>
          </div>
          <PainonKirjaus date={date} weight={weight} onSaved={notify} />
          <p className="small muted">
            {weight?.note ||
              "Vain halutessasi: painoa ei kysytä pakolla, yksi mittaus päivässä riittää."}
          </p>
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>Oma olo</h2>
            <button
              className="quiet"
              onClick={() => open({ kind: "lifestyle" })}
            >
              {lifestyle ? "Muokkaa" : "Kirjaa"}
            </button>
          </div>
          <p className="small muted">
            {lifestyle
              ? `${formatNumber(lifestyle.steps, 0)} askelta · uni ${formatNumber(lifestyle.sleep)} h · nälkä ${formatNumber(lifestyle.hunger)}/5 · vireys ${formatNumber(lifestyle.energy)}/5`
              : "Uni, liike ja oma olo. Vain jos haluat."}
          </p>
          {lifestyle?.training && <p className="small">{lifestyle.training}</p>}
        </section>
      </div>
      <section className="completion-section">
        <div>
          <strong>Ovatko päivän kirjaukset valmiit?</strong>
          <p className="muted small">
            Vain sinä tiedät, onko kaikki kirjattu. Ravintoarvojen puutteet
            säilyvät näkyvissä.
          </p>
        </div>
        <button
          className={status?.complete ? "secondary" : "primary"}
          onClick={() =>
            void run(async () => {
              await saveRecord("days", {
                ...stamped(status),
                date,
                complete: !status?.complete,
              });
              notify(
                status?.complete
                  ? "Päivä merkitty keskeneräiseksi."
                  : "Päivän kirjaukset merkitty valmiiksi.",
              );
            })
          }
        >
          {status?.complete ? "Merkitse keskeneräiseksi" : "Merkitse valmiiksi"}
        </button>
      </section>
      {dialog && (
        <Modal
          title={
            dialog.kind === "meal"
              ? dialog.meal
                ? "Muokkaa ateriaa"
                : "Lisää ateria"
              : dialog.kind === "weight"
                ? weight
                  ? "Muokkaa painomittausta"
                  : "Kirjaa paino"
                : "Elintapakirjaus"
          }
          onClose={() => {
            if (
              window.confirm(
                "Suljetaanko lomake? Tallentamattomat muutokset häviävät.",
              )
            )
              setDialog(null);
          }}
        >
          {dialog.kind === "meal" ? (
            <MealEditor
              data={data}
              date={date}
              meal={dialog.meal}
              initialDraft={dialog.initialDraft}
              inboxId={dialog.inboxId}
              onSaved={saved}
              onNewFood={() => setNestedFood(true)}
            />
          ) : dialog.kind === "weight" ? (
            <WeightForm date={date} weight={weight} onSaved={saved} />
          ) : (
            <LifestyleForm date={date} lifestyle={lifestyle} onSaved={saved} />
          )}
        </Modal>
      )}
      {nestedFood && (
        <Modal
          title="Luo oma ruoka"
          onClose={() => {
            if (window.confirm("Hylätäänkö tallentamattoman ruuan tiedot?"))
              setNestedFood(false);
          }}
        >
          <FoodForm
            onSaved={() => {
              setNestedFood(false);
              notify("Ruoka tallennettu. Valitse se aterian ruokahausta.");
            }}
          />
        </Modal>
      )}
    </>
  );
}
function photoClone(photo: Photo | undefined) {
  return photo ? { ...stamped(), blob: photo.blob } : null;
}
