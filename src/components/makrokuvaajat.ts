import { labels, type Dataset } from "../domain/model";
import { dailySeries, observedMean } from "../domain/analytics";
import {
  goalForDay,
  formatNumber,
  osuma,
  type Tavoitealue,
} from "../domain/nutrition";
import { dayDistance, dayRange } from "../domain/dates";
import { meterKeys, meterUnit, type MeterKey } from "./makromittarit";
// Daily macro series for the charts: a period of calendar days ending at `end`
// (7 by default). The sums come from analytics/nutrition, so an unknown value
// stays null and is never drawn or averaged as zero.
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
const macroDigits = (k: MeterKey) => (k === "energy" ? 0 : 1);
// Spoken version of a chart: the SVG has no readable text for the bars, so the
// numbers are given as text for screen readers.
export function macroSummary(
  c: MacroChart,
  treeni: ReadonlySet<string> = new Set(),
): string {
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
        }${treeni.has(p.date) ? " treenipäivä" : ""}`,
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

// --- Kehitys ----------------------------------------------------------------
// Period choice of the Kehitys page; every period ends today.
export const jaksot = [7, 30, 90, "kaikki"] as const;
export type Jakso = (typeof jaksot)[number];
export const jaksoTeksti = (j: Jakso) =>
  j === "kaikki" ? "Kaikki" : `${j} pv`;

/** Days in the period. "kaikki" reaches back to the first meal, weight or training day, but is never shorter than a week. */
export function jaksonPituus(data: Dataset, end: string, jakso: Jakso): number {
  if (jakso !== "kaikki") return jakso;
  const ensimmainen = [
    ...data.meals,
    ...data.weights,
    ...data.lifestyles.filter((l) => l.trainingDay),
  ]
    .map((r) => r.date)
    .filter((d) => d <= end)
    .sort()[0];
  return ensimmainen
    ? Math.max(chartDays, dayDistance(ensimmainen, end) + 1)
    : chartDays;
}

/**
 * Whether the day's sums are final. Every past day is; the last day of the period (today) only once it is marked
 * complete, because a day still in progress would pull the mean down.
 */
const lopullinen = (data: Dataset, end: string, date: string) =>
  date !== end || data.days.some((d) => d.date === end && d.complete);

/** Mean over the days whose value is fully known and final. */
export function jaksonKeskiarvo(
  data: Dataset,
  end: string,
  points: MacroPoint[],
) {
  return observedMean(
    points
      .filter((p) => !p.partial && lopullinen(data, end, p.date))
      .map((p) => p.value),
  );
}

/**
 * Days that landed in the goal's target zone (the same rule as the Tänään meters), out of the days whose outcome is
 * known. A partial sum and today in progress are lower bounds: they count once the bound proves the outcome (an
 * "at least" goal is reached, or the upper end is exceeded); otherwise the day is unknown and left out.
 */
export function tavoitePaivat(
  data: Dataset,
  end: string,
  points: MacroPoint[],
  alue: Tavoitealue,
): { taytti: number; paivia: number } {
  let taytti = 0,
    paivia = 0;
  for (const p of points) {
    const o = osuma(p.value, alue, p.partial || !lopullinen(data, end, p.date));
    if (o === null) continue;
    paivia++;
    if (o === "sisalla") taytti++;
  }
  return { taytti, paivia };
}

/** Days marked as training days on the Tänään page. */
export const treenipaivat = (data: Dataset): Set<string> =>
  new Set(data.lifestyles.filter((l) => l.trainingDay).map((l) => l.date));

export interface TreeniYhteenveto {
  /** Days in the period and training days among them. */
  paivia: number;
  treeni: number;
  /** Energy means on training days and on the other days, as in jaksonKeskiarvo (final, fully known days). */
  treenipaivina: { value: number | null; count: number };
  muina: { value: number | null; count: number };
}

/** Training days of the period and the mean energy on training days versus the other days. */
export function treeniYhteenveto(
  data: Dataset,
  end: string,
  points: MacroPoint[],
): TreeniYhteenveto {
  const t = treenipaivat(data);
  const treeni = points.filter((p) => t.has(p.date)),
    muut = points.filter((p) => !t.has(p.date));
  return {
    paivia: points.length,
    treeni: treeni.length,
    treenipaivina: jaksonKeskiarvo(data, end, treeni),
    muina: jaksonKeskiarvo(data, end, muut),
  };
}

/** "Treenattu 9 päivänä 30:stä. Energian keskiarvo treenipäivinä 2 450 kcal (8 pv), muina päivinä 2 180 kcal (19 pv)." */
export function treeniLause(y: TreeniYhteenveto): string {
  const ka = (m: { value: number | null; count: number }, missa: string) =>
    m.value === null
      ? null
      : `${missa} ${formatNumber(m.value, 0)} kcal (${m.count}\u00a0pv)`;
  const osat = [
    ka(y.treenipaivina, "treenipäivinä"),
    ka(y.muina, "muina päivinä"),
  ].filter(Boolean);
  return (
    `Treenattu ${y.treeni} päivänä ${elatiivi(y.paivia)}.` +
    (osat.length ? ` Energian keskiarvo ${osat.join(", ")}.` : "")
  );
}

/**
 * Longer periods draw weekly means. On a 360 px phone a 90-day period would give ~3 px slots and ~2 px bars, which
 * read as noise and hide the goal line; 30 daily bars still get ~9 px slots.
 */
export const VIIKOITTAIN_YLI = 30;

/** True when the period is drawn as weekly means instead of one bar per day. */
export const viikkoPylvaina = (paivia: number) => paivia > VIIKOITTAIN_YLI;

export interface Pylvas {
  /** Name for the bar's hint text. */
  nimi: string;
  value: number | null;
  partial: boolean;
}

/** One bar per day of the period. */
export const paivaPylvaat = (points: MacroPoint[]): Pylvas[] =>
  points.map((p) => ({ nimi: shortDate(p.date), ...p }));

/**
 * One bar per seven days counted back from the end of the period (the oldest block may be shorter). The bar is the
 * mean of the block's final, fully known days (jaksonKeskiarvo); a block without such days is a gap.
 */
export function viikkoPylvaat(
  data: Dataset,
  end: string,
  points: MacroPoint[],
): Pylvas[] {
  const out: Pylvas[] = [];
  for (let loppu = points.length; loppu > 0; loppu -= 7) {
    const viikko = points.slice(Math.max(0, loppu - 7), loppu);
    out.unshift({
      nimi: `${shortDate(viikko[0].date)}–${shortDate(viikko[viikko.length - 1].date)} keskiarvo`,
      value: jaksonKeskiarvo(data, end, viikko).value,
      partial: false,
    });
  }
  return out;
}

/** Elative ending of a number written in digits: 14 → "14:stä", 12 → "12:sta", 100 → "100:sta". */
export function elatiivi(n: number): string {
  // Ending of yksi … yhdeksän (yhdestä, kahdesta, kolmesta, neljästä, viidestä, kuudesta, seitsemästä, kahdeksasta,
  // yhdeksästä); -toista takes the ending of its first part, kymmenen → kymmenestä, sata → sadasta, tuhat → tuhannesta.
  const ykkoset = [
    "",
    "stä",
    "sta",
    "sta",
    "stä",
    "stä",
    "sta",
    "stä",
    "sta",
    "stä",
  ];
  const n100 = n % 100,
    n10 = n % 10;
  const paate =
    n === 0 ? "sta" : n10 !== 0 ? ykkoset[n10] : n100 !== 0 ? "stä" : "sta";
  return `${n}:${paate}`;
}

/** Date label of the chart's x axis: "19.11.", with the year when it differs from the end of the period. */
export function paivaTeksti(day: string, end: string): string {
  return day.slice(0, 4) === end.slice(0, 4)
    ? shortDate(day)
    : `${shortDate(day)}${day.slice(0, 4)}`;
}

const muutos = new Intl.NumberFormat("fi-FI", {
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

export interface PainoKuvaaja {
  /** Days of the period in order; the last one is today. */
  paivat: string[];
  /** Measurements of the period: index into paivat and the weight. */
  pisteet: { i: number; kg: number }[];
  /** Target weight of the goal in force at the end of the period. */
  tavoite: number | null;
  /** Short summary for the heading: change over the measured span, or the only measurement. */
  yhteenveto: string | null;
}

export function painoKuvaaja(
  data: Dataset,
  end: string,
  days: number,
): PainoKuvaaja {
  const paivat = dayRange(end, days);
  const kg = new Map(data.weights.map((w) => [w.date, w.kg]));
  const pisteet = paivat.flatMap((d, i) => {
    const arvo = kg.get(d);
    return arvo === undefined ? [] : [{ i, kg: arvo }];
  });
  const eka = pisteet[0],
    vika = pisteet.at(-1);
  const yhteenveto =
    !eka || !vika
      ? null
      : eka === vika
        ? `${formatNumber(vika.kg)} kg`
        : `${muutos.format(Number((vika.kg - eka.kg).toFixed(1)))} kg / ${vika.i - eka.i} pv`;
  return {
    paivat,
    pisteet,
    tavoite: goalForDay(data.goals, end)?.targetWeight ?? null,
    yhteenveto,
  };
}

/**
 * Whether the target weight is drawn into the weight chart. It is when it lies within the measured range widened by
 * the range itself (at least 2 kg) on both sides; a distant target would flatten the line, so it is then only named
 * in the heading.
 */
export function tavoiteLahella(kgs: number[], tavoite: number): boolean {
  if (!kgs.length) return false;
  const lo = Math.min(...kgs),
    hi = Math.max(...kgs);
  const vara = Math.max(2, hi - lo);
  return tavoite >= lo - vara && tavoite <= hi + vara;
}
