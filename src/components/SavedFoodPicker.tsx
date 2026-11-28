import { useState } from "react";
import {
  type Dataset,
  type Food,
  type Meal,
  type MealLine,
  id,
  numberInput,
} from "../domain/model";
import { aggregate, formatNumber, lineNutrients } from "../domain/nutrition";
import { defaultMealTime, saveMeal } from "../data/db";
import { ateriatyyppi } from "../ai/kuva-ateria";
import { SAVED_FOOD_ORIGIN } from "../nakymat/paiva";
import { foodLine, rakennaAteria } from "./ateriamuokkaus";
import { Decimal, Field, Form, Modal } from "./common";
import { useFormAction } from "./useFormAction";

function servingEnergy(lines: MealLine[]): string {
  const energy = aggregate(lines.map(lineNutrients)).energy;
  const prefix = energy.partial && energy.value !== null ? "≥" : "";
  return `${prefix}${formatNumber(energy.value, 0)} kcal / annos`;
}

export function SavedFoodPicker({
  data,
  date,
  onClose,
  onSaved,
}: {
  data: Pick<Dataset, "foods" | "templates">;
  date: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Food | null>(null);
  const [grams, setGrams] = useState("100");
  const { error, busy, execute, setError } = useFormAction();
  const query = search.trim().toLocaleLowerCase("fi");
  const matches = (name: string) =>
    name.toLocaleLowerCase("fi").includes(query);
  const templates = data.templates
    .filter((template) => matches(template.name))
    .sort((a, b) => a.name.localeCompare(b.name, "fi"));
  const foods = data.foods
    .filter((food) => matches(`${food.name} ${food.state}`))
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        a.name.localeCompare(b.name, "fi"),
    );

  const record = async (
    name: string,
    lines: MealLine[],
    type?: Meal["type"],
  ) => {
    const time = defaultMealTime(date);
    const meal = rakennaAteria(
      undefined,
      {
        date,
        time,
        type: type ?? ateriatyyppi(time),
        note: name,
        origin: SAVED_FOOD_ORIGIN,
        assumptions: [],
        photoId: null,
      },
      lines,
    );
    await saveMeal(meal, null);
    onSaved(`${name} kirjattu.`);
  };

  return (
    <Modal
      title="Kirjaa omista ruuista"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {selected ? (
        <div className="stack">
          <p>{selected.name}</p>
          <Form
            error={error}
            busy={busy}
            submit="Kirjaa"
            onSubmit={(event) => {
              event.preventDefault();
              void execute(async () => {
                const amount = numberInput(grams);
                if (!amount) throw new Error("Anna määrä grammoina.");
                await record(selected.name, [foodLine(selected, amount)]);
              });
            }}
          >
            <Field label="Määrä (g)">
              <Decimal value={grams} onChange={setGrams} required autoFocus />
            </Field>
          </Form>
          <button
            type="button"
            className="btn--quiet"
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setError("");
            }}
          >
            Takaisin ruokiin
          </button>
        </div>
      ) : data.templates.length || data.foods.length ? (
        <div className="stack">
          <input
            type="search"
            aria-label="Hae omista ruuista"
            placeholder="Hae"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="meals">
            {templates.map((template) => (
              <button
                type="button"
                className="meal saved-food"
                key={template.id}
                aria-label={`Kirjaa ${template.name}`}
                disabled={busy}
                onClick={() =>
                  void execute(() =>
                    record(
                      template.name,
                      template.lines.map((line) => ({ ...line, id: id() })),
                      template.type,
                    ),
                  )
                }
              >
                <span>{template.name}</span>
                <span className="sub">{servingEnergy(template.lines)}</span>
                <span className="saved-food-action">Kirjaa</span>
              </button>
            ))}
            {foods.map((food) => (
              <button
                type="button"
                className="meal saved-food"
                key={food.id}
                aria-label={`Valitse määrä, ${food.name}${food.state ? ` · ${food.state}` : ""}`}
                disabled={busy}
                onClick={() => {
                  setSelected(food);
                  setGrams("100");
                  setError("");
                }}
              >
                <span>{food.name}</span>
                <span className="sub">
                  {formatNumber(food.per100.energy, 0)} kcal / 100 g
                  {food.state ? ` · ${food.state}` : ""}
                </span>
                <span className="saved-food-action">Valitse määrä</span>
              </button>
            ))}
          </div>
          {!templates.length && !foods.length && (
            <p className="empty">Ei osumia.</p>
          )}
          {error && (
            <p className="note note--stop" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="empty">
          Tallenna kuvatulkinnan tulos omiin ruokiin, niin voit kirjata annoksen
          uudelleen tästä.
        </p>
      )}
    </Modal>
  );
}
