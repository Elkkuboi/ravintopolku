import {
  emptyNutrients,
  stamped,
  id,
  TIMEZONE,
  type MealLine,
  type Meal,
} from "../src/domain/model";
import { wallTimestamp } from "../src/domain/dates";
import { mealSnapshot } from "../src/domain/nutrition";
export const line = (): MealLine => ({
  id: id(),
  name: "Testi",
  foodId: null,
  mode: "per100",
  grams: 150,
  values: { ...emptyNutrients(), energy: 200, protein: 10, fiber: null },
  source: "Pakkaus",
  state: "kypsä",
});
export const meal = (date = "2026-10-02"): Meal => {
  const lines = [line()];
  return {
    ...stamped(),
    date,
    time: "12:00",
    timestamp: wallTimestamp(date, "12:00"),
    timezone: TIMEZONE,
    type: "Lounas",
    lines,
    snapshot: mealSnapshot(lines),
    note: "",
    origin: "Käsin",
    assumptions: [],
    photoId: null,
  };
};
