import { type Dataset, type Weight } from "./model";
import { dayRange, addDays, dayDistance } from "./dates";
import { dayTotals, goalForDay } from "./nutrition";
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
export function goalWeight(data: Dataset, date: string): number | null {
  const p = data.profiles[0],
    g = goalForDay(data.goals, date);
  if (
    !p ||
    !g?.targetDate ||
    g.targetWeight === null ||
    date < p.startDate ||
    date > g.targetDate
  )
    return null;
  const duration = dayDistance(p.startDate, g.targetDate);
  if (duration <= 0) return null;
  return (
    p.startWeight +
    ((g.targetWeight - p.startWeight) * dayDistance(p.startDate, date)) /
      duration
  );
}
export function weeklyChange(
  startWeight: number,
  targetWeight: number,
  startDate: string,
  targetDate: string,
): number | null {
  const days = dayDistance(startDate, targetDate);
  return days > 0 ? ((targetWeight - startWeight) * 7) / days : null;
}
export function dailySeries(
  data: Dataset,
  end: string,
  count: number,
  completeOnly = false,
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
      energy: !completeOnly || complete ? totals.energy.value : null,
      protein: !completeOnly || complete ? totals.protein.value : null,
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
