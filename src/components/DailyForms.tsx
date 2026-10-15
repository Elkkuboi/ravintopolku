import { useState } from "react";
import {
  type Weight,
  type Lifestyle,
  stamped,
  numberInput,
} from "../domain/model";
import { saveRecord, findWeight, removeWeight } from "../data/db";
import { Field, Decimal, Form } from "./common";
import { useFormAction } from "./useFormAction";
export function WeightForm({
  date,
  weight,
  onSaved,
}: {
  date: string;
  weight?: Weight;
  onSaved: () => void;
}) {
  const [activeWeight, setActiveWeight] = useState(weight);
  const [day, setDay] = useState(weight?.date ?? date),
    [kg, setKg] = useState(String(weight?.kg ?? "")),
    [note, setNote] = useState(weight?.note ?? "");
  const { error, busy, execute } = useFormAction();
  return (
    <Form
      error={error}
      busy={busy}
      submit={weight ? "Tallenna painon muutos" : "Tallenna paino"}
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          const existing = await findWeight(day);
          if (existing && existing.id !== activeWeight?.id) {
            if (
              window.confirm(
                "Tälle päivälle on jo painomittaus. Avataanko se muokattavaksi?",
              )
            ) {
              setActiveWeight(existing);
              setKg(String(existing.kg));
              setNote(existing.note);
            }
            return;
          }
          await saveRecord("weights", {
            ...stamped(existing ?? activeWeight),
            date: day,
            kg: numberInput(kg)!,
            note,
          });
          onSaved();
        });
      }}
    >
      <Field label="Mittauspäivä">
        <input
          type="date"
          required
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </Field>
      <Field label="Paino (kg)">
        <Decimal
          value={kg}
          onChange={setKg}
          required
          placeholder="Esim. 75,4"
        />
      </Field>
      <Field label="Muistiinpano (vapaaehtoinen)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={5000}
        />
      </Field>
      <p className="muted small">
        Yksi mittaus päivässä. Voit muokata sitä myöhemmin.
      </p>
      {weight && (
        <button
          type="button"
          className="danger-link"
          onClick={() =>
            void execute(async () => {
              if (window.confirm("Poistetaanko tämän päivän painomittaus?")) {
                await removeWeight(weight.id);
                onSaved();
              }
            })
          }
        >
          Poista mittaus
        </button>
      )}
    </Form>
  );
}
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
    [sleep, setSleep] = useState(String(lifestyle?.sleep ?? "")),
    [training, setTraining] = useState(lifestyle?.training ?? ""),
    [hunger, setHunger] = useState(String(lifestyle?.hunger ?? "")),
    [energy, setEnergy] = useState(String(lifestyle?.energy ?? ""));
  const { error, busy, execute } = useFormAction();
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
      <p className="muted">
        Kaikki kentät ovat vapaaehtoisia. Liikunta ei muuta
        ravintoainetavoitteita.
      </p>
      <div className="two-cols">
        <Field label="Askeleet">
          <Decimal
            value={steps}
            onChange={setSteps}
            placeholder="Ei kirjattu"
          />
        </Field>
        <Field label="Unen kesto (h)">
          <Decimal value={sleep} onChange={setSleep} placeholder="Esim. 7,5" />
        </Field>
      </div>
      <Field label="Treenin kuvaus">
        <textarea
          value={training}
          onChange={(e) => setTraining(e.target.value)}
          maxLength={5000}
        />
      </Field>
      {[
        ["Nälkä (1 = vähäinen, 5 = voimakas)", hunger, setHunger],
        ["Vireys (1 = matala, 5 = korkea)", energy, setEnergy],
      ].map(([label, value, change]) => (
        <Field key={label as string} label={label as string}>
          <select
            value={value as string}
            onChange={(e) => (change as (s: string) => void)(e.target.value)}
          >
            <option value="">Ei kirjattu</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
      ))}
    </Form>
  );
}
