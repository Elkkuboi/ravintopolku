import { z } from "zod";
import Dexie, { type EntityTable } from "dexie";
import {
  type Profile,
  type Goal,
  type Food,
  type Meal,
  type Photo,
  type MealTemplate,
  type Weight,
  type Lifestyle,
  type DayStatus,
  type Settings,
  type Dataset,
  emptyDataset,
  mealSchema,
  foodSchema,
  weightSchema,
  profileSchema,
  goalSchema,
  lifestyleSchema,
  templateSchema,
  dayStatusSchema,
  settingsSchema,
} from "../domain/model";
import { mealSnapshot } from "../domain/nutrition";
import { localDay, localTime, wallTimestamp } from "../domain/dates";
export class DiaryDB extends Dexie {
  profiles!: EntityTable<Profile, "id">;
  goals!: EntityTable<Goal, "id">;
  foods!: EntityTable<Food, "id">;
  meals!: EntityTable<Meal, "id">;
  photos!: EntityTable<Photo, "id">;
  templates!: EntityTable<MealTemplate, "id">;
  weights!: EntityTable<Weight, "id">;
  lifestyles!: EntityTable<Lifestyle, "id">;
  days!: EntityTable<DayStatus, "id">;
  settings!: EntityTable<Settings, "id">;
  constructor(name = "ravintopolku-v1") {
    super(name);
    this.version(1).stores({
      profiles: "id",
      goals: "id,&effectiveDate",
      foods: "id,name",
      meals: "id,date,timestamp",
      photos: "id",
      templates: "id,name",
      weights: "id,&date",
      lifestyles: "id,&date",
      days: "id,&date",
      settings: "id",
    });
    // R2 (aiops ADR-0016): viimeksi synkronoitu pohja ja synkronoinnin tila. Data-taulut ennallaan.
    this.version(2).stores({
      synkPohja: "[taulu+id]",
      synkTila: "avain",
    });
  }
}
export const db = new DiaryDB();
export const tableNames = Object.keys(emptyDataset()) as (keyof Dataset)[];
export async function readDataset(database = db): Promise<Dataset> {
  const lists = await database.transaction("r", database.tables, () =>
    Promise.all(tableNames.map((t) => database.table(t).toArray())),
  );
  return Object.fromEntries(
    tableNames.map((name, i) => [name, lists[i]]),
  ) as unknown as Dataset;
}
export async function saveRecord<K extends Exclude<keyof Dataset, "photos">>(
  table: K,
  record: Dataset[K][number],
  database = db,
) {
  const schemas = {
    profiles: profileSchema,
    goals: goalSchema,
    foods: foodSchema,
    meals: mealSchema,
    templates: templateSchema,
    weights: weightSchema,
    lifestyles: lifestyleSchema,
    days: dayStatusSchema,
    settings: settingsSchema,
  };
  const parsed = schemas[table].parse(record);
  await database.table(table).put(parsed);
}
// These operations keep IndexedDB details out of forms.
export async function saveProfileGoal(
  profile: Profile,
  goal: Goal,
  database = db,
) {
  const p = profileSchema.parse(profile),
    g = goalSchema.parse(goal);
  await database.transaction(
    "rw",
    database.profiles,
    database.goals,
    async () => {
      await database.profiles.put(p);
      const existing = await database.goals
        .where("effectiveDate")
        .equals(g.effectiveDate)
        .first();
      if (existing) await database.goals.delete(existing.id);
      await database.goals.put(g);
    },
  );
}
export const findWeight = (date: string, database = db) =>
  database.weights.where("date").equals(date).first();
export const removeWeight = (id: string, database = db) =>
  database.weights.delete(id);
export const removeFood = (id: string, database = db) =>
  database.foods.delete(id);
export const removeTemplate = (id: string, database = db) =>
  database.templates.delete(id);
export async function saveMeal(
  meal: Meal,
  photo: Photo | null,
  removePhoto = false,
  database = db,
) {
  const parsed = mealSchema.parse({
    ...meal,
    snapshot: mealSnapshot(meal.lines),
    timestamp: wallTimestamp(meal.date, meal.time),
  });
  await database.transaction(
    "rw",
    database.meals,
    database.photos,
    database.days,
    async () => {
      const previous = await database.meals.get(parsed.id);
      if (photo) await database.photos.put(photo);
      if (
        removePhoto &&
        previous?.photoId &&
        previous.photoId !== parsed.photoId
      ) {
        const other = await database.meals
          .filter((m) => m.id !== parsed.id && m.photoId === previous.photoId)
          .count();
        if (!other) await database.photos.delete(previous.photoId);
      }
      await database.meals.put(parsed);
      const status = await database.days
        .where("date")
        .equals(parsed.date)
        .first();
      if (status)
        await database.days.update(status.id, {
          complete: false,
          updatedAt: new Date().toISOString(),
        });
      if (previous && previous.date !== parsed.date) {
        const old = await database.days
          .where("date")
          .equals(previous.date)
          .first();
        if (old)
          await database.days.update(old.id, {
            complete: false,
            updatedAt: new Date().toISOString(),
          });
      }
    },
  );
}
export async function deleteMeal(meal: Meal, database = db) {
  await database.transaction(
    "rw",
    database.meals,
    database.photos,
    database.days,
    async () => {
      await database.meals.delete(meal.id);
      if (
        meal.photoId &&
        !(await database.meals
          .filter((m) => m.photoId === meal.photoId)
          .count())
      )
        await database.photos.delete(meal.photoId);
      const d = await database.days.where("date").equals(meal.date).first();
      if (d)
        await database.days.update(d.id, {
          complete: false,
          updatedAt: new Date().toISOString(),
        });
    },
  );
}
export async function eraseAll(database = db) {
  await database.transaction("rw", database.tables, () =>
    Promise.all(database.tables.map((t) => t.clear())),
  );
}
export const defaultMealTime = (date: string) =>
  date === localDay() ? localTime() : "12:00";
export function storageError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const names: Record<string, string> = {
      height: "pituus (50–300 cm)",
      startWeight: "lähtöpaino (10–500 kg)",
      kg: "paino (10–500 kg)",
      age: "ikä (kokonaisluku 1–120)",
      training: "treenikerrat (kokonaisluku 0–30)",
      sleep: "uni (0–24 h)",
      steps: "askeleet (kokonaisluku 0–200 000)",
      hunger: "nälkä (1–5)",
      energy: "energia / vireys",
      name: "nimi",
      source: "tietojen lähde",
      grams: "määrä grammoina",
      date: "päivämäärä",
    };
    return (
      "Tarkista tiedot: " +
      error.issues
        .slice(0, 3)
        .map((i) => names[String(i.path.at(-1))] ?? i.path.join("."))
        .join(", ") +
      ". Luvut eivät saa olla negatiivisia; jätä tuntematon tieto tyhjäksi."
    );
  }
  if (error instanceof Error && /quota/i.test(error.name + error.message))
    return "Tallennustila on täynnä. Vie varmuuskopio ja vapauta tilaa tai poista suuria kuvia.";
  return error instanceof Error
    ? error.message
    : "Tallennus epäonnistui. Tarkista selaimen tallennusoikeudet.";
}
