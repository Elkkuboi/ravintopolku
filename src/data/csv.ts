import { type Dataset, keys, TIMEZONE } from "../domain/model";
import { dayTotals, lineNutrients } from "../domain/nutrition";
const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+@-]/.test(s) && typeof v === "string") s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
const csv = (rows: unknown[][]) =>
  "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
export function csvExports(data: Dataset) {
  const nutrientHeaders = [
    "energy_kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
  ];
  const meals = csv([
    [
      "meal_id",
      "date",
      "time",
      "timestamp",
      "timezone",
      "meal_type",
      "food",
      "mode",
      "grams",
      "state",
      "source",
      "origin",
      "day_complete",
      ...nutrientHeaders,
      "missing_nutrients",
      "note",
    ],
    ...data.meals.flatMap((m) =>
      m.lines.map((l) => {
        const n = lineNutrients(l);
        return [
          m.id,
          m.date,
          m.time,
          m.timestamp,
          TIMEZONE,
          m.type,
          l.name,
          l.mode,
          l.grams,
          l.state,
          l.source,
          m.origin,
          data.days.some((d) => d.date === m.date && d.complete),
          ...keys.map((k) => n[k]),
          keys.filter((k) => n[k] === null).join("|"),
          m.note,
        ];
      }),
    ),
  ]);
  const weights = csv([
    ["date", "weight_kg", "note", "timezone", "created_at", "updated_at"],
    ...data.weights.map((w) => [
      w.date,
      w.kg,
      w.note,
      TIMEZONE,
      w.createdAt,
      w.updatedAt,
    ]),
  ]);
  const dates = [
    ...new Set([
      ...data.meals.map((m) => m.date),
      ...data.days.map((d) => d.date),
    ]),
  ].sort();
  const days = csv([
    [
      "date",
      "timezone",
      "meal_count",
      "complete",
      ...nutrientHeaders,
      ...keys.map((k) => k + "_partial"),
      ...keys.map((k) => k + "_known_items"),
      ...keys.map((k) => k + "_missing_items"),
    ],
    ...dates.map((date) => {
      const meals = data.meals.filter((m) => m.date === date),
        total = dayTotals(meals);
      return [
        date,
        TIMEZONE,
        meals.length,
        data.days.some((d) => d.date === date && d.complete),
        ...keys.map((k) => total[k].value),
        ...keys.map((k) => total[k].partial),
        ...keys.map((k) => total[k].known),
        ...keys.map((k) => total[k].missing),
      ];
    }),
  ]);
  return { meals, weights, days };
}
