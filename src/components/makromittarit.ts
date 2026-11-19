import { type NutrientKey } from "../domain/model";
import { formatNumber, type Total } from "../domain/nutrition";
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

/** Luvun oikea puoli: jäljellä tai yli tavoitteen; osittainen summa kertoo enimmäismäärän. */
export function energiaJaljella(
  r: MeterReading,
): { teksti: string; yli: boolean } | null {
  if (r.goal === null) return null;
  if (r.consumed === null)
    return r.empty
      ? { teksti: `${formatNumber(r.goal, 0)} jäljellä`, yli: false }
      : null;
  if (r.over! > 0)
    return { teksti: `yli ${formatNumber(r.over, 0)}`, yli: true };
  return {
    teksti: `${r.partial ? "enint. " : ""}${formatNumber(r.remaining, 0)} jäljellä`,
    yli: false,
  };
}

/** Makrorivin luku: "84 / 100 g", osittainen "≥84 / 100 g", ilman tavoitetta "84 g", puuttuva "ei tietoa". */
export function makroTeksti(r: MeterReading, unit = "g"): string {
  if (r.consumed === null && !r.empty) return "ei tietoa";
  const syoty = `${r.partial ? "≥" : ""}${formatNumber(r.consumed ?? 0, 0)}`;
  return r.goal === null
    ? `${syoty} ${unit}`
    : `${syoty} / ${formatNumber(r.goal, 0)} ${unit}`;
}
