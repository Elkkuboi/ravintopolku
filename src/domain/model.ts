import { z } from "zod";
import "../zod-asetus"; // ennen ensimmäistä skeemaa: kaikki skeemamoduulit tuovat tämän tiedoston
export const TIMEZONE = "Europe/Helsinki";
export const APP_VERSION = "1.1.0";
export const keys = ["energy", "protein", "carbs", "fat", "fiber"] as const;
export type NutrientKey = (typeof keys)[number];
export const labels: Record<NutrientKey, string> = {
  energy: "Energia",
  protein: "Proteiini",
  carbs: "Hiilihydraatit",
  fat: "Rasva",
  fiber: "Kuitu",
};
const value = z.number().finite().min(0).max(100000).nullable();
export const nutrientsSchema = z
  .object({
    energy: value,
    protein: value,
    carbs: value,
    fat: value,
    fiber: value,
  })
  .strict();
export type Nutrients = z.infer<typeof nutrientsSchema>;
export const emptyNutrients = (): Nutrients => ({
  energy: null,
  protein: null,
  carbs: null,
  fat: null,
  fiber: null,
});
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }, "Virheellinen päivämäärä");
const stamp = {
  id: z.string().min(1).max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
const text = z.string().max(5000);
export const profileSchema = z
  .object({
    ...stamp,
    name: z.string().max(100),
    height: z.number().min(50).max(300),
    startWeight: z.number().min(10).max(500),
    startDate: daySchema,
    age: z.number().int().min(1).max(120).nullable(),
    activity: text,
    training: z.number().int().min(0).max(30),
    preferences: text,
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;
// Copies made during the profile preview can contain this unused local identifier.
const legacyDiary = { profiiliId: z.string().min(1).optional() };
// Tavoitealue: kuinka monta prosenttia päivä saa jäädä alle tavoitteen (alle) ja mennä sen yli (yli), jotta se
// lasketaan vielä osumaksi. Kokonaisia prosentteja; yli null = ei ylärajaa ("vähintään"-tavoite). Samat rajat
// tarkistaa palvelin tavoite-ehdotuksessa (palvelin/src/ravintopolku_palvelin/tavoitteet.py).
export const ALLE_MAX = 50,
  YLI_MAX = 100;
export const alueSchema = z
  .object({
    alle: z.number().int().min(0).max(ALLE_MAX),
    yli: z.number().int().min(0).max(YLI_MAX).nullable(),
  })
  .strict();
export type Alue = z.infer<typeof alueSchema>;
export const alueetSchema = z
  .object({
    energy: alueSchema,
    protein: alueSchema,
    carbs: alueSchema,
    fat: alueSchema,
    fiber: alueSchema,
  })
  .strict();
export type Alueet = z.infer<typeof alueetSchema>;
export const goalSchema = z
  .object({
    ...stamp,
    effectiveDate: daySchema,
    kind: z.enum(["lose", "maintain", "gain", "track"]),
    targetWeight: z.number().min(10).max(500).nullable(),
    targetDate: daySchema.nullable(),
    nutrients: nutrientsSchema,
    // Tavoitealueet (Asetukset tai Ilmarin ehdotus). Puuttuu vanhoista tavoitteista: silloin oletusalueet
    // (domain/nutrition.ts OLETUSALUEET).
    alueet: alueetSchema.optional(),
    ...legacyDiary,
  })
  .strict()
  .superRefine((g, c) => {
    if (
      (g.kind === "lose" || g.kind === "gain") &&
      (!g.targetWeight || !g.targetDate)
    )
      c.addIssue({
        code: "custom",
        message: "Painotavoite tarvitsee painon ja päivämäärän",
      });
  });
export type Goal = z.infer<typeof goalSchema>;
export const foodSchema = z
  .object({
    ...stamp,
    name: z.string().min(1).max(200),
    state: z.string().max(100),
    source: z.string().min(1).max(500),
    per100: nutrientsSchema,
    favorite: z.boolean(),
    ...legacyDiary,
  })
  .strict();
export type Food = z.infer<typeof foodSchema>;
export const rawLineSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    foodId: z.string().nullable(),
    mode: z.enum(["per100", "portion"]),
    grams: z.number().positive().max(100000).nullable(),
    values: nutrientsSchema,
    source: z.string().min(1).max(500),
    state: z.string().max(100),
  })
  .strict();
export const lineSchema = rawLineSchema.refine(
  (l) => l.mode === "portion" || l.grams !== null,
  "Anna määrä grammoina",
);
export type MealLine = z.infer<typeof lineSchema>;
export const mealSchema = z
  .object({
    ...stamp,
    date: daySchema,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timestamp: z.iso.datetime(),
    timezone: z.literal(TIMEZONE),
    type: z.enum([
      "Aamiainen",
      "Lounas",
      "Päivällinen",
      "Välipala",
      "Iltapala",
      "Muu",
    ]),
    lines: z.array(lineSchema).min(1).max(100),
    snapshot: nutrientsSchema,
    note: text,
    origin: z.string().min(1).max(500),
    assumptions: z.array(text).max(302),
    photoId: z.string().nullable(),
    ...legacyDiary,
  })
  .strict();
export type Meal = z.infer<typeof mealSchema>;
export const templateSchema = z
  .object({
    ...stamp,
    name: z.string().min(1).max(200),
    lines: z.array(lineSchema).min(1).max(100),
    type: mealSchema.shape.type,
    ...legacyDiary,
  })
  .strict();
export type MealTemplate = z.infer<typeof templateSchema>;
// Päivän paino on aina valinnainen ja tallennetaan kiloina yhden desimaalin
// tarkkuudella. Koodi pyöristää, ei käyttöliittymä: samasta luvusta tulee
// aina samanarvoinen kirjaus, oli sen täyttänyt ihminen tai kone.
export const PAINO_MIN = 10,
  PAINO_MAX = 500;
export const pyöristäPaino = (kg: number) => Number(kg.toFixed(1));
export const weightSchema = z
  .object({
    ...stamp,
    date: daySchema,
    kg: z.number().min(PAINO_MIN).max(PAINO_MAX).transform(pyöristäPaino),
    note: text,
    ...legacyDiary,
  })
  .strict();
export type Weight = z.infer<typeof weightSchema>;
export const lifestyleSchema = z
  .object({
    ...stamp,
    date: daySchema,
    steps: z.number().int().min(0).max(200000).nullable(),
    sleep: z.number().min(0).max(24).nullable(),
    training: text,
    hunger: z.number().int().min(1).max(5).nullable(),
    energy: z.number().int().min(1).max(5).nullable(),
    // Treenipäivä (Tänään-sivun valinta). Puuttuu vanhoista kirjauksista: puuttuva on sama kuin ei.
    trainingDay: z.boolean().optional(),
    ...legacyDiary,
  })
  .strict();
export type Lifestyle = z.infer<typeof lifestyleSchema>;
/** Päivän kentät, joita Tänään-sivu muuttaa: lomake (uni, liike ja olo) ja treenipäivän valinta erikseen. */
export type LifestyleFields = Partial<
  Pick<
    Lifestyle,
    "steps" | "sleep" | "training" | "hunger" | "energy" | "trainingDay"
  >
>;
export const dayStatusSchema = z
  .object({ ...stamp, date: daySchema, complete: z.boolean(), ...legacyDiary })
  .strict();
export type DayStatus = z.infer<typeof dayStatusSchema>;
// kuvantulkinta: Kuvasta ateria -toiminnon rooli aiops-välittäjälle (ADR-0027); puuttuva = kuva_tulkki (Hubin valinta).
export const kuvaRooliSchema = z.enum([
  "kuva_tulkki",
  "kuva_tulkki_pilvi",
  "kuva_tulkki_paikallinen",
]);
// kuvantunnistus (ja kuvantulkinta yllä): vanha tallennettu valinta (ilmari/api, rooli). Skeema säilyy datan vuoksi,
// mutta arvo ohitetaan: kuva lähtee aina roolilla kuva_tulkki (src/ai/kuva-ateria.ts).
export const kuvaLahdeSchema = z.enum(["ilmari", "api"]);
export type KuvaLahde = z.infer<typeof kuvaLahdeSchema>;
export const settingsSchema = z
  .object({
    ...stamp,
    theme: z.enum(["light", "dark", "system"]),
    kuvantulkinta: kuvaRooliSchema.optional(),
    kuvantunnistus: kuvaLahdeSchema.optional(),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export interface Photo {
  id: string;
  createdAt: string;
  updatedAt: string;
  blob: Blob;
}
export interface Dataset {
  profiles: Profile[];
  goals: Goal[];
  foods: Food[];
  meals: Meal[];
  templates: MealTemplate[];
  weights: Weight[];
  lifestyles: Lifestyle[];
  days: DayStatus[];
  settings: Settings[];
  photos: Photo[];
}
export const emptyDataset = (): Dataset => ({
  profiles: [],
  goals: [],
  foods: [],
  meals: [],
  templates: [],
  weights: [],
  lifestyles: [],
  days: [],
  settings: [],
  photos: [],
});
export const id = () => crypto.randomUUID();
export const stamped = (existing?: { id: string; createdAt: string }) => ({
  id: existing?.id ?? id(),
  createdAt: existing?.createdAt ?? new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
export function numberInput(input: string, optional = false): number | null {
  const s = input.trim().replace(",", ".");
  if (!s && optional) return null;
  if (!/^\d+(\.\d+)?$/.test(s))
    throw new Error("Anna positiivinen numero. Desimaalipilkku on sallittu.");
  const n = Number(s);
  if (!Number.isFinite(n) || n > 100000)
    throw new Error("Tarkista luvun suuruus.");
  return n;
}
