// Käsin kirjaus ja aterian muokkaus. Näkyvissä vain päivä, kello, ateria, rivit, summa ja muistiinpano (kuvasta
// tulkitulla aterialla "Nimi"); omat ruuat, rivin lähde ja valmistustila, kuva, alkuperä ja oletukset ovat taitteissa.
// Piilotetut kentät kulkevat muokkauksen läpi muuttumattomina (rivin source ja state, aterian origin ja assumptions);
// photoId muuttuu vain "Poista kuva" -napista, myös kun kuva on toisella laitteella (tallennettavaKuva).
import { useState } from "react";
import {
  type Dataset,
  type Meal,
  type MealLine,
  type Photo,
  id,
  numberInput,
} from "../domain/model";
import { defaultMealTime, saveMeal, deleteMeal } from "../data/db";
import { localDay } from "../domain/dates";
import { formatNumber, aggregate, lineNutrients } from "../domain/nutrition";
import { draftOrigin, draftNotes } from "../ai/draft-fields";
import { ateriatyyppi } from "../ai/kuva-ateria";
import { type AIDraft } from "../ai/provider";
import { tulkitseKuvaus } from "../ai/ateria-kuvaus";
import { aterianKopio, mealTitleFromNote } from "../nakymat/paiva";
import { Field, Decimal, Form, NutrientFields, BlobImage } from "./common";
import { parseNutrients } from "./form-values";
import {
  type EditableLine,
  editLine,
  freshLine,
  foodLine,
  parseLines,
  epatavallinen,
  rakennaAteria,
  tallennettavaKuva,
} from "./ateriamuokkaus";
import { useFormAction } from "./useFormAction";
const TYYPIT: Meal["type"][] = [
  "Aamiainen",
  "Lounas",
  "Päivällinen",
  "Välipala",
  "Iltapala",
  "Muu",
];
export function MealEditor({
  data,
  date,
  meal,
  onSaved,
  onDone,
  initialDraft,
  initialOrigin,
  inboxId,
  initialPhoto,
  initialNote,
}: {
  data: Dataset;
  date: string;
  meal?: Meal;
  onSaved: () => void;
  /** Kopiointi tai poisto valmis: ikkuna suljetaan ja viesti näytetään. */
  onDone: (viesti: string) => void;
  initialDraft?: AIDraft;
  /** Alkuperän etuliite luonnokselle, esim. "Kuvauksesta"; oletus on ILMARI. */
  initialOrigin?: string;
  inboxId?: string;
  /** Kuva, jonka tulkinta epäonnistui: ateria kirjataan käsin ja kuva liitetään siihen. */
  initialPhoto?: Photo;
  initialNote?: string;
}) {
  const [mealDate, setMealDate] = useState(meal?.date ?? date),
    [time, setTime] = useState(meal?.time ?? defaultMealTime(date)),
    [type, setType] = useState<Meal["type"]>(
      meal?.type ?? ateriatyyppi(defaultMealTime(date)),
    ),
    [note, setNote] = useState(meal?.note ?? initialNote ?? ""),
    [lines, setLines] = useState<EditableLine[]>(
      initialDraft
        ? initialDraft.lines.map((l) =>
            editLine({ ...l, id: id(), foodId: null }),
          )
        : (meal?.lines.map(editLine) ?? [editLine(freshLine("portion"))]),
    ),
    [search, setSearch] = useState(""),
    savedPhoto = data.photos.find((p) => p.id === meal?.photoId),
    [photo, setPhoto] = useState<Photo | null>(
      savedPhoto ?? initialPhoto ?? null,
    ),
    [removedPhoto, setRemovedPhoto] = useState(false),
    [kuvaus, setKuvaus] = useState(""),
    [tulostettava, setTulostettava] = useState<AIDraft | null>(null),
    [tulkitseminen, setTulkitseminen] = useState(false),
    [tulitusVirhe, setTulitusVirhe] = useState("");
  const origin = initialDraft
    ? (initialOrigin
        ? `${initialOrigin} ${draftOrigin(initialDraft, "ilmari")}`
        : draftOrigin(initialDraft, "ilmari"))
    : tulostettava
      ? "Kuvauksesta " + draftOrigin(tulostettava, "ilmari")
      : (meal?.origin ?? "Käsin kirjattu"),
    assumptions = initialDraft
      ? draftNotes(initialDraft, inboxId)
      : tulostettava
        ? draftNotes(tulostettava)
        : (meal?.assumptions ?? []);
  const { error, busy, execute } = useFormAction();
  const tulkitse = () =>
    void (
      async () => {
        setTulkitseminen(true);
        setTulitusVirhe("");
        try {
          const tulos = await tulkitseKuvaus(kuvaus);
          setTulostettava(tulos.draft);
          setLines(
            tulos.draft.lines.map((l) => editLine({ ...l, id: id(), foodId: null })),
          );
          setNote(tulos.draft.name || kuvaus.trim());
          setKuvaus("");
        } catch (e) {
          setTulitusVirhe(e instanceof Error ? e.message : "Tulkinta epäonnistui.");
        } finally {
          setTulkitseminen(false);
        }
      }
    )();
  const update = (index: number, change: Partial<EditableLine>) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, ...change } : l)));
  const updateMeta = (index: number, change: Partial<MealLine>) =>
    update(index, { line: { ...lines[index].line, ...change } });
  let preview = null;
  try {
    preview = aggregate(
      lines.map((l) =>
        lineNutrients({
          ...l.line,
          grams: numberInput(l.grams, true),
          values: parseNutrients(l.values),
        }),
      ),
    );
  } catch {
    /* Virheellinen luku näytetään vasta tallennettaessa. */
  }
  const ruuat = data.foods
    .filter((f) =>
      (f.name + " " + f.state)
        .toLocaleLowerCase("fi")
        .includes(search.toLocaleLowerCase("fi")),
    )
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        a.name.localeCompare(b.name, "fi"),
    )
    .slice(0, 20);
  return (
    <>
      <Form
        error={error}
        busy={busy}
        submit="Tallenna"
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            const parsed = parseLines(lines);
            if (
              epatavallinen(parsed) &&
              !window.confirm(
                "Kirjauksessa on poikkeuksellisen suuri määrä tai ravintoarvo. Ovatko luvut ja yksiköt oikein?",
              )
            )
              return;
            await saveMeal(
              rakennaAteria(
                meal,
                {
                  date: mealDate,
                  time,
                  type,
                  note,
                  origin,
                  assumptions,
                  photoId: tallennettavaKuva(meal, photo, removedPhoto),
                },
                parsed,
              ),
              photo,
              removedPhoto,
            );
            onSaved();
          });
        }}
      >
        <div className="fields">
          <Field label="Päivä">
            <input
              type="date"
              required
              value={mealDate}
              onChange={(e) => setMealDate(e.target.value)}
            />
          </Field>
          <Field label="Kello">
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Ateria">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Meal["type"])}
            >
              {TYYPIT.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>
        {lines.length === 0 && <p className="empty">Ei rivejä.</p>}
        {lines.map((item, index) => (
          <section className="rivi" key={item.line.id}>
            <div className="rivi-paa">
              <Field
                label={`${index + 1}. ${item.line.mode === "per100" ? "Ruoka, arvot per 100 g" : "Annos, arvot yhteensä"}`}
              >
                <input
                  required
                  value={item.line.name}
                  onChange={(e) => updateMeta(index, { name: e.target.value })}
                  maxLength={200}
                />
              </Field>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
                aria-label={`Poista rivi ${index + 1}`}
              >
                Poista
              </button>
            </div>
            <div className="fields">
              <Field label="Määrä (g)">
                <Decimal
                  value={item.grams}
                  onChange={(grams) => update(index, { grams })}
                  required={item.line.mode === "per100"}
                  placeholder=""
                />
              </Field>
            </div>
            <NutrientFields
              value={item.values}
              onChange={(values) => update(index, { values })}
            />
            <details className="fold">
              <summary>Lähde ja valmistustila</summary>
              <div className="fields">
                <Field label="Lähde">
                  <input
                    value={item.line.source}
                    onChange={(e) =>
                      updateMeta(index, { source: e.target.value })
                    }
                    maxLength={500}
                  />
                </Field>
                <Field label="Valmistustila">
                  <input
                    value={item.line.state}
                    onChange={(e) =>
                      updateMeta(index, { state: e.target.value })
                    }
                    placeholder="kuiva / kypsä"
                    maxLength={100}
                  />
                </Field>
              </div>
            </details>
          </section>
        ))}
        <div className="actions">
          <button
            type="button"
            className="btn--quiet"
            onClick={() => setLines([...lines, editLine(freshLine("portion"))])}
          >
            + rivi
          </button>
          <button
            type="button"
            className="btn--quiet"
            onClick={() => setLines([...lines, editLine(freshLine("per100"))])}
          >
            + rivi per 100 g
          </button>
        </div>
        {!meal && (
          <>
            <Field label="Tai kirjoita ateria, ja Ilmari täydentää luvut">
              <input
                value={kuvaus}
                onChange={(e) => setKuvaus(e.target.value)}
                placeholder="esim. banaani"
                maxLength={500}
                aria-label="Aterian kuvaus"
              />
            </Field>
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={tulkitseminen || !kuvaus.trim()}
                onClick={tulkitse}
              >
                {tulkitseminen ? "Tulkitsee…" : "Tulkitse"}
              </button>
            </div>
          </>
        )}
        {tulitusVirhe && (
          <p className="note note--stop" role="alert">
            {tulitusVirhe}
          </p>
        )}
        {data.foods.length > 0 && (
          <details className="fold">
            <summary>Omat ruuat</summary>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Hae"
              aria-label="Hae omista ruuista"
            />
            <div className="actions ruuat">
              {ruuat.map((f) => (
                <button
                  type="button"
                  className="btn--quiet"
                  key={f.id}
                  onClick={() =>
                    setLines([...lines, editLine(foodLine(f))])
                  }
                >
                  {f.name}
                  {f.state ? " · " + f.state : ""}
                </button>
              ))}
            </div>
          </details>
        )}
        {preview && lines.length > 0 && (
          <div className="sum">
            <span>Yhteensä</span>
            <span>
              {preview.energy.partial && preview.energy.value !== null
                ? "≥"
                : ""}
              {formatNumber(preview.energy.value, 0)} kcal · P{" "}
              {formatNumber(preview.protein.value, 0)} · H{" "}
              {formatNumber(preview.carbs.value, 0)} · R{" "}
              {formatNumber(preview.fat.value, 0)}
            </span>
          </div>
        )}
        <Field
          label={
            mealTitleFromNote(origin) || tulostettava !== null
              ? "Nimi"
              : "Muistiinpano"
          }
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={5000}
            rows={2}
          />
        </Field>
        {(meal || photo || initialDraft || tulostettava) && (
          <details className="fold">
            <summary>Kuva ja alkuperä</summary>
            {photo && (
              <div className="actions">
                <BlobImage
                  blob={photo.blob}
                  alt="Aterian kuva"
                  className="thumb"
                />
                <button
                  type="button"
                  className="btn--quiet"
                  onClick={() => {
                    setPhoto(null);
                    setRemovedPhoto(true);
                  }}
                >
                  Poista kuva
                </button>
              </div>
            )}
            <p className="small muted">Alkuperä: {origin}</p>
            {assumptions.length > 0 && (
              <ul className="oletukset small">
                {assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
          </details>
        )}
      </Form>
      {meal && (
        <AterianHallinta meal={meal} photo={savedPhoto} onDone={onDone} />
      )}
    </>
  );
}
// Kopiointi ja poisto muokkauksen sisällä, ei ateriarivillä. Kopio tallentaa aterian sellaisena kuin se on tallennettu.
function AterianHallinta({
  meal,
  photo,
  onDone,
}: {
  meal: Meal;
  photo: Photo | undefined;
  onDone: (viesti: string) => void;
}) {
  const [kohde, setKohde] = useState(localDay()),
    { error, busy, execute } = useFormAction();
  return (
    <details className="fold hallinta">
      <summary>Kopioi tai poista</summary>
      <div className="inline-field">
        <input
          type="date"
          value={kohde}
          onChange={(e) => setKohde(e.target.value)}
          aria-label="Kopioi päivälle"
        />
        <button
          type="button"
          className="btn--quiet"
          disabled={busy || !kohde}
          onClick={() =>
            void execute(async () => {
              const kopio = aterianKopio(meal, kohde, photo);
              await saveMeal(kopio.meal, kopio.photo);
              onDone("Ateria kopioitu.");
            })
          }
        >
          Kopioi
        </button>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn btn--stop"
          disabled={busy}
          onClick={() =>
            void execute(async () => {
              if (!window.confirm("Poistetaanko ateria ja sen kuva?")) return;
              await deleteMeal(meal);
              onDone("Ateria poistettu.");
            })
          }
        >
          Poista ateria
        </button>
      </div>
      {error && (
        <p className="note note--stop" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
