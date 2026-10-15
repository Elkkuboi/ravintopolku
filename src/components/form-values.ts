import {
  keys,
  emptyNutrients,
  numberInput,
  type Nutrients,
} from "../domain/model";
export type NutrientStrings = Record<keyof Nutrients, string>;
export function nutrientStrings(n: Nutrients): NutrientStrings {
  return Object.fromEntries(
    keys.map((k) => [k, n[k] === null ? "" : String(n[k]).replace(".", ",")]),
  ) as NutrientStrings;
}
export function parseNutrients(n: NutrientStrings): Nutrients {
  return Object.fromEntries(
    keys.map((k) => [k, numberInput(n[k], true)]),
  ) as Nutrients;
}
export const blankNutrientStrings = () => nutrientStrings(emptyNutrients());
