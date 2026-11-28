// Tänään-sivu: päivän vaihto, energia ja makrot, kuvanapit ja käsin kirjaus, Ilmarin odottavat luonnokset (vain jos
// niitä on), ateriat, paino, treenipäivä sekä taitettu "Uni, liike ja olo". Kuvan valinnan jälkeen sivu näyttää kuvapolun
// (components/KuvaLuonnos.tsx), ja käsin kirjaus ja muokkaus avautuvat koko sivun ikkunaan (MealEditor).
import { useRef, useState } from "react";
import { type Meal, type Photo, stamped } from "../domain/model";
import { type AIDraft } from "../ai/provider";
import { poistaLuonnos } from "../ai/luonnokset";
import { compressPhoto } from "../data/photos";
import { saveLifestyle, saveRecord } from "../data/db";
import { localDay, addDays } from "../domain/dates";
import { dayTotals, goalForDay } from "../domain/nutrition";
import { MealEditor } from "../components/MealEditor";
import { SavedFoodPicker } from "../components/SavedFoodPicker";
import { LifestyleForm, PainonKirjaus } from "../components/DailyForms";
import { MakroMittarit } from "../components/MakroMittarit";
import { IntegrationInbox } from "../components/IntegrationInbox";
import { KuvaLuonnos } from "../components/KuvaLuonnos";
import { KuvaKentta, type KuvaLahde } from "../components/KuvaKentta";
import { Modal } from "../components/common";
import { type NakymaProps } from "../kuori";
import {
  paivanNimi,
  kelloksi,
  aterianOtsikko,
  aterianKcal,
  aterianAlarivi,
  edellinenPaino,
  lomakkeenAvain,
} from "./paiva";
import "../tyylit/tanaan.css";

type Dialog = {
  meal?: Meal;
  initialDraft?: AIDraft;
  initialOrigin?: string;
  inboxId?: string;
  initialPhoto?: Photo;
  initialNote?: string;
} | null;
type Kuva = { photo: Photo; lahde: KuvaLahde } | null;
const pysyva = () => void navigator.storage?.persist?.().catch(() => {});

