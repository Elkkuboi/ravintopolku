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
  type Profiili,
  type Luonnos,
  emptyDataset,
  profiiliSkeema,
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
  profiilit!: EntityTable<Profiili, "id">;
  luonnokset!: EntityTable<Luonnos, "id">;
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
    // Profiilit (käyttäjätilit) ja aterian luonnokset; olemassa oleva data siirretään oletusprofiiliin.
    this.version(3).stores({
      profiilit: "id,&aktiivinen",
      luonnokset: "id,&profiiliId",
    }).upgrade(async (db) => {
      const id = crypto.randomUUID();
      await db.table("profiilit").put({
        id, name: "Oletus", aktiivinen: true, luotu: new Date().toISOString(),
      });
      const taulut = ["profiles", "goals", "foods", "meals", "templates", "weights", "lifestyles", "days"];
      await Promise.all(taulut.map(async (t) => {
        const rivit = await db.table(t).toArray();
        for (const r of rivit) if (!("profiiliId" in r)) r.profiiliId = id;
        await db.table(t).bulkPut(rivit);
      }));
    });
  }
}
export const db = new DiaryDB();
// Taulut, joita readDataset lukee. Profiilit ja luonnokset ovat paikallisia: niitä ei synkronoida
// palvelimeen, joten ne eivät ole SYNKATTAVAT-listalla, mutta ovat Datasetin mukana UI:lle.
export const tableNames = Object.keys(emptyDataset()) as (keyof Dataset)[];
export async function readDataset(database = db): Promise<Dataset> {
  const lists = await database.transaction("r", database.tables, () =>
    Promise.all(tableNames.map((t) => database.table(t).toArray())),
  );
  return Object.fromEntries(
    tableNames.map((name, i) => [name, lists[i]]),
  ) as unknown as Dataset;
}
/** Palauttaa kaikki profiilit; aktiivinen ensimmäisenä. Jos profiileja ei ole, luodaan oletusprofiili. */
export async function listProfiilit(database = db): Promise<Profiili[]> {
  const lista = await database.table("profiilit").toArray();
  if (!lista.length) {
    const oletus = { id: crypto.randomUUID(), name: "Oletus", aktiivinen: true, luotu: new Date().toISOString() };
    await database.table("profiilit").put(oletus);
    return [oletus];
  }
  // Aktiivinen ensin, loput luomispäivämäärän mukaan.
  return [...lista].sort((a, b) =>
    (b.aktiivinen ? 1 : 0) - (a.aktiivinen ? 1 : 0) || a.luotu.localeCompare(b.luotu),
  );
}
/** Valitsee profiilin aktiiviseksi. Muutetaan vain profiilit-taulua; synkronointi käynnistyy uudelleen. */
export async function setAktiivinenProfiili(id: string, database = db): Promise<Profiili | null> {
  return database.transaction("rw", database.table("profiilit"), async () => {
    const kaikki = await database.table("profiilit").toArray();
    for (const p of kaikki) {
      const uudeh = { ...p, aktiivinen: p.id === id };
      await database.table("profiilit").put(uudeh);
    }
    return (await database.table("profiilit").get(id)) ?? null;
  });
}
/** Luo uuden profiilin. Jos se on ensimmäinen, se on aktiivinen; muuten ei. */
export async function luoProfiili(nimi: string, database = db): Promise<Profiili> {
  return database.transaction("rw", database.table("profiilit"), async () => {
    const kaikki = await database.table("profiilit").toArray();
    const profiili: Profiili = {
      id: crypto.randomUUID(),
      name: nimi,
      aktiivinen: kaikki.length === 0,
      luotu: new Date().toISOString(),
    };
    await database.table("profiilit").put(profiili);
    return profiili;
  });
}
/** Poistaa profiilin. Profiili ei poista sen alla olevaa dataa (ateriat, painot). */
export async function poistaProfiili(id: string, database = db): Promise<void> {
  await database.table("profiilit").delete(id);
}
/** Aktiivisen profiilin tunniste; tarvitaan tietueiden profiilikenttään. */
export async function aktiivinenProfiiliId(database = db): Promise<string> {
  const lista = await database.table("profiilit").toArray();
  const aktiivinen = lista.find((p) => p.aktiivinen);
  if (aktiivinen) return aktiivinen.id;
  if (!lista.length) {
    const oletus: Profiili = {
      id: crypto.randomUUID(),
      name: "Oletus",
      aktiivinen: true,
      luotu: new Date().toISOString(),
    };
    await database.table("profiilit").put(oletus);
    return oletus.id;
  }
  const ensimmainen = lista[0];
  await database.table("profiilit").put({ ...ensimmainen, aktiivinen: true });
  return ensimmainen.id;
}
/** API-avain (joka mahdollisesti jaetaan kaverille) tallennetaan localStorageiin. */
const AVAIN = "ravintopolku-api-avain";
export function getAPIAvain(): string {
  try { return localStorage.getItem(AVAIN) ?? ""; } catch { return ""; }
}
export function setAPIAvain(avain: string): void {
  try { localStorage.setItem(AVAIN, avain); } catch { /* ohita, esim. private mode */ }
}
export async function saveRecord<K extends Exclude<keyof Dataset, "photos">>(
  table: K,
  record: Omit<Dataset[K][number], "profiiliId"> & { profiiliId?: string },
  database = db,
) {
  const schemas = {
    profiilit: profiiliSkeema,
    profiles: profileSchema,
    goals: goalSchema,
    foods: foodSchema,
    meals: mealSchema,
    templates: templateSchema,
    weights: weightSchema,
    lifestyles: lifestyleSchema,
    days: dayStatusSchema,
    settings: settingsSchema,
  } as const;
  const PROFILITARVITTEEN = new Set(["goals", "foods", "meals", "templates", "weights", "lifestyles", "days"]);
  const rekordi = record as { profiiliId?: string };
  const rivi = PROFILITARVITTEEN.has(table)
    ? { ...rekordi, profiiliId: rekordi.profiiliId ?? (await aktiivinenProfiiliId(database)) }
    : rekordi;
  const skeema = schemas[table as keyof typeof schemas];
  const parsed = skeema.parse(rivi);
  await database.table(table).put(parsed);
}
// These operations keep IndexedDB details out of forms.
/** Korvaa päivän tavoitteen profiilia koskematta. Ilmarin tavoite-ehdotus hyväksytään tästä. */
export async function saveGoal(goal: Omit<Goal, "profiiliId"> & { profiiliId?: string }, database = db) {
  const g = goalSchema.parse({
    ...goal,
    profiiliId: goal.profiiliId ?? (await aktiivinenProfiiliId(database)),
  });
  await database.transaction("rw", database.goals, async () => {
    const existing = await database.goals
      .where("effectiveDate")
      .equals(g.effectiveDate)
      .first();
    if (existing) await database.goals.delete(existing.id);
    await database.goals.put(g);
  });
}
export const findWeight = (date: string, database = db) =>
  database.weights.where("date").equals(date).first();
export const removeWeight = (id: string, database = db) =>
  database.weights.delete(id);
export const removeFood = (id: string, database = db) =>
  database.foods.delete(id);
export async function saveMeal(
  meal: Omit<Meal, "profiiliId"> & { profiiliId?: string },
  photo: Photo | null,
  removePhoto = false,
  database = db,
) {
  const parsed = mealSchema.parse({
    ...meal,
    snapshot: mealSnapshot(meal.lines),
    timestamp: wallTimestamp(meal.date, meal.time),
    profiiliId: meal.profiiliId ?? (await aktiivinenProfiiliId(database)),
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
