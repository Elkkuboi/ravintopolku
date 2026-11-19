// Geometry of the Kehitys charts as pure functions: nice axis ticks, bar slots and label placement. Kuvaaja.tsx only
// draws what these return. Coordinates are SVG user units; the chart's viewBox is its measured CSS width, so one unit
// is one pixel and the 11 px axis text keeps its size on every screen.

export interface Asteikko {
  min: number;
  max: number;
  /** Tick values from min to max, both included. */
  merkit: number[];
}

/**
 * Round ticks covering lo..hi with about `valeja` intervals (steps 1, 2, 2.5 or 5 × 10^k). Without `nollasta` the
 * lowest value stays at least `alavara` (share of the axis) above the bottom tick, so it never hides under the axis
 * line and a label fits below it (the target weight); the axis then starts a step lower.
 */
export function asteikko(
  lo: number,
  hi: number,
  { nollasta = false, valeja = 3, alavara = 0 } = {},
): Asteikko {
  if (nollasta) lo = Math.min(0, lo);
  if (!(hi > lo)) {
    // A single value or an empty chart: centre it in a band of two units.
    hi = lo + 1;
    lo = nollasta ? 0 : lo - 1;
  }
  const raaka = (hi - lo) / valeja;
  const pot = 10 ** Math.floor(Math.log10(raaka));
  const askel =
    [1, 2, 2.5, 5, 10].map((k) => k * pot).find((s) => s >= raaka - 1e-9) ??
    10 * pot;
  let min = Math.floor(lo / askel + 1e-9) * askel;
  const max = Math.ceil(hi / askel - 1e-9) * askel;
  if (!nollasta)
    while (lo - min < Math.max(alavara * (max - min), askel * 1e-6))
      min -= askel;
  const n = Math.round((max - min) / askel);
  const merkit = Array.from({ length: n + 1 }, (_, i) =>
    Number((min + i * askel).toFixed(10)),
  );
  return { min: merkit[0], max: merkit[n], merkit };
}

/** Width of one character of the 11 px axis text (IBM Plex Mono: 0.6 em). */
export const MERKKI = 6.6;

export interface Alue {
  /** Left edge of the plot, right of the tick labels. */
  x0: number;
  /** Right edge of the plot; room for the end point marker. */
  x1: number;
  /** Top tick line. */
  yYla: number;
  /** Baseline (axis). Date labels sit below it. */
  yAla: number;
}

/** Plot area for a chart of the given size whose tick labels are `tekstit`. */
export function alue(leveys: number, korkeus: number, tekstit: string[]): Alue {
  const pisin = Math.max(0, ...tekstit.map((t) => t.length));
  return {
    x0: Math.max(34, Math.ceil(pisin * MERKKI) + 8),
    x1: leveys - 4,
    yYla: 20,
    yAla: korkeus - 24,
  };
}

/** Share of the plot height that a label below a line needs: 13 px for the text and 3 px above the axis. */
export const tekstinVara = (korkeus: number) => {
  const { yYla, yAla } = alue(0, korkeus, []);
  return 16 / (yAla - yYla);
};

/** Vertical position of value v. */
export function yPaikka(v: number, a: Asteikko, al: Alue): number {
  const osuus = a.max === a.min ? 0.5 : (v - a.min) / (a.max - a.min);
  return al.yAla - osuus * (al.yAla - al.yYla);
}

/** Centre of day i of n: each day owns an equal slot, so line points and bars share the same x. */
export function xPaikka(i: number, n: number, al: Alue): number {
  return al.x0 + ((al.x1 - al.x0) * (i + 0.5)) / n;
}

/** Bar of day i of n: a gap of 30 % of the slot (at most 6), none when slots are under 2 units wide. */
export function palkki(
  i: number,
  n: number,
  al: Alue,
): { x: number; w: number } {
  const s = (al.x1 - al.x0) / n;
  const rako = s < 2 ? 0 : Math.min(0.3 * s, 6);
  return { x: al.x0 + s * i + rako / 2, w: s - rako };
}

/**
 * Baseline of the target line's label at the right edge: on the side away from the line's last point, unless that
 * side has no room inside the plot.
 */
export function tavoiteTekstiY(
  yTavoite: number,
  yViimeinen: number | null,
  al: Alue,
): number {
  const alle = yTavoite + 13,
    ylle = yTavoite - 5;
  const mahtuuAlle = alle <= al.yAla - 3,
    mahtuuYlle = ylle >= 11;
  // SVG y grows downwards: a last point above the target line (smaller y) leaves the space below free.
  const haluaaAlle = yViimeinen === null || yViimeinen <= yTavoite;
  if (haluaaAlle) return mahtuuAlle ? alle : ylle;
  return mahtuuYlle ? ylle : alle;
}
