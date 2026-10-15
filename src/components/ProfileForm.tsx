import { useState } from "react";
import { Field, Decimal, Form, NutrientFields } from "./common";
import {
  blankNutrientStrings,
  nutrientStrings,
  parseNutrients,
} from "./form-values";
import { useFormAction } from "./useFormAction";
import {
  type Profile,
  type Goal,
  stamped,
  numberInput,
  profileSchema,
  goalSchema,
} from "../domain/model";
import { localDay } from "../domain/dates";
import { weeklyChange } from "../domain/analytics";
import { formatNumber } from "../domain/nutrition";
import { saveProfileGoal } from "../data/db";
export function ProfileForm({
  profile,
  goal,
  onSaved,
}: {
  profile?: Profile;
  goal?: Goal;
  onSaved: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? ""),
    [height, setHeight] = useState(String(profile?.height ?? "")),
    [weight, setWeight] = useState(String(profile?.startWeight ?? "")),
    [age, setAge] = useState(String(profile?.age ?? "")),
    [activity, setActivity] = useState(profile?.activity ?? ""),
    [training, setTraining] = useState(String(profile?.training ?? 0)),
    [preferences, setPreferences] = useState(profile?.preferences ?? "");
  const [kind, setKind] = useState<Goal["kind"]>(goal?.kind ?? "track"),
    [targetWeight, setTargetWeight] = useState(
      String(goal?.targetWeight ?? ""),
    ),
    [targetDate, setTargetDate] = useState(goal?.targetDate ?? ""),
    [effective, setEffective] = useState(localDay()),
    [nutrients, setNutrients] = useState(
      goal ? nutrientStrings(goal.nutrients) : blankNutrientStrings(),
    );
  const { error, busy, execute } = useFormAction();
  const delta =
    targetDate && targetWeight && weight
      ? weeklyChange(
          Number(weight.replace(",", ".")),
          Number(targetWeight.replace(",", ".")),
          profile?.startDate ?? effective,
          targetDate,
        )
      : null;
  return (
    <Form
      error={error}
      busy={busy}
      submit={profile ? "Tallenna profiili ja tavoitteet" : "Aloita oma polku"}
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          const p = profileSchema.parse({
            ...stamped(profile),
            name,
            height: numberInput(height),
            startWeight: numberInput(weight),
            startDate: profile?.startDate ?? effective,
            age: numberInput(age, true),
            activity,
            training: numberInput(training),
            preferences,
          });
          const isWeight = kind === "lose" || kind === "gain";
          if (isWeight && targetDate <= (profile?.startDate ?? effective))
            throw new Error("Tavoitepäivän tulee olla lähtöpäivän jälkeen.");
          if (isWeight && targetDate <= effective)
            throw new Error(
              "Tavoitepäivän tulee olla voimaantulopäivän jälkeen.",
            );
          const g = goalSchema.parse({
            ...stamped(),
            effectiveDate: effective,
            kind,
            targetWeight: isWeight ? numberInput(targetWeight) : null,
            targetDate: isWeight ? targetDate : null,
            nutrients: parseNutrients(nutrients),
          });
          await saveProfileGoal(p, g);
          onSaved();
        });
      }}
    >
      <p className="muted">
        Oma tahti, omat tavoitteet. Ravintoainetavoitteet ovat vapaaehtoisia.
      </p>
      <Field label="Nimi (vapaaehtoinen)">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          autoComplete="given-name"
        />
      </Field>
      <div className="two-cols">
        <Field label="Pituus (cm)">
          <Decimal value={height} onChange={setHeight} required />
        </Field>
        <Field label="Lähtöpaino (kg)">
          <Decimal value={weight} onChange={setWeight} required />
        </Field>
      </div>
      <div className="two-cols">
        <Field label="Ikä (vapaaehtoinen)">
          <Decimal value={age} onChange={setAge} placeholder="Ei pakollinen" />
        </Field>
        <Field label="Treenikerrat / viikko">
          <Decimal value={training} onChange={setTraining} />
        </Field>
      </div>
      <Field label="Arkiliikkumisen kuvaus">
        <input
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
          placeholder="Esim. kävelen työmatkat"
          maxLength={5000}
        />
      </Field>
      <Field label="Ruokamieltymykset ja rajoitteet (vapaaehtoinen)">
        <textarea
          value={preferences}
          onChange={(e) => setPreferences(e.target.value)}
          maxLength={5000}
        />
      </Field>
      <h3>Sinun tavoitteesi</h3>
      <Field label="Tavoitetyyppi">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Goal["kind"])}
        >
          <option value="track">Ruokailutottumusten seuranta</option>
          <option value="maintain">Painon ylläpito</option>
          <option value="lose">Painon pudottaminen</option>
          <option value="gain">Painon nostaminen</option>
        </select>
      </Field>
      {(kind === "lose" || kind === "gain") && (
        <>
          <div className="two-cols">
            <Field label="Tavoitepaino (kg)">
              <Decimal
                value={targetWeight}
                onChange={setTargetWeight}
                required
              />
            </Field>
            <Field label="Tavoitepäivä">
              <input
                type="date"
                required
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </Field>
          </div>
          {delta !== null && Number.isFinite(delta) && (
            <p className="notice">
              Tavoite edellyttää keskimäärin {formatNumber(delta, 2)} kg:n
              muutosta viikossa. Tämä ei ole ennuste tai terveydellisen
              sopivuuden arvio.
            </p>
          )}
        </>
      )}
      <Field label="Tavoitteet voimassa alkaen">
        <input
          type="date"
          required
          value={effective}
          onChange={(e) => setEffective(e.target.value)}
        />
      </Field>
      <p className="muted small">
        Jätä tyhjäksi tavoitteet, joita et halua asettaa. Saman
        voimaantulopäivän tavoite korvautuu; aiemmat voimaantulopäivät säilyvät.
      </p>
      <NutrientFields value={nutrients} onChange={setNutrients} />
    </Form>
  );
}