export default function Tanaan({ data, notify, run }: NakymaProps) {
  const [date, setDate] = useState(localDay()),
    [dialog, setDialog] = useState<Dialog>(null),
    [savedFoodsOpen, setSavedFoodsOpen] = useState(false),
    [kuva, setKuva] = useState<Kuva>(null),
    [avataan, setAvataan] = useState(false),
    [luonnokset, setLuonnokset] = useState(0),
    muokattu = useRef(false);
  const tanaan = localDay(),
    meals = data.meals
      .filter((m) => m.date === date)
      .sort((a, b) => a.time.localeCompare(b.time)),
    weight = data.weights.find((w) => w.date === date),
    lifestyle = data.lifestyles.find((l) => l.date === date),
    status = data.days.find((d) => d.date === date),
    aiempi = edellinenPaino(data.weights, date);
  const avaa = (d: Dialog) => {
    muokattu.current = false;
    setDialog(d);
  };
  const saved = () => {
    if (dialog?.inboxId)
      void poistaLuonnos(dialog.inboxId)
        .then(() => setLuonnokset((n) => n + 1))
        .catch(() =>
          notify("Ateria tallennettu. Ilmarin luonnos jäi odottamaan."),
        );
    setDialog(null);
    notify("Tallennettu.");
    pysyva();
  };
  // Kuva pienennetään heti: sama pieni JPEG näkyy pikkukuvana, lähtee tulkittavaksi ja tallentuu aterian mukana.
  const valitse = (file: File, lahde: KuvaLahde) =>
    void run(async () => {
      setAvataan(true);
      try {
        const blob = await compressPhoto(file);
        setKuva({ photo: { ...stamped(), blob }, lahde });
        window.scrollTo(0, 0);
      } finally {
        setAvataan(false);
      }
    });

  if (kuva)
    return (
      <KuvaLuonnos
        key={kuva.photo.id}
        photo={kuva.photo}
        lahde={kuva.lahde}
        date={date}
        onUusi={(f) => valitse(f, kuva.lahde)}
        onPeru={() => setKuva(null)}
        onTallennettu={(message) => {
          setKuva(null);
          notify(message);
          pysyva();
        }}
        onKasin={(photo, note) => {
          setKuva(null);
          avaa({ initialPhoto: photo, initialNote: note });
        }}
      />
    );

  return (
    <>
      <section className="day" aria-label="Päivä">
        <button
          className="btn--quiet"
          aria-label="Edellinen päivä"
          onClick={() => setDate(addDays(date, -1))}
        >
          ‹
        </button>
        <label className="day-name">
          {paivanNimi(date)}
          <input
            type="date"
            value={date}
            max={tanaan}
            aria-label="Valitse päivä"
            onClick={(e) => e.currentTarget.showPicker?.()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
        <button
          className="btn--quiet"
          aria-label="Seuraava päivä"
          disabled={date >= tanaan}
          onClick={() => setDate(addDays(date, 1))}
        >
          ›
        </button>
      </section>

      <MakroMittarit
        totals={dayTotals(meals)}
        goal={goalForDay(data.goals, date)}
      />

      <section className="capture" aria-label="Lisää ateria">
        <KuvaKentta
          lahde="kamera"
          ensisijainen
          disabled={avataan}
          onValittu={(f) => valitse(f, "kamera")}
        />
        <KuvaKentta
          lahde="galleria"
          disabled={avataan}
          onValittu={(f) => valitse(f, "galleria")}
        />
        <button className="btn" onClick={() => avaa({})}>
          Kirjoita
        </button>
        <button className="btn" onClick={() => setSavedFoodsOpen(true)}>
          Omat ruuat
        </button>
      </section>

      <IntegrationInbox
        data={data}
        paivitys={luonnokset}
        onOpen={(item) =>
          avaa({ initialDraft: item.draft, inboxId: String(item.id) })
        }
      />

      <section aria-label="Ateriat">
        <h2 className="label">
          Ateriat <span className="aside">{meals.length}</span>
        </h2>
        {meals.length ? (
          <div className="meals">
            {meals.map((meal) => (
              <button
                type="button"
                className="meal"
                key={meal.id}
                onClick={() => avaa({ meal })}
              >
                <span className="when">{kelloksi(meal.time)}</span>
                <span>{aterianOtsikko(meal)}</span>
                <span className="kcal">{aterianKcal(meal)}</span>
                <span className="sub">{aterianAlarivi(meal)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty">Ei kirjattuja aterioita.</p>
        )}
      </section>

      <section aria-label="Paino">
        <h2 className="label">
          Paino {aiempi && <span className="aside">{aiempi}</span>}
        </h2>
        <PainonKirjaus
          key={date + (weight?.updatedAt ?? "")}
          date={date}
          weight={weight}
          onSaved={(viesti) => {
            notify(viesti);
            pysyva();
          }}
        />
      </section>

      <label className="inline treeni">
        <input
          type="checkbox"
          checked={lifestyle?.trainingDay ?? false}
          onChange={(e) => {
            const trainingDay = e.target.checked;
            void run(() => saveLifestyle(date, { trainingDay }));
          }}
        />
        Treenipäivä
      </label>

      <details className="fold">
        <summary>Uni, liike ja olo</summary>
        <LifestyleForm
          key={lomakkeenAvain(date, lifestyle)}
          date={date}
          lifestyle={lifestyle}
          onSaved={() => notify("Tallennettu.")}
        />
        <label className="inline valmis">
          <input
            type="checkbox"
            checked={status?.complete ?? false}
            onChange={() =>
              void run(async () => {
                await saveRecord("days", {
                  ...stamped(status),
                  date,
                  complete: !status?.complete,
                });
              })
            }
          />
          Päivän kirjaukset ovat valmiit
        </label>
      </details>

      {savedFoodsOpen && (
        <SavedFoodPicker
          data={data}
          date={date}
          onClose={() => setSavedFoodsOpen(false)}
          onSaved={(message) => {
            setSavedFoodsOpen(false);
            notify(message);
            pysyva();
          }}
        />
      )}

      {dialog && (
        <Modal
          title={
            dialog.meal
              ? "Muokkaa ateriaa"
              : dialog.initialDraft
                ? "Ilmarin luonnos"
                : "Uusi ateria"
          }
          onClose={() => {
            if (
              !muokattu.current ||
              window.confirm(
                "Suljetaanko? Tallentamattomat muutokset häviävät.",
              )
            )
              setDialog(null);
          }}
        >
          <div
            className="ateria-ikkuna"
            onChange={() => (muokattu.current = true)}
          >
            <MealEditor
              data={data}
              date={date}
              meal={dialog.meal}
              initialDraft={dialog.initialDraft}
              initialOrigin={dialog.initialOrigin}
              inboxId={dialog.inboxId}
              initialPhoto={dialog.initialPhoto}
              initialNote={dialog.initialNote}
              onSaved={saved}
              onDone={(viesti) => {
                setDialog(null);
                notify(viesti);
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
