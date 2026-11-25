import {
  ALLE_MAX,
  YLI_MAX,
  keys,
  labels,
  emptyNutrients,
  numberInput,
  type Alue,
  type Alueet,
  type NutrientKey,
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

// Tavoitealueen prosentit lomakkeessa: "alle" on pakollinen kokonaisluku, tyhjä "yli" tarkoittaa, ettei ylärajaa ole.
export type AlueStrings = Record<NutrientKey, { alle: string; yli: string }>;
export function alueStrings(a: Alueet): AlueStrings {
  return Object.fromEntries(
    keys.map((k) => [
      k,
      {
        alle: String(a[k].alle),
        yli: a[k].yli === null ? "" : String(a[k].yli),
      },
    ]),
  ) as AlueStrings;
}
const prosentti = (s: string, max: number): number | null => {
  const t = s.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
};
/** Yhden rivin prosentit luvuiksi; null, kun rivi ei kelpaa (kesken oleva syöte ei ole virhe esikatselussa). */
export function parseAlue(rivi: { alle: string; yli: string }): Alue | null {
  const alle = prosentti(rivi.alle, ALLE_MAX);
  const yli = rivi.yli.trim() ? prosentti(rivi.yli, YLI_MAX) : null;
  if (alle === null || (rivi.yli.trim() && yli === null)) return null;
  return { alle, yli };
}
/** Koko lomakkeen alueet. Heittää suomenkielisen virheen, joka nimeää ensimmäisen kelvottoman rivin. */
export function parseAlueet(a: AlueStrings): Alueet {
  return Object.fromEntries(
    keys.map((k) => {
      const alue = parseAlue(a[k]);
      if (!alue)
        throw new Error(
          `Tavoitealue, ${labels[k].toLowerCase()}: alle 0–${ALLE_MAX} ja yli 0–${YLI_MAX} kokonaisina prosentteina. Tyhjä yli tarkoittaa, ettei ylärajaa ole.`,
        );
      return [k, alue];
    }),
  ) as Alueet;
}
