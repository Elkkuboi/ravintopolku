import {
  keys,
  emptyNutrients,
  type MealLine,
  type Nutrients,
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
export const formatNumber = (n: number | null, digits = 1) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("fi-FI", { maximumFractionDigits: digits }).format(
        n,
      );
