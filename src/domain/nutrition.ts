import {
  keys,
  emptyNutrients,
  type MealLine,
  type Nutrients,
  type NutrientKey,
  type Meal,
  type Goal,
} from "./model";
export interface Total {
  value: number | null;
  known: number;
  missing: number;
  partial: boolean;
}
export type Totals = Record<keyof Nutrients, Total>;
export function lineNutrients(line: MealLine): Nutrients {
  if (line.mode === "per100" && line.grams === null) return emptyNutrients();
  const factor = line.mode === "per100" ? (line.grams ?? 0) / 100 : 1;
  return Object.fromEntries(
    keys.map((k) => [
      k,
      line.values[k] === null ? null : line.values[k] * factor,
    ]),
  ) as Nutrients;
}
export function aggregate(values: Nutrients[]): Totals {
  return Object.fromEntries(
    keys.map((k) => {
      const known = values.filter((v) => v[k] !== null);
      const missing = values.length - known.length;
      return [
        k,
        {
          value: known.length ? known.reduce((s, v) => s + v[k]!, 0) : null,
          known: known.length,
          missing,
          partial: missing > 0,
        },
      ];
    }),
  ) as Totals;
}
export function mealSnapshot(lines: MealLine[]): Nutrients {
  const total = aggregate(lines.map(lineNutrients));
  const result = emptyNutrients();
  for (const k of keys) result[k] = total[k].partial ? null : total[k].value;
  return result;
}
// Keep known subtotals visible while marking missing ingredients in each meal.
export function mealTotals(meal: Meal): Totals {
  return aggregate(meal.lines.map(lineNutrients));
}
export function dayTotals(meals: Meal[]): Totals {
  return aggregate(meals.flatMap((m) => m.lines.map(lineNutrients)));
}
export const goalForDay = (goals: Goal[], date: string): Goal | undefined =>
  goals
    .filter((g) => g.effectiveDate <= date)
    .sort(
      (a, b) =>
        b.effectiveDate.localeCompare(a.effectiveDate) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )[0];
/**
 * Tavoitealue: päivän hyväksytty vaihtelu yhden tavoitteen ympärillä osuutena tavoitteesta. Tavoite on yhä yksi
 * luku, ja jakson keskiarvo ratkaisee; yksittäinen päivä on kohinaa sen ympärillä. Energia on kaksisuuntainen
 * (±10 % on noin yhden treenin kulutus ja yhden päivän kirjaustarkkuus), hiilihydraatit ja rasva väljemmin (±20 %),
 * koska ne korvaavat toisiaan energian sisällä. Proteiini ja kuitu ovat "vähintään": ylärajaa ei ole.
 */
export const TAVOITEALUE: Record<
  NutrientKey,
  { ala: number; yla: number | null }
> = {
  energy: { ala: 0.9, yla: 1.1 },
  protein: { ala: 0.9, yla: null },
  carbs: { ala: 0.8, yla: 1.2 },
  fat: { ala: 0.8, yla: 1.2 },
  fiber: { ala: 0.9, yla: null },
};
/** Suljettu väli kokonaisina yksikköinä (kcal, g); yla null = ei ylärajaa. */
export interface Tavoitealue {
  ala: number;
  yla: number | null;
}
/** Tavoitteen alue. Ei aluetta, kun tavoitetta ei ole tai se on niin pieni, että alaraja pyöristyy nollaan. */
export function tavoitealue(
  key: NutrientKey,
  goal: number | null | undefined,
): Tavoitealue | null {
  if (goal === null || goal === undefined || !(goal > 0)) return null;
  const { ala, yla } = TAVOITEALUE[key];
  const alaraja = Math.round(goal * ala);
  return alaraja > 0
    ? { ala: alaraja, yla: yla === null ? null : Math.round(goal * yla) }
    : null;
}
export type Osuma = "alle" | "sisalla" | "yli";
/**
 * Mihin päivän luku osuu. Vertailu tehdään näytetyllä (pyöristetyllä) luvulla, joten väri ei ole ristiriidassa
 * ruudun luvun kanssa. `alaraja`: summa voi vielä kasvaa (osittainen summa tai kesken oleva päivä). Silloin varmaa
 * on vain se, minkä alaraja todistaa: ylitys, tai "vähintään"-tavoitteen täyttyminen. Muu on null (ei tiedetä).
 */
export function osuma(
  arvo: number | null,
  alue: Tavoitealue | null,
  alaraja = false,
): Osuma | null {
  if (arvo === null || alue === null) return null;
  const x = Math.round(arvo);
  if (alue.yla !== null && x > alue.yla) return "yli";
  if (x >= alue.ala) return alaraja && alue.yla !== null ? null : "sisalla";
  return alaraja ? null : "alle";
}
export const formatNumber = (n: number | null, digits = 1) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("fi-FI", { maximumFractionDigits: digits }).format(
        n,
      );
