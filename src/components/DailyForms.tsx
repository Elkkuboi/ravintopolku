import { useState } from "react";
import {
  type Weight,
  type Lifestyle,
  stamped,
  numberInput,
} from "../domain/model";
import { tulkitsePaino } from "../domain/paino";
import { saveRecord, findWeight, removeWeight } from "../data/db";
import { Field, Decimal, Form } from "./common";
import { useFormAction } from "./useFormAction";
const PAINO_VIRHE = 'Paino ei ole luku. Kirjoita esimerkiksi "82,4".';
const kentaksi = (kg: number) => String(kg).replace(".", ",");
// Päivän paino yhdellä kentällä. Teksti tulkitaan kuten Ilmarin kirjaukset ("paino 82,4" ja "82,4" ovat sama tieto).
// Saman päivän uusi arvo korvaa vanhan ja säilyttää muistiinpanon; tyhjä kenttä ja Tallenna poistaa mittauksen.
export function PainonKirjaus({
  date,
  weight,
  onSaved,
}: {
  date: string;
  weight?: Weight;
  onSaved: (viesti: string) => void;
}) {
  const alku = weight ? kentaksi(weight.kg) : "";
  const [text, setText] = useState(alku),
    { error, busy, execute, setError } = useFormAction();
  return (
    <form
      className="inline-field"
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          if (!text.trim()) {
            if (weight && window.confirm("Poistetaanko päivän paino?")) {
              await removeWeight(weight.id);
              onSaved("Paino poistettu.");
            }
            return;
          }
          const kg = tulkitsePaino(text);
          if (kg === null) {
            setError(PAINO_VIRHE);
            return;
          }
          const existing = await findWeight(date);
          await saveRecord("weights", {
            ...stamped(existing ?? weight),
            date,
            kg,
            note: existing?.note ?? weight?.note ?? "",
          });
          setText(kentaksi(kg));
          onSaved("Paino tallennettu.");
        });
      }}
    >
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
        }}
        inputMode="decimal"
        autoComplete="off"
        aria-label="Paino kiloina"
      />
      <span>kg</span>
      <button
        className="btn--quiet"
        type="submit"
        disabled={busy || text.trim() === alku}
      >
        Tallenna
      </button>
      {error && (
        <p className="note note--stop" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
// Uni, liike ja olo: kaikki vapaaehtoisia. Lomake on Tänään-sivun taitteen sisällä.
export function LifestyleForm({
  date,
  lifestyle,
  onSaved,
}: {
  date: string;
  lifestyle?: Lifestyle;
  onSaved: () => void;
}) {
  const [steps, setSteps] = useState(String(lifestyle?.steps ?? "")),
    [sleep, setSleep] = useState(
      lifestyle?.sleep === null || lifestyle?.sleep === undefined
        ? ""
        : kentaksi(lifestyle.sleep),
    ),
    [training, setTraining] = useState(lifestyle?.training ?? ""),
    [hunger, setHunger] = useState(String(lifestyle?.hunger ?? "")),
    [energy, setEnergy] = useState(String(lifestyle?.energy ?? ""));
  const { error, busy, execute } = useFormAction();
  const asteikko = (
    label: string,
    value: string,
    change: (s: string) => void,
  ) => (
    <Field label={label}>
      <select value={value} onChange={(e) => change(e.target.value)}>
        <option value="">–</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n}>{n}</option>
        ))}
      </select>
    </Field>
  );
  return (
    <Form
      error={error}
      busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          await saveRecord("lifestyles", {
            ...stamped(lifestyle),
            date,
            steps: numberInput(steps, true),
            sleep: numberInput(sleep, true),
            training,
            hunger: numberInput(hunger, true),
            energy: numberInput(energy, true),
          });
          onSaved();
        });
      }}
    >
      <div className="fields">
        <Field label="Uni (h)">
          <Decimal value={sleep} onChange={setSleep} placeholder="" />
        </Field>
        <Field label="Askeleet">
          <Decimal value={steps} onChange={setSteps} placeholder="" />
        </Field>
        {asteikko("Nälkä (1–5)", hunger, setHunger)}
        {asteikko("Vireys (1–5)", energy, setEnergy)}
      </div>
      <Field label="Liikunta">
        <textarea
          value={training}
          onChange={(e) => setTraining(e.target.value)}
          maxLength={5000}
          rows={2}
        />
      </Field>
    </Form>
  );
}
