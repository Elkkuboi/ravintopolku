import { labels, type Dataset } from "../domain/model";
import { dailySeries, observedMean } from "../domain/analytics";
import { goalForDay, formatNumber } from "../domain/nutrition";
import { meterKeys, meterUnit, type MeterKey } from "./makromittarit";
// Home-screen macro trend: the viewed day and the six days before it. The
// sums come from analytics/nutrition, so an unknown value stays null and is
// never drawn or averaged as zero.
export const chartDays = 7;
export interface MacroPoint {
  date: string;
  /** Known sum of the day; null when the day has no value for this macro. */
  value: number | null;
  /** Some lines lack the value, so the day is a lower bound only. */
  partial: boolean;
}
export interface MacroChart {
  key: MeterKey;
  label: string;
  unit: string;
  /** Days in chronological order; the last one is the viewed day. */
  points: MacroPoint[];
  /** At least one day has a known value, so the chart has something to draw. */
  hasData: boolean;
  /** Mean over the days whose value is fully known; partial days excluded. */
  mean: { value: number | null; count: number };
  /** Goal in force on the viewed day; null when there is no goal. */
  goal: number | null;
}
export function macroCharts(
  data: Dataset,
  end: string,
  days = chartDays,
): MacroChart[] {
  const daily = dailySeries(data, end, days);
  const nutrients = goalForDay(data.goals, end)?.nutrients;
  return meterKeys.map((k) => {
    const points = daily.map((d) => ({
      date: d.date,
      value: d.totals[k].value,
      partial: d.totals[k].partial,
    }));
    return {
      key: k,
      label: labels[k],
      unit: meterUnit(k),
      points,
      hasData: points.some((p) => p.value !== null),
      mean: observedMean(points.filter((p) => !p.partial).map((p) => p.value)),
      goal: nutrients?.[k] ?? null,
    };
  });
}
export const shortDate = (day: string) =>
  `${Number(day.slice(8))}.${Number(day.slice(5, 7))}.`;
export const macroDigits = (k: MeterKey) => (k === "energy" ? 0 : 1);
// Spoken version of a chart: Recharts draws an unlabelled SVG, so the numbers
// are given as text for screen readers.
export function macroSummary(c: MacroChart): string {
  const days = c.points.length;
  const values = c.points
    .map(
      (p) =>
        `${shortDate(p.date)} ${
          p.value === null
            ? "ei tietoa"
            : `${formatNumber(p.value, macroDigits(c.key))} ${c.unit}${
                p.partial ? " osittainen" : ""
              }`
        }`,
    )
    .join(", ");
  return `${c.label}, ${days} päivän kuvaaja: ${values}. ${
    c.mean.value === null
      ? "Keskiarvoa ei voida laskea."
      : `Keskiarvo ${formatNumber(c.mean.value, macroDigits(c.key))} ${
          c.unit
        } ${c.mean.count} päivältä.`
  }${c.goal === null ? "" : ` Tavoite ${formatNumber(c.goal, macroDigits(c.key))} ${c.unit}.`}`;
}
