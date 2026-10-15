import { useState } from "react";
import { Plus, Trash2, Camera, Copy } from "lucide-react";
import {
  type Dataset,
  type Meal,
  type MealLine,
  type Photo,
  stamped,
  id,
  emptyNutrients,
  TIMEZONE,
  numberInput,
} from "../domain/model";
import { defaultMealTime, saveMeal } from "../data/db";
import { localDay, wallTimestamp } from "../domain/dates";
import {
  mealSnapshot,
  formatNumber,
  aggregate,
  lineNutrients,
} from "../domain/nutrition";
import { compressPhoto } from "../data/photos";
import { AIPanel } from "./AIPanel";
import { draftOrigin, draftNotes } from "../ai/draft-fields";
import { parseDraft, aiPrompt, type AIDraft } from "../ai/provider";
import { Field, Decimal, Form, NutrientFields, BlobImage } from "./common";
import {
  nutrientStrings,
  parseNutrients,
  type NutrientStrings,
} from "./form-values";
import { useFormAction } from "./useFormAction";
interface EditableLine {
  line: MealLine;
  grams: string;
  values: NutrientStrings;
}
const editLine = (line: MealLine): EditableLine => ({
  line,
  grams: line.grams === null ? "" : String(line.grams).replace(".", ","),
  values: nutrientStrings(line.values),
});
const freshLine = (mode: "per100" | "portion"): MealLine => ({
  id: id(),
  name: "",
  foodId: null,
  mode,
  grams: mode === "per100" ? 100 : null,
  values: emptyNutrients(),
  source: "Oma arvio",
  state: "",
});
export function MealEditor({
  data,
  date,
  meal,
  onSaved,
  onNewFood,
  initialDraft,
  inboxId,
}: {
  data: Dataset;
  date: string;
  meal?: Meal;
  onSaved: () => void;
  onNewFood: () => void;
  initialDraft?: AIDraft;
  inboxId?: string;
}) {
  const [mealDate, setMealDate] = useState(meal?.date ?? date),
    [time, setTime] = useState(meal?.time ?? defaultMealTime(date)),
    [type, setType] = useState<Meal["type"]>(meal?.type ?? "Lounas"),
    [note, setNote] = useState(meal?.note ?? ""),
    [origin, setOrigin] = useState(
      initialDraft
        ? draftOrigin(initialDraft, "ilmari")
        : (meal?.origin ?? "Käsin kirjattu"),
    ),
    [assumptions, setAssumptions] = useState(
      initialDraft
        ? draftNotes(initialDraft, inboxId)
        : (meal?.assumptions ?? []),
    ),
    [lines, setLines] = useState<EditableLine[]>(
      initialDraft
        ? initialDraft.lines.map((l) =>
            editLine({ ...l, id: id(), foodId: null }),
          )
        : (meal?.lines.map(editLine) ?? []),
    ),
    [search, setSearch] = useState(""),
    [photo, setPhoto] = useState<Photo | null>(
      data.photos.find((p) => p.id === meal?.photoId) ?? null,
    ),
    [removedPhoto, setRemovedPhoto] = useState(false),
    [json, setJson] = useState(""),
    [showAI, setShowAI] = useState(false),
    [draft, setDraft] = useState<AIDraft | null>(initialDraft ?? null),
    [info, setInfo] = useState("");
  const { error, busy, execute, setError } = useFormAction();
  const update = (index: number, change: Partial<EditableLine>) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, ...change } : l)));
  const updateMeta = (index: number, change: Partial<MealLine>) =>
    update(index, { line: { ...lines[index].line, ...change } });
  const applyDraft = (d: AIDraft, kind: "manual" | "api" = "manual") => {
    if (
      lines.length &&
      !window.confirm("Korvataanko nykyisen luonnoksen ruuat AI-luonnoksella?")
    )
      return;
    setDraft(d);
    setLines(d.lines.map((l) => editLine({ ...l, id: id(), foodId: null })));
    setOrigin(draftOrigin(d, kind));
    setAssumptions(draftNotes(d, inboxId));
    setShowAI(false);
    setInfo(
      "Luonnos avattu. Tarkista nimet, määrät, arvot ja oletukset ennen tallennusta.",
    );
  };
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
    /* Invalid input is displayed only on submission. */
  }
  return (
    <Form
      error={error}
      busy={busy}
      submit={meal ? "Tallenna muutokset" : "Hyväksy ja tallenna ateria"}
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          const parsed = lines.map((l) => ({
            ...l.line,
            name: l.line.name.trim(),
            grams:
              l.line.mode === "per100"
                ? numberInput(l.grams)
                : numberInput(l.grams, true),
            values: parseNutrients(l.values),
          }));
          if (parsed.length === 0)
            throw new Error("Lisää vähintään yksi ruoka tai annos.");
          if (
            parsed.some(
              (l) =>
                (l.grams ?? 0) > 5000 ||
                Object.values(l.values).some((v) => v !== null && v > 3000),
            ) &&
            !window.confirm(
              "Kirjauksessa on poikkeuksellisen suuri määrä tai ravintoarvo. Oletko tarkistanut luvut ja yksiköt?",
            )
          )
            return;
          await saveMeal(
            {
              ...stamped(meal),
              date: mealDate,
              time,
              timestamp: wallTimestamp(mealDate, time),
              timezone: TIMEZONE,
              type,
              lines: parsed,
              snapshot: mealSnapshot(parsed),
              note,
              origin,
              assumptions,
              photoId: photo?.id ?? null,
            },
            photo,
            removedPhoto,
          );
          onSaved();
        });
      }}
    >
      <div className="two-cols">
        <Field label="Päivämäärä">
          <input
            type="date"
            required
            value={mealDate}
            onChange={(e) => setMealDate(e.target.value)}
          />
        </Field>
        <Field label="Kellonaika">
          <input
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Ateriatyyppi">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as Meal["type"])}
        >
          {[
            "Aamiainen",
            "Lounas",
            "Päivällinen",
            "Välipala",
            "Iltapala",
            "Muu",
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      {data.templates.length > 0 && (
        <Field label="Käytä vakioateriaa">
          <select
            value=""
            onChange={(e) => {
              const t = data.templates.find((t) => t.id === e.target.value);
              if (t) {
                setLines(t.lines.map((l) => editLine({ ...l, id: id() })));
                setType(t.type);
                setOrigin("Vakioateria: " + t.name);
                setAssumptions([]);
                setDraft(null);
              }
            }}
          >
            <option value="">Valitse vakioateria (korvaa ruuat)</option>
            {data.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <h3>Aterian ruuat</h3>
      <Field label="Hae omista ruuista">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ruuan nimi tai valmistustila"
        />
      </Field>
      <div className="food-choices">
        {data.foods
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
          .slice(0, 20)
          .map((f) => (
            <button
              type="button"
              className="food-chip"
              key={f.id}
              onClick={() =>
                setLines([
                  ...lines,
                  editLine({
                    id: id(),
                    name: f.name,
                    foodId: f.id,
                    mode: "per100",
                    grams: 100,
                    values: { ...f.per100 },
                    source: f.source,
                    state: f.state,
                  }),
                ])
              }
            >
              {f.favorite ? "★ " : ""}
              {f.name}
              {f.state ? " · " + f.state : ""}
              <Plus size={14} />
            </button>
          ))}
      </div>
      <div className="button-row">
        <button type="button" className="secondary" onClick={onNewFood}>
          <Plus size={16} /> Luo oma ruoka
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setLines([...lines, editLine(freshLine("portion"))])}
        >
          <Plus size={16} /> Annoksen kokonaisarvot
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => setLines([...lines, editLine(freshLine("per100"))])}
        >
          Kirjaa per 100 g käsin
        </button>
      </div>
      {lines.length === 0 && (
        <p className="empty-inline">
          Valitse ruoka kirjastosta tai syötä annoksen arvot.
        </p>
      )}
      {lines.map((item, index) => (
        <section className="line-editor" key={item.line.id}>
          <div className="section-heading">
            <h4>
              {index + 1}.{" "}
              {item.line.mode === "per100"
                ? "Ruoka · per 100 g"
                : "Annos · kokonaisarvot"}
            </h4>
            <button
              type="button"
              className="icon-button"
              onClick={() => setLines(lines.filter((_, i) => i !== index))}
              aria-label={`Poista ruoka ${index + 1}`}
            >
              <Trash2 size={18} />
            </button>
          </div>
          <Field label="Ruuan tai annoksen nimi">
            <input
              required
              value={item.line.name}
              onChange={(e) => updateMeta(index, { name: e.target.value })}
              maxLength={200}
            />
          </Field>
          <div className="two-cols">
            <Field
              label={
                item.line.mode === "per100"
                  ? "Syöty määrä (g)"
                  : "Määrä (g, vapaaehtoinen)"
              }
            >
              <Decimal
                value={item.grams}
                onChange={(grams) => update(index, { grams })}
                required={item.line.mode === "per100"}
              />
            </Field>
            <Field label="Valmistustila">
              <input
                value={item.line.state}
                onChange={(e) => updateMeta(index, { state: e.target.value })}
                placeholder="Kuiva / kypsä"
                maxLength={100}
              />
            </Field>
          </div>
          <p className="small accent">
            {item.line.mode === "per100"
              ? "Anna ravintoarvot per 100 g. Sovellus kertoo ne syödyllä määrällä."
              : "Anna tämän syödyn annoksen ravintoarvot yhteensä. Grammoja ei käytetä näiden kertomiseen."}
          </p>
          <NutrientFields
            value={item.values}
            onChange={(values) => update(index, { values })}
          />
          <Field label="Ravintoarvojen lähde">
            <input
              required
              value={item.line.source}
              onChange={(e) => updateMeta(index, { source: e.target.value })}
              maxLength={500}
            />
          </Field>
        </section>
      ))}
      {preview && lines.length > 0 && (
        <div className="notice">
          Kirjattu energia:{" "}
          <strong>{formatNumber(preview.energy.value, 0)} kcal</strong>
          {preview.energy.partial ? " · osittainen tieto" : ""}
        </div>
      )}
      <h3>Kuva ja muistiinpanot</h3>
      <div className="two-cols">
        <label className="photo-picker">
          <Camera size={21} />
          <span>Ota kuva</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void execute(async () => {
                  const blob = await compressPhoto(file);
                  setPhoto({ ...stamped(), blob });
                  setRemovedPhoto(true);
                });
              e.target.value = "";
            }}
          />
        </label>
        <label className="photo-picker">
          <Camera size={21} />
          <span>Valitse kuva</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"

            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void execute(async () => {
                  const blob = await compressPhoto(file);
                  setPhoto({ ...stamped(), blob });
                  setRemovedPhoto(true);
                });
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <small className="muted">
        Kuva jää laitteelle, ellet itse pyydä sen lähettämistä AI-analyysiin.
      </small>
      {photo && (
        <div className="photo-preview">
          <BlobImage blob={photo.blob} alt="Aterian kuva" />
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setPhoto(null);
              setRemovedPhoto(true);
            }}
          >
            Poista kuva
          </button>
        </div>
      )}
      <Field label="Muistiinpano (vapaaehtoinen)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={5000}
        />
      </Field>
      <p className="small muted">Alkuperä: {origin}</p>
      {assumptions.length > 0 && (
        <details open>
          <summary>Oletukset ja puuttuvat tiedot</summary>
          <ul>
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      {draft && (
        <p className="notice">
          Tämä on ulkoisesta tekoälystä tuotu arvio. Tarkista jokainen määrä ja
          ravintoarvo.
        </p>
      )}
      <AIPanel
        photo={photo?.blob ?? null}
        onDraft={(d) => applyDraft(d, "api")}
      />
      <details open={showAI} onToggle={(e) => setShowAI(e.currentTarget.open)}>
        <summary>Käsin käytettävä AI-tuonti</summary>
        <p className="small muted">
          Voit itse viedä kuvan ja ohjeen haluamaasi tekoälypalveluun. Liitä
          vastaus tähän. Sovellus ei lähetä kuvaa.
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void execute(async () => {
              const prompt = aiPrompt();
              try {
                await navigator.clipboard.writeText(prompt);
                setInfo("Ohje ja JSON-skeema kopioitu.");
              } catch {
                downloadPrompt(prompt);
                setInfo(
                  "Leikepöytä ei ole käytettävissä. Ohje ladattiin tekstitiedostona.",
                );
              }
            })
          }
        >
          <Copy size={16} /> Kopioi ohje tekoälylle
        </button>
        <Field label="AI:n JSON-vastaus">
          <textarea
            className="json-input"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            maxLength={100000}
            placeholder='{"schemaVersion": 1, ...}'
          />
        </Field>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setError("");
            try {
              const d = parseDraft(json);

              applyDraft(d);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Tuonti epäonnistui.");
            }
          }}
        >
          Tarkista ja avaa luonnos
        </button>
      </details>
      {info && (
        <p className="notice" role="status">
          {info}
        </p>
      )}
    </Form>
  );
}
function downloadPrompt(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `ravintopolku-ai-ohje-${localDay()}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
