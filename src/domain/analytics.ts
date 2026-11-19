import { type Dataset, type Weight } from "./model";
import { dayRange, addDays } from "./dates";
import { dayTotals } from "./nutrition";
export function weightSeries(weights: Weight[], end: string, count: number) {
  return dayRange(end, count).map((date) => {
    const window = weights.filter(
      (w) => w.date >= addDays(date, -6) && w.date <= date,
    );
    return {
      date,
      weight: weights.find((w) => w.date === date)?.kg ?? null,
      average:
        window.length >= 3
          ? window.reduce((s, w) => s + w.kg, 0) / window.length
          : null,
      measurements: window.length,
    };
  });
}
export function dailySeries(
  data: Dataset,
  end: string,
  count: number,
) {
  return dayRange(end, count).map((date) => {
    const meals = data.meals.filter((m) => m.date === date),
      complete = data.days.some((d) => d.date === date && d.complete);
    const totals = dayTotals(meals);
    return {
      date,
      complete,
      recorded: meals.length > 0,
      totals,
      energy: totals.energy.value,
      protein: totals.protein.value,
      partial: totals.energy.partial,
    };
  });
}
export function observedMean(values: (number | null)[]) {
  const present = values.filter((n): n is number => n !== null);
  return {
    value: present.length
      ? present.reduce((s, n) => s + n, 0) / present.length
      : null,
    count: present.length,
  };
}
