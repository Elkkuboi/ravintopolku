import { z } from "zod";
import {
  profileSchema,
  goalSchema,
  foodSchema,
  mealSchema,
  templateSchema,
  weightSchema,
  lifestyleSchema,
  dayStatusSchema,
  settingsSchema,
  TIMEZONE,
  APP_VERSION,
  type Dataset,
  type Photo,
} from "../domain/model";
import { db, readDataset, tableNames, type DiaryDB } from "./db";
import { wallTimestamp } from "../domain/dates";
import { mealSnapshot } from "../domain/nutrition";
const photoSchema = z
  .object({
    id: z.string().min(1).max(100),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
    base64: z
      .string()
      .max(2800000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((s) => s.length % 4 === 0, "Virheellinen base64-kuva"),
  })
  .strict();
export const backupSchema = z
  .object({
    schemaVersion: z.literal(1),
    appVersion: z.string(),
    exportedAt: z.iso.datetime(),
    timezone: z.literal(TIMEZONE),
    data: z
      .object({
        profiles: z.array(profileSchema).max(1),
        goals: z.array(goalSchema),
        foods: z.array(foodSchema),
        meals: z.array(mealSchema),
        templates: z.array(templateSchema),
        weights: z.array(weightSchema),
        lifestyles: z.array(lifestyleSchema),
        days: z.array(dayStatusSchema),
        settings: z.array(settingsSchema).max(1),
        photos: z.array(photoSchema),
      })
      .strict(),
  })
  .strict();
export type Backup = z.infer<typeof backupSchema>;
export async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function base64Blob(data: string, mime: string): Blob {
  const s = atob(data);
  return new Blob([Uint8Array.from(s, (c) => c.charCodeAt(0))], { type: mime });
}
function imageSignature(photo: Backup["data"]["photos"][number]) {
  const bytes = Uint8Array.from(atob(photo.base64).slice(0, 12), (c) =>
    c.charCodeAt(0),
  );
  return photo.mime === "image/jpeg"
    ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : photo.mime === "image/png"
      ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
      : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}
export function parseBackup(text: string): Backup {
  if (text.length > 100 * 1024 * 1024)
    throw new Error("Varmuuskopio on liian suuri (enintään 100 Mt).");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Tiedosto ei ole kelvollinen JSON-varmuuskopio.");
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "Varmuuskopion versio tai sisältö ei kelpaa. Nykyisiä tietoja ei muutettu. " +
        parsed.error.issues
          .slice(0, 2)
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("; "),
    );
  const b = parsed.data;
  for (const table of tableNames) {
    const seen = new Set<string>();
    for (const row of b.data[table]) {
      if (seen.has(row.id))
        throw new Error("Varmuuskopiossa on päällekkäinen tunniste.");
      seen.add(row.id);
    }
  }
  for (const table of ["weights", "lifestyles", "days"] as const) {
    const dates = b.data[table].map((r) => r.date);
    if (new Set(dates).size !== dates.length)
      throw new Error("Päivälle on päällekkäisiä kirjauksia.");
  }
  if (
    new Set(b.data.goals.map((g) => g.effectiveDate)).size !==
    b.data.goals.length
  )
    throw new Error("Samalle voimaantulopäivälle on useita tavoitteita.");
  for (const photo of b.data.photos)
    if (
      !imageSignature(photo) ||
      !photo.base64 ||
      atob(photo.base64).length > 2 * 1024 * 1024
    )
      throw new Error("Varmuuskopiossa on virheellinen kuva.");
  const photos = new Set(b.data.photos.map((p) => p.id));
  for (const m of b.data.meals) {
    if (m.photoId && !photos.has(m.photoId))
      throw new Error("Aterian kuva puuttuu varmuuskopiosta.");
    if (m.timestamp !== wallTimestamp(m.date, m.time))
      throw new Error("Aterian ajankohta ei vastaa Helsingin aikaa.");
    if (JSON.stringify(m.snapshot) !== JSON.stringify(mealSnapshot(m.lines)))
      throw new Error("Aterian laskenta ei vastaa snapshotia.");
  }
  return b;
}
export async function exportBackup(database = db): Promise<Backup> {
  const data = await readDataset(database);
  return {
    schemaVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    timezone: TIMEZONE,
    data: {
      ...data,
      photos: await Promise.all(
        data.photos.map(async ({ blob, ...p }) => ({
          ...p,
          mime: blob.type as "image/jpeg" | "image/png" | "image/webp",
          base64: await blobBase64(blob),
        })),
      ),
    },
  };
}
export async function restoreBackup(input: Backup, database: DiaryDB = db) {
  const b = parseBackup(JSON.stringify(input));
  const photos: Photo[] = b.data.photos.map(({ base64, mime, ...p }) => ({
    ...p,
    blob: base64Blob(base64, mime),
  }));
  // Decode outside the IndexedDB transaction: arbitrary async work would close it.
  if (typeof createImageBitmap === "function") {
    for (const photo of photos) {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(photo.blob);
      } catch {
        throw new Error(
          "Varmuuskopion kuvaa ei voitu avata. Nykyisiä tietoja ei muutettu.",
        );
      }
      const valid =
        bitmap.width > 0 &&
        bitmap.height > 0 &&
        bitmap.width * bitmap.height <= 80_000_000;
      bitmap.close();
      if (!valid) throw new Error("Varmuuskopion kuvan koko ei kelpaa.");
    }
  }
  const data: Dataset = { ...b.data, photos };
  await database.transaction("rw", database.tables, async () => {
    for (const table of tableNames) {
      await database.table(table).clear();
      if (data[table].length) await database.table(table).bulkPut(data[table]);
    }
  });
}
export function download(
  content: Blob | string,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(
    typeof content === "string" ? new Blob([content], { type }) : content,
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
