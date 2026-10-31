import { useState } from "react";
import {
  type Weight,
  type Lifestyle,
  stamped,
  numberInput,
} from "../domain/model";
import { tulkitsePaino } from "../domain/paino";
import { formatNumber } from "../domain/nutrition";
import { saveRecord, findWeight, removeWeight } from "../data/db";
import { Field, Decimal, Form } from "./common";
import { useFormAction } from "./useFormAction";
// Sekä päivän pikakirjaus että tarkistusnäkymä käyttävät samaa tulkintaa:
// "paino 82,4" ja "82,4" ovat sama tieto.
const PAINO_VIRHE =
  'En löydä tekstistä painoa. Kirjoita luku, esimerkiksi "paino 82,4".';
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
    [kgText, setKgText] = useState(String(weight?.kg ?? "")),
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
          const kg = tulkitsePaino(kgText);
          if (kg === null) throw new Error(PAINO_VIRHE);
          const existing = await findWeight(day);
          if (existing && existing.id !== activeWeight?.id) {
            if (
              window.confirm(
                "Tälle päivälle on jo painomittaus. Avataanko se muokattavaksi?",
              )
            ) {
              setActiveWeight(existing);
              setKgText(String(existing.kg));
              setNote(existing.note);
            }
            return;
          }
          await saveRecord("weights", {
            ...stamped(existing ?? activeWeight),
            date: day,
            kg,
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
      <Field
        label="Paino (kg)"
        hint='Voit kirjoittaa numeroin tai sanoin, esimerkiksi "paino 82,4".'
      >
        <input
          value={kgText}
          onChange={(e) => setKgText(e.target.value)}
          required
          placeholder="Esim. 82,4"
          autoComplete="off"
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
        Yksi mittaus päivässä. Paino on aina vapaaehtoinen ja voit muokata sitä
        myöhemmin.
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
// Päivän sivun pikakirjaus: yksi kenttä, vapaa teksti ja Enter. Tyhjää ei
// tallenneta, joten painoa ei kysytä pakolla. Saman päivän uusi arvo korvaa
// vanhan, kuten tarkistusnäkymässä.
export function PainonKirjaus({
  date,
  weight,
  demo = false,
  onSaved,
}: {
  date: string;
  weight?: Weight;
  demo?: boolean;
  onSaved: (viesti: string) => void;
}) {
  const [text, setText] = useState(""),
    { error, busy, execute, setError } = useFormAction();
  return (
    <form
      className="quick-paino"
      hidden={demo}
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
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
          setText("");
          onSaved(`Päivän paino ${formatNumber(kg)} kg kirjattu.`);
        });
      }}
    >
      <Field label="Paino" hint='Valinnainen, esimerkiksi "paino 82,4".'>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          placeholder="paino 82,4"
          autoComplete="off"
        />
      </Field>
      <button
        className="secondary"
        type="submit"
        disabled={busy || !text.trim()}
      >
        Tallenna
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
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
