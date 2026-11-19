// Profiili Asetusten Tavoitteet-osion taitteessa. Pituus, lähtöpaino, ikä ja liikunta auttavat tavoite-ehdotusta;
// lähtöpaino ja -päivä piirtävät painon tavoitesuoran. Kentät, joita lomake ei näytä (nimi, mieltymykset,
// lähtöpäivä), kulkevat tallennuksessa muuttumattomina.
import { useState } from "react";
import { Field, Decimal } from "./common";
import { useFormAction } from "./useFormAction";
import {
  type Profile,
  stamped,
  numberInput,
  profileSchema,
} from "../domain/model";
import { localDay } from "../domain/dates";
import { saveRecord } from "../data/db";

const teksti = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : String(n).replace(".", ",");

export function ProfileForm({
  profile,
  onSaved,
}: {
  profile?: Profile;
  onSaved: () => void;
}) {
  const [height, setHeight] = useState(teksti(profile?.height)),
    [weight, setWeight] = useState(teksti(profile?.startWeight)),
    [age, setAge] = useState(teksti(profile?.age)),
    [training, setTraining] = useState(teksti(profile?.training)),
    [activity, setActivity] = useState(profile?.activity ?? "");
  const { error, busy, execute } = useFormAction();
  return (
    <form
      className="lomake"
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          await saveRecord(
            "profiles",
            profileSchema.parse({
              ...stamped(profile),
              name: profile?.name ?? "",
              height: numberInput(height),
              startWeight: numberInput(weight),
              startDate: profile?.startDate ?? localDay(),
              age: numberInput(age, true),
              activity: activity.trim(),
              training: numberInput(training, true) ?? 0,
              preferences: profile?.preferences ?? "",
            }),
          );
          onSaved();
        });
      }}
    >
      <div className="fields">
        <Field label="Pituus cm">
          <Decimal
            value={height}
            onChange={setHeight}
            required
            placeholder=""
          />
        </Field>
        <Field label="Lähtöpaino kg">
          <Decimal
            value={weight}
            onChange={setWeight}
            required
            placeholder=""
          />
        </Field>
        <Field label="Ikä">
          <Decimal value={age} onChange={setAge} placeholder="" />
        </Field>
        <Field label="Treenejä viikossa">
          <Decimal value={training} onChange={setTraining} placeholder="" />
        </Field>
      </div>
      <Field label="Arkiliikunta">
        <input
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
          placeholder="esim. kävelen työmatkat"
          maxLength={5000}
        />
      </Field>
      {error && (
        <p className="note note--stop" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="btn" type="submit" disabled={busy}>
          Tallenna profiili
        </button>
      </div>
    </form>
  );
}
