import {
  emptyDataset,
  stamped,
  id,
  TIMEZONE,
  type Dataset,
  type MealLine,
} from "../domain/model";
import { addDays, localDay, wallTimestamp } from "../domain/dates";
import { mealSnapshot } from "../domain/nutrition";
export function demoDataset(): Dataset {
  const d = emptyDataset(),
    today = localDay();
  d.profiles = [
    {
      ...stamped(),
      name: "Kokeilija",
      height: 175,
      startWeight: 78,
      startDate: addDays(today, -30),
      age: null,
      activity: "Kävelyä arjessa",
      training: 2,
      preferences: "",
    },
  ];
  d.goals = [
    {
      ...stamped(),
      effectiveDate: addDays(today, -30),
      kind: "lose",
      targetWeight: 77,
      targetDate: addDays(today, 60),
      nutrients: {
        energy: 2200,
        protein: 100,
        carbs: null,
        fat: null,
        fiber: 30,
      },
    },
  ];
  d.foods = [
    {
      ...stamped(),
      name: "Kaurapuuro",
      state: "kypsä",
      source: "Esimerkkidata",
      favorite: true,
      per100: { energy: 80, protein: 3, carbs: 12, fat: 2, fiber: 2 },
    },
  ];
  for (let i = 29; i >= 0; i--) {
    const date = addDays(today, -i);
    if (i === 0 || i % 4 !== 0)
      d.weights.push({
        ...stamped(),
        date,
        kg: 78 - (29 - i) * 0.015 + Math.sin(i) * 0.2,
        note: "Esimerkki",
      });
    if (i > 0 && i % 6 === 0) continue;
    for (const [j, name] of ["Aamiainen", "Lounas", "Päivällinen"].entries()) {
      const line: MealLine = {
        id: id(),
        name: j === 0 ? "Puuro ja marjat" : "Esimerkkiannos",
        foodId: null,
        mode: "portion",
        grams: null,
        values: {
          energy: 450 + j * 180 + Math.sin(i) * 50,
          protein: 20 + j * 8,
          carbs: 55 + j * 5,
          fat: 14 + j * 3,
          fiber: i % 5 === 0 ? null : 6 + j,
        },
        source: "Esimerkkidata",
        state: "",
      };
      d.meals.push({
        ...stamped(),
        date,
        time: `${8 + j * 5}:00`.padStart(5, "0"),
        timestamp: wallTimestamp(date, `${8 + j * 5}:00`.padStart(5, "0")),
        timezone: TIMEZONE,
        type: name as "Aamiainen" | "Lounas" | "Päivällinen",
        lines: [line],
        snapshot: mealSnapshot([line]),
        note: "",
        origin: "Esimerkkidata",
        assumptions: [],
        photoId: null,
      });
    }
    d.days.push({ ...stamped(), date, complete: i % 3 !== 0 });
  }
  return d;
}
