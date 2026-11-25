import { type NutrientKey } from "../domain/model";
import {
  formatNumber,
  osuma,
  tavoitealue,
  type Osuma,
  type Tavoitealue,
  type Total,
} from "../domain/nutrition";
// Home-screen meters for the day's energy and macros. Pure computation only;
// the sums themselves come from domain/nutrition (null = unknown, not zero).
export const meterKeys = ["energy", "protein", "carbs", "fat"] as const;
/** Tänään-sivun makrorivit energian alla. */
export const makroKeys = ["protein", "carbs", "fat", "fiber"] as const;
export type MeterKey = (typeof meterKeys)[number];
export const meterUnit = (k: NutrientKey) => (k === "energy" ? "kcal" : "g");
export interface MeterReading {
  /** Known sum of the day's lines; null when nothing is known. */
  consumed: number | null;
  /** Goal for the day; null when no goal or the goal leaves this value empty. */
  goal: number | null;
  /** goal − consumed, clamped at 0; null when either side is unknown. */
  remaining: number | null;
  /** consumed − goal when the goal is exceeded, otherwise 0; null when unknown. */
  over: number | null;
  /** Fill of the bar, 0–100; 0 when nothing is known. */
  percent: number;
  /** Some lines lack this value, so consumed is a lower bound. */
  partial: boolean;
  /** Number of lines whose value is unknown. */
  missing: number;
  /** No lines at all for the day. */
  empty: boolean;
}
export function meterReading(
  total: Total,
  goal: number | null | undefined,
): MeterReading {
  const consumed = total.value;
  const g = goal ?? null;
  const base = {
    consumed,
    goal: g,
    partial: total.partial,
    missing: total.missing,
    empty: total.known === 0 && total.missing === 0,
  };
  if (consumed === null || g === null)
    return { ...base, remaining: null, over: null, percent: 0 };
  const diff = g - consumed;
  return {
    ...base,
    remaining: Math.max(0, diff),
    over: Math.max(0, -diff),
    percent:
      g > 0
        ? Math.min(100, Math.max(0, (consumed / g) * 100))
        : consumed > 0
          ? 100
          : 0,
  };
}

/** Mittari näytetään, kun tavoite on ja summa tiedetään (tyhjä päivä on 0). Muuten pisteviiva. */
export const naytaMittari = (r: MeterReading) =>
  r.goal !== null && (r.consumed !== null || r.empty);

/** Energian iso luku: tyhjä päivä on 0, puuttuva tieto "ei tietoa". */
export function energiaLuku(r: MeterReading): string {
  if (r.consumed !== null) return formatNumber(r.consumed, 0);
  return r.empty ? "0" : "ei tietoa";
}

/**
 * Mittari tavoitealueen kanssa. Paikat ovat prosentteja palkin leveydestä: palkki on täynnä alueen ylärajalla, tai
 * tavoitteessa, kun ylärajaa ei ole ("vähintään"). Alue on siis aina palkin pääty.
 */
export interface Asteikko {
  alue: Tavoitealue;
  /** Tavoitealueen alku; alue jatkuu palkin loppuun. */
  alku: number;
  /** Tavoitteen merkki alueen sisällä; null, kun tavoite on palkin pää. */
  tavoite: number | null;
  /** Täyttö 0–100. */
  taytto: number;
  /** Mihin päivä osuu; null, kun osittainen summa ei ratkaise. */
  osuma: Osuma | null;
  /** Ylitys on varoitus. Vain energialla: muiden ylitys näkyy jo energiassa. */
  varoitus: boolean;
}
export function asteikko(key: NutrientKey, r: MeterReading): Asteikko | null {
  const alue = tavoitealue(key, r.goal);
  if (!alue || r.goal === null || !naytaMittari(r)) return null;
  const taysi = alue.yla ?? r.goal;
  const p = (x: number) => Math.min(100, Math.max(0, (x / taysi) * 100));
  const syoty = r.consumed ?? 0;
  const o = osuma(syoty, alue, r.partial);
  return {
    alue,
    alku: p(alue.ala),
    tavoite: alue.yla === null ? null : p(r.goal),
    taytto: p(syoty),
    osuma: o,
    varoitus: o === "yli" && key === "energy",
  };
}

/** Otsikon sivuteksti: yksi tavoite ja sen alue, "tavoite 2 300 (2 070–2 530) kcal". */
export function energiaTavoite(r: MeterReading, a: Asteikko | null): string {
  if (r.goal === null) return "ei tavoitetta";
  const alue =
    a && a.alue.yla !== null
      ? ` (${formatNumber(a.alue.ala, 0)}–${formatNumber(a.alue.yla, 0)})`
      : "";
  return `tavoite ${formatNumber(r.goal, 0)}${alue} kcal`;
}

/**
 * Luvun oikea puoli: jäljellä tai yli tavoitteen, aina siitä yhdestä tavoitteesta laskettuna; osittainen summa
 * kertoo enimmäismäärän. Luokka kertoo värin: "osui" tavoitealueella, "yli" alueen yläpuolella (ilman aluetta
 * tavoitteen yläpuolella).
 */
export function energiaJaljella(
  r: MeterReading,
  a: Asteikko | null = null,
): { teksti: string; luokka: "osui" | "yli" | null } | null {
  if (r.goal === null) return null;
  if (r.consumed === null)
    return r.empty
      ? { teksti: `${formatNumber(r.goal, 0)} jäljellä`, luokka: null }
      : null;
  const yli = r.over! > 0;
  const luokka = a
    ? a.osuma === "sisalla"
      ? "osui"
      : a.varoitus
        ? "yli"
        : null
    : yli
      ? "yli"
      : null;
  return {
    teksti: yli
      ? `yli ${formatNumber(r.over, 0)}`
      : `${r.partial ? "enint. " : ""}${formatNumber(r.remaining, 0)} jäljellä`,
    luokka,
  };
}

/** Makrorivin luku kahtena osana, jotta syöty luku voidaan värittää: ["≥84", " / 100 g"]. */
export function makroOsat(r: MeterReading, unit = "g"): [string, string] {
  if (r.consumed === null && !r.empty) return ["ei tietoa", ""];
  const syoty = `${r.partial ? "≥" : ""}${formatNumber(r.consumed ?? 0, 0)}`;
  return [
    syoty,
    r.goal === null ? ` ${unit}` : ` / ${formatNumber(r.goal, 0)} ${unit}`,
  ];
}

/** Makrorivin luku: "84 / 100 g", osittainen "≥84 / 100 g", ilman tavoitetta "84 g", puuttuva "ei tietoa". */
export const makroTeksti = (r: MeterReading, unit = "g"): string =>
  makroOsat(r, unit).join("");

/** Mittarin teksti ruudunlukijalle: luku, tavoite ja osuma sanana, koska väri ei saa olla ainoa merkki. */
export function mittariTeksti(
  r: MeterReading,
  a: Asteikko | null,
  unit: string,
): string {
  const tavoite =
    r.goal === null ? "" : `, tavoite ${formatNumber(r.goal, 0)} ${unit}`;
  const osui =
    a?.osuma === "sisalla"
      ? ", tavoitealueella"
      : a?.osuma === "yli"
        ? ", yli tavoitealueen"
        : "";
  return `${makroOsat(r, unit)[0]} ${unit}${tavoite}${osui}`;
}
