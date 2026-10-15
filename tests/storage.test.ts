import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import { DiaryDB, saveMeal, readDataset } from "../src/data/db";
import { exportBackup, parseBackup, restoreBackup } from "../src/data/backup";
import { stamped, emptyNutrients, id } from "../src/domain/model";
import { csvExports } from "../src/data/csv";
import { meal } from "./fixtures";
import { parseDraft } from "../src/ai/provider";
const databases: DiaryDB[] = [];
const database = () => {
  const d = new DiaryDB("test-" + id());
  databases.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});
describe("IndexedDB ja varmuuskopiot", () => {
  it("ruokakirjaston muokkaus ei muuta aiempaa ateriaa", async () => {
    const db = database();
    const food = {
      ...stamped(),
      name: "Ruoka",
      state: "kypsä",
      source: "Pakkaus",
      per100: { ...emptyNutrients(), energy: 200 },
      favorite: false,
    };
    await db.foods.put(food);
    const m = meal();
    m.lines[0].foodId = food.id;
    await saveMeal(m, null, false, db);
    await db.foods.update(food.id, {
      per100: { ...emptyNutrients(), energy: 900 },
    });
    expect((await db.meals.get(m.id))?.snapshot.energy).toBe(300);
  });
  it("varmuuskopio palauttaa blob-kuvan, aterian ja null-arvot", async () => {
    const db = database(),
      target = database();
    const imageBytes = new Uint8Array(readFileSync("public/icon-192.png"));
    const photo = {
      ...stamped(),
      blob: new Blob([imageBytes], { type: "image/png" }),
    };
    const m = meal();
    m.photoId = photo.id;
    await saveMeal(m, photo, false, db);
    const backup = await exportBackup(db);
    await restoreBackup(parseBackup(JSON.stringify(backup)), target);
    const p = await target.photos.get(photo.id);
    expect(new Uint8Array(await p!.blob.arrayBuffer())).toEqual(imageBytes);
    expect((await target.meals.get(m.id))?.snapshot.fiber).toBeNull();
  });
  it("tuntematon versio ja rikkinäinen kuva eivät muuta tietokantaa", async () => {
    const db = database();
    await saveMeal(meal(), null, false, db);
    const b = await exportBackup(db);
    expect(() =>
      parseBackup(JSON.stringify({ ...b, schemaVersion: 99 })),
    ).toThrow();
    b.data.photos = [{ ...stamped(), mime: "image/png", base64: "aGk=" }];
    await expect(restoreBackup(b, db)).rejects.toThrow();
    expect(await db.meals.count()).toBe(1);
  });
  it("virheellinen AI-tuonti ei tallennu", async () => {
    const db = database();
    expect(() => parseDraft('{"schemaVersion":1,"lines":[]}')).toThrow();
    expect(await db.meals.count()).toBe(0);
  });
  it("päivän painomittaus on yksilöllinen ja palautus on atominen", async () => {
    const db = database();
    await db.weights.put({
      ...stamped(),
      date: "2026-10-02",
      kg: 75,
      note: "",
    });
    await expect(
      db.weights.add({ ...stamped(), date: "2026-10-02", kg: 80, note: "" }),
    ).rejects.toThrow();
    const original = await exportBackup(db);
    const corrupt = structuredClone(original);
    corrupt.data.weights.push({
      ...stamped(),
      date: "2026-10-02",
      kg: 80,
      note: "",
    });
    await expect(restoreBackup(corrupt, db)).rejects.toThrow();
    expect((await db.weights.toArray())[0].kg).toBe(75);
  });
  it("kirjoituksen aikainen virhe peruu myös aiemmin palautetut taulut", async () => {
    const db = database();
    await saveMeal(meal(), null, false, db);
    await db.weights.put({
      ...stamped(),
      date: "2026-10-02",
      kg: 75,
      note: "",
    });
    const b = await exportBackup(db);
    const extra = {
      ...stamped(),
      name: "Säilyvä ruoka",
      state: "",
      source: "Pakkaus",
      per100: emptyNutrients(),
      favorite: false,
    };
    await db.foods.put(extra);
    db.weights.hook("creating", () => {
      throw new Error("Simuloitu tallennusvirhe");
    });
    await expect(restoreBackup(b, db)).rejects.toThrow("Simuloitu");
    expect(await db.foods.get(extra.id)).toEqual(extra);
    expect(await db.meals.count()).toBe(1);
    expect((await db.weights.toArray())[0].kg).toBe(75);
  });
  it("CSV sisältää yksiköt, kattavuuden, alkuperän ja tyhjät arvot", async () => {
    const db = database();
    await saveMeal(meal(), null, false, db);
    const csv = csvExports(await readDataset(db));
    expect(csv.meals).toContain("energy_kcal");
    expect(csv.meals).toContain("Europe/Helsinki");
    expect(csv.meals).toContain('"300","15",,,,');
    expect(csv.days).toContain("fiber_partial");
  });
});
