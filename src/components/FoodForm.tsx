import { useState } from "react";
import { type Food, stamped, foodSchema } from "../domain/model";
import { saveRecord } from "../data/db";
import { Field, Form, NutrientFields } from "./common";
import {
  blankNutrientStrings,
  nutrientStrings,
  parseNutrients,
} from "./form-values";
import { useFormAction } from "./useFormAction";
export function FoodForm({
  food,
  onSaved,
}: {
  food?: Food;
  onSaved: (food: Food) => void;
}) {
  const [name, setName] = useState(food?.name ?? ""),
    [state, setState] = useState(food?.state ?? ""),
    [source, setSource] = useState(food?.source ?? "Pakkaus"),
    [favorite, setFavorite] = useState(food?.favorite ?? false),
    [values, setValues] = useState(
      food ? nutrientStrings(food.per100) : blankNutrientStrings(),
    );
  const { error, busy, execute } = useFormAction();
  return (
    <Form
      error={error}
      busy={busy}
      submit="Tallenna ruoka"
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          const record = foodSchema.parse({
            ...stamped(food),
            name: name.trim(),
            state,
            source,
            per100: parseNutrients(values),
            favorite,
          });
          await saveRecord("foods", record);
          onSaved(record);
        });
      }}
    >
      <Field label="Ruuan nimi">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
      </Field>
      <Field label="Valmistustila">
        <input
          value={state}
          onChange={(e) => setState(e.target.value)}
          placeholder="Esim. kuiva tai kypsä"
          maxLength={100}
        />
      </Field>
      <Field label="Tietojen lähde">
        <input
          required
          value={source}
          onChange={(e) => setSource(e.target.value)}
          maxLength={500}
        />
      </Field>
      <h3 className="label ruoka-arvot">
        Arvot per 100 g <span className="aside">tyhjä = ei tiedossa</span>
      </h3>
      <NutrientFields value={values} onChange={setValues} />
      <label className="inline suosikki">
        <input
          type="checkbox"
          checked={favorite}
          onChange={(e) => setFavorite(e.target.checked)}
        />
        Suosikki
      </label>
    </Form>
  );
}
