// Kuvasta ateria (aiops ADR-0027): asiakaspuoli käsin kirjoitetuilla palvelinvastauksilla ja aterian muodostus.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  tulkitseKuva,
  ateriaKuvasta,
  ateriatyyppi,
  KUVA_ROOLIT,
  ROOLIN_NIMI,
  type KuvaTulos,
} from "../src/ai/kuva-ateria";
import { mealSchema, settingsSchema, stamped, id } from "../src/domain/model";
import { DiaryDB, saveMeal, readDataset, saveRecord } from "../src/data/db";

const vastaus = (runko: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => runko }) as Response;
const kuva = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: "image/jpeg" });
const tulos: KuvaTulos = {
  kind: "ateria",
  rooli: "kuva_tulkki_pilvi",
  draft: {
    schemaVersion: 1,
    name: "Lihapullat ja muusi",
    lines: [
      { name: "Lihapullat", mode: "portion", grams: 120,
        values: { energy: 280, protein: 18, carbs: 8, fat: 19, fiber: null }, source: "Kuvasta arvioitu annos", state: "" },
      { name: "Rahka", mode: "per100", grams: null,
        values: { energy: 63, protein: 11, carbs: 4.1, fat: 0.3, fiber: 0 }, source: "Tuoteseloste kuvasta", state: "" },
    ],
    unknowns: ["Lihapullat: kuitu"], assumptions: ["Muusissa on voita"], questions: ["Oliko kastiketta?"],
    provenance: { provider: "aiops-välittäjä / kuva_tulkki_pilvi", model: "gpt-testi", note: "Kuvasta tulkittu arvio." },
  },
};
const databases: DiaryDB[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});

describe("tulkitseKuva", () => {
  it("lähettää kuvan, roolin ja päivän multipart-pyyntönä ja validoi luonnoksen", async () => {
    const hae = vi.fn(async () => vastaus({ ...tulos, pvm: "2026-10-28" }));
    expect(await tulkitseKuva(kuva, "kuva_tulkki_pilvi", "2026-10-28", hae as unknown as typeof fetch)).toEqual(tulos);
    const [url, init] = hae.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/kuva-ateria");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    const runko = init.body as FormData;
    expect(runko.get("rooli")).toBe("kuva_tulkki_pilvi");
    expect(runko.get("pvm")).toBe("2026-10-28");
    expect((runko.get("kuva") as File).size).toBe(12);
  });

  it("näyttää palvelimen suomenkielisen virheen, 404:n ja kelvottoman vastauksen", async () => {
    await expect(tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", async () => vastaus({ virhe: "Viikon AI-budjetti on käytetty." }, 402)))
      .rejects.toThrow("Viikon AI-budjetti on käytetty.");
    await expect(tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", async () => vastaus({ virhe: "ei rajapintaa" }, 404)))
      .rejects.toThrow("ei ole käytössä tällä palvelimella");
    await expect(tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", async () => vastaus({}, 500)))
      .rejects.toThrow("palvelin vastasi 500");
    await expect(tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", async () => vastaus({ draft: { name: "x" }, kind: "ateria", rooli: "kuva_tulkki" })))
      .rejects.toThrow("vastaus ei kelpaa");
    await expect(tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", async () => { throw new TypeError("offline"); }))
      .rejects.toThrow("ei saada yhteyttä");
    await expect(tulkitseKuva(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]), "kuva_tulkki", "2026-10-28"))
      .rejects.toThrow("liian suuri");
  });
});

describe("ateriaKuvasta", () => {
  it("luo kelvollisen aterian ilman käyttäjän kenttiä: snapshot, alkuperä, oletukset ja 100 g per100-riville", async () => {
    const photo = { ...stamped(), blob: kuva };
    const meal = ateriaKuvasta(tulos, "2026-10-28", "12:30", photo);
    expect(() => mealSchema.parse(meal)).not.toThrow();
    expect(meal.type).toBe("Lounas");
    expect(meal.origin).toBe("Kuvasta (rooli kuva_tulkki_pilvi): ruoka-annos");
    expect(meal.note).toBe("Lihapullat ja muusi");
    expect(meal.lines.map((l) => [l.name, l.grams, l.foodId])).toEqual([["Lihapullat", 120, null], ["Rahka", 100, null]]);
    expect(meal.snapshot).toEqual({ energy: 343, protein: 29, carbs: 12.1, fat: 19.3, fiber: null });
    expect(meal.assumptions).toEqual([
      "Kuvasta (rooli kuva_tulkki_pilvi)", "Määrä oletettu 100 g: Rahka", "Alkuperän lisätieto: Kuvasta tulkittu arvio.",
      "Muusissa on voita", "Tuntematon: Lihapullat: kuitu", "Kysymys: Oliko kastiketta?",
    ]);
    expect(meal.photoId).toBe(photo.id);
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    await saveMeal(meal, photo, false, db);
    const data = await readDataset(db);
    expect(data.meals[0].snapshot.energy).toBe(343);
    expect(data.photos[0].id).toBe(photo.id);
  });

  it("merkitsee puuttuvan kuvan ja valitsee ateriatyypin kellonajasta", () => {
    const meal = ateriaKuvasta({ ...tulos, kind: "tuoteseloste" }, "2026-10-28", "21:00", null);
    expect(meal.photoId).toBeNull();
    expect(meal.origin).toBe("Kuvasta (rooli kuva_tulkki_pilvi): tuoteseloste");
    expect(meal.assumptions).toContain("Kuvaa ei tallennettu laitteelle.");
    expect(["07:30", "11:00", "15:00", "18:30", "21:00"].map(ateriatyyppi))
      .toEqual(["Aamiainen", "Lounas", "Välipala", "Päivällinen", "Iltapala"]);
  });
});

describe("kuvantulkinnan asetus", () => {
  it("tallentuu settings-tauluun ja puuttuva arvo tarkoittaa Hubin valintaa", async () => {
    expect(KUVA_ROOLIT).toEqual(["kuva_tulkki", "kuva_tulkki_pilvi", "kuva_tulkki_paikallinen"]);
    expect(ROOLIN_NIMI.kuva_tulkki).toBe("Hubin valinta (kuva_tulkki)");
    expect(settingsSchema.parse({ ...stamped(), theme: "system" }).kuvantulkinta).toBeUndefined();
    expect(() => settingsSchema.parse({ ...stamped(), theme: "system", kuvantulkinta: "gpt-4o" })).toThrow();
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    await saveRecord("settings", { ...stamped(), theme: "dark", kuvantulkinta: "kuva_tulkki_paikallinen" }, db);
    expect((await readDataset(db)).settings[0].kuvantulkinta).toBe("kuva_tulkki_paikallinen");
  });
});
