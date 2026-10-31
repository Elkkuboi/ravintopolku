// Kuvasta ateria (aiops ADR-0027): asiakaspuoli käsin kirjoitetuilla palvelinvastauksilla ja aterian muodostus.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  tulkitseKuva,
  ateriaKuvasta,
  ateriatyyppi,
  siistiLisatiedot,
  KUVA_ROOLIT,
  LISATIEDOT_MAX,
  ROOLIN_NIMI,
  type KuvaTulos,
} from "../src/ai/kuva-ateria";
import { mealSchema, settingsSchema, stamped, id } from "../src/domain/model";
import { DiaryDB, saveMeal, readDataset, saveRecord } from "../src/data/db";

const vastaus = (runko: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => runko,
  }) as Response;
const kuva = new Blob(
  [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])],
  { type: "image/jpeg" },
);
const tulos: KuvaTulos = {
  kind: "ateria",
  rooli: "kuva_tulkki_pilvi",
  draft: {
    schemaVersion: 1,
    name: "Lihapullat ja muusi",
    lines: [
      {
        name: "Lihapullat",
        mode: "portion",
        grams: 120,
        values: { energy: 280, protein: 18, carbs: 8, fat: 19, fiber: null },
        source: "Kuvasta arvioitu annos",
        state: "",
      },
      {
        name: "Rahka",
        mode: "per100",
        grams: null,
        values: { energy: 63, protein: 11, carbs: 4.1, fat: 0.3, fiber: 0 },
        source: "Tuoteseloste kuvasta",
        state: "",
      },
    ],
    unknowns: ["Lihapullat: kuitu"],
    assumptions: ["Muusissa on voita"],
    questions: ["Oliko kastiketta?"],
    provenance: {
      provider: "aiops-välittäjä / kuva_tulkki_pilvi",
      model: "gpt-testi",
      note: "Kuvasta tulkittu arvio.",
    },
  },
};
// Vapaat lisätiedot raakana tekstikentän syötteenä ja sellaisena kuin ne menevät välittäjälle ja ateriaan.
const lisatiedotRaaka =
  " leivässä on kaksi\n  viipaletta Oltermanni light -juustoa  ";
const lisatiedotSiisti =
  "leivässä on kaksi viipaletta Oltermanni light -juustoa";
const databases: DiaryDB[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});

describe("tulkitseKuva", () => {
  it("lähettää kuvan, roolin ja päivän multipart-pyyntönä ja validoi luonnoksen", async () => {
    const hae = vi.fn(async () => vastaus({ ...tulos, pvm: "2026-10-28" }));
    expect(
      await tulkitseKuva(
        kuva,
        "kuva_tulkki_pilvi",
        "2026-10-28",
        "",
        hae as unknown as typeof fetch,
      ),
    ).toEqual(tulos);
    const [url, init] = hae.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/kuva-ateria");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    const runko = init.body as FormData;
    expect(runko.get("rooli")).toBe("kuva_tulkki_pilvi");
    expect(runko.get("pvm")).toBe("2026-10-28");
    expect((runko.get("kuva") as File).size).toBe(12);
    expect(runko.get("vihje")).toBeNull(); // tyhjiä lisätietoja ei lähetetä kenttää tyhjänä
  });

  it("lähettää vapaat lisätiedot kuvan mukana palvelimen vihje-kenttänä", async () => {
    const hae = vi.fn(async () => vastaus({ ...tulos, pvm: "2026-10-28" }));
    await tulkitseKuva(
      kuva,
      "kuva_tulkki",
      "2026-10-28",
      lisatiedotRaaka,
      hae as unknown as typeof fetch,
    );
    const runko = (hae.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as FormData;
    expect(runko.get("vihje")).toBe(lisatiedotSiisti); // siistittynä, ei tyhjänä eivätkä rivinvaihdot riko kenttää
    expect(runko.get("kuva")).toBeTruthy(); // sama pyyntö: teksti ei korvaa kuvaa
  });

  it("hylkää liian pitkät lisätiedot lähettämättä kuvaa ollenkaan", async () => {
    const hae = vi.fn(async () => vastaus(tulos));
    await expect(
      tulkitseKuva(
        kuva,
        "kuva_tulkki",
        "2026-10-28",
        "a".repeat(LISATIEDOT_MAX + 1),
        hae as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      `Lisätiedot saavat olla enintään ${LISATIEDOT_MAX} merkkiä.`,
    );
    expect(hae).not.toHaveBeenCalled();
    expect(siistiLisatiedot("a".repeat(LISATIEDOT_MAX))).toHaveLength(
      LISATIEDOT_MAX,
    );
    expect(LISATIEDOT_MAX).toBe(300); // sama raja kuin palvelimen VIHJE_MAX
  });

  it("rajalla olevat lisätiedot menevät sellaisinaan välittäjälle ja näkyvät ateriaan asti", async () => {
    // Selaimen piirroksen raja on sama kuin palvelimen VIHJE_MAX, joten näin ei koskaan saa 400-vastausta.
    const rajanTeksti = "a".repeat(LISATIEDOT_MAX);
    const hae = vi.fn(async () => vastaus({ ...tulos, pvm: "2026-10-28" }));
    await tulkitseKuva(
      kuva,
      "kuva_tulkki",
      "2026-10-28",
      rajanTeksti,
      hae as unknown as typeof fetch,
    );
    const runko = (hae.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as FormData;
    expect(runko.get("vihje")).toBe(rajanTeksti);
    const meal = ateriaKuvasta(tulos, "2026-10-28", "12:30", null, rajanTeksti);
    expect(() => mealSchema.parse(meal)).not.toThrow();
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    await saveMeal(meal, null, false, db);
    const [tallennettu] = (await readDataset(db)).meals;
    expect(tallennettu.assumptions).toContain(`Lisätiedot: ${rajanTeksti}`);
  });

  it("näyttää palvelimen suomenkielisen virheen, 404:n ja kelvottoman vastauksen", async () => {
    await expect(
      tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", "", async () =>
        vastaus({ virhe: "Viikon AI-budjetti on käytetty." }, 402),
      ),
    ).rejects.toThrow("Viikon AI-budjetti on käytetty.");
    await expect(
      tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", "", async () =>
        vastaus({ virhe: "ei rajapintaa" }, 404),
      ),
    ).rejects.toThrow("ei ole käytössä tällä palvelimella");
    await expect(
      tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", "", async () =>
        vastaus({}, 500),
      ),
    ).rejects.toThrow("palvelin vastasi 500");
    await expect(
      tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", "", async () =>
        vastaus({ draft: { name: "x" }, kind: "ateria", rooli: "kuva_tulkki" }),
      ),
    ).rejects.toThrow("vastaus ei kelpaa");
    await expect(
      tulkitseKuva(kuva, "kuva_tulkki", "2026-10-28", "", async () => {
        throw new TypeError("offline");
      }),
    ).rejects.toThrow("ei saada yhteyttä");
    await expect(
      tulkitseKuva(
        new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]),
        "kuva_tulkki",
        "2026-10-28",
      ),
    ).rejects.toThrow("liian suuri");
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
    expect(meal.lines.map((l) => [l.name, l.grams, l.foodId])).toEqual([
      ["Lihapullat", 120, null],
      ["Rahka", 100, null],
    ]);
    expect(meal.snapshot).toEqual({
      energy: 343,
      protein: 29,
      carbs: 12.1,
      fat: 19.3,
      fiber: null,
    });
    expect(meal.assumptions).toEqual([
      "Kuvasta (rooli kuva_tulkki_pilvi)",
      "Määrä oletettu 100 g: Rahka",
      "Alkuperän lisätieto: Kuvasta tulkittu arvio.",
      "Muusissa on voita",
      "Tuntematon: Lihapullat: kuitu",
      "Kysymys: Oliko kastiketta?",
    ]);
    expect(meal.photoId).toBe(photo.id);
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    await saveMeal(meal, photo, false, db);
    const data = await readDataset(db);
    expect(data.meals[0].snapshot.energy).toBe(343);
    expect(data.photos[0].id).toBe(photo.id);
  });

  it("jättää kuvan mukana tulleet lisätiedot ateriaan samana tekstinä kuin välittäjälle meni", () => {
    const meal = ateriaKuvasta(
      tulos,
      "2026-10-28",
      "12:30",
      null,
      lisatiedotRaaka,
    );
    expect(() => mealSchema.parse(meal)).not.toThrow();
    expect(meal.assumptions).toEqual([
      "Kuvasta (rooli kuva_tulkki_pilvi)",
      "Lisätiedot: " + lisatiedotSiisti,
      "Määrä oletettu 100 g: Rahka",
      "Kuvaa ei tallennettu laitteelle.",
      "Alkuperän lisätieto: Kuvasta tulkittu arvio.",
      "Muusissa on voita",
      "Tuntematon: Lihapullat: kuitu",
      "Kysymys: Oliko kastiketta?",
    ]);
    expect(meal.note).toBe("Lihapullat ja muusi"); // lisätiedot eivät peitä luonnoksen nimeä
    expect(
      meal.assumptions.filter((a) => a.startsWith("Lisätiedot:")),
    ).toHaveLength(1);
    expect(
      ateriaKuvasta(
        tulos,
        "2026-10-28",
        "12:30",
        null,
        "  \n ",
      ).assumptions.some((a) => a.startsWith("Lisätiedot:")),
    ).toBe(false);
    expect(
      ateriaKuvasta(tulos, "2026-10-28", "12:30", null).assumptions[0],
    ).toBe("Kuvasta (rooli kuva_tulkki_pilvi)");
  });

  it("merkitsee puuttuvan kuvan ja valitsee ateriatyypin kellonajasta", () => {
    const meal = ateriaKuvasta(
      { ...tulos, kind: "tuoteseloste" },
      "2026-10-28",
      "21:00",
      null,
    );
    expect(meal.photoId).toBeNull();
    expect(meal.origin).toBe("Kuvasta (rooli kuva_tulkki_pilvi): tuoteseloste");
    expect(meal.assumptions).toContain("Kuvaa ei tallennettu laitteelle.");
    expect(
      ["07:30", "11:00", "15:00", "18:30", "21:00"].map(ateriatyyppi),
    ).toEqual(["Aamiainen", "Lounas", "Välipala", "Päivällinen", "Iltapala"]);
  });
});

describe("kuvantulkinnan asetus", () => {
  it("tallentuu settings-tauluun ja puuttuva arvo tarkoittaa Hubin valintaa", async () => {
    expect(KUVA_ROOLIT).toEqual([
      "kuva_tulkki",
      "kuva_tulkki_pilvi",
      "kuva_tulkki_paikallinen",
    ]);
    expect(ROOLIN_NIMI.kuva_tulkki).toBe("Hubin valinta (kuva_tulkki)");
    expect(
      settingsSchema.parse({ ...stamped(), theme: "system" }).kuvantulkinta,
    ).toBeUndefined();
    expect(() =>
      settingsSchema.parse({
        ...stamped(),
        theme: "system",
        kuvantulkinta: "gpt-4o",
      }),
    ).toThrow();
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    await saveRecord(
      "settings",
      { ...stamped(), theme: "dark", kuvantulkinta: "kuva_tulkki_paikallinen" },
      db,
    );
    expect((await readDataset(db)).settings[0].kuvantulkinta).toBe(
      "kuva_tulkki_paikallinen",
    );
  });
});

// Kotinäkymän Kuvaa ateria -osa on Reactia, jota vitest (node-ympäristö) ei renderöi, joten sen
// rakenne tarkistetaan lähteestä. Selainajo (tests/e2e) käyttää oikeaa DOMia, kun Chromium on asennettu.
describe("Kuvaa ateria -näkymä", () => {
  const lahde = readFileSync("src/App.tsx", "utf8");
  const osa =
    /<section className="card kuva-ateria">[\s\S]*?<\/section>/.exec(
      lahde,
    )?.[0] ?? "";
  it("ottaa kuvan kameralla tai valitsee sen galleriasta: pakotettua kameraa ei ole", () => {
    expect(osa).toContain('type="file"');
    expect(osa).not.toContain("capture");
    expect(osa).toContain('accept="image/*"'); // valitsin tarjoaa sekä kameran että gallerian
    expect(osa).toMatch(/Ota kuva kameralla tai valitse\s+se galleriasta/);
  });
  it("antaa vapaan tekstikentän lisätiedoille ja vie ne sekä välittäjälle että ateriaan", () => {
    expect(osa).toContain("<textarea");
    expect(osa).toContain("Lisätiedot tekoälylle");
    expect(osa).toContain("maxLength={LISATIEDOT_MAX}");
    expect(osa).toContain("Oltermanni light -juustoa"); // esimerkki samasta tilanteesta kuin käyttäjän tilaus
    expect(lahde).toMatch(
      /tulkitseKuva\(\s*photo\?\.blob \?\? file,\s*kuvaRooli,\s*date,\s*kuvaLisatiedot,\s*\)/,
    );
    expect(lahde).toMatch(
      /ateriaKuvasta\(\s*tulos,\s*date,\s*defaultMealTime\(date\),\s*photo,\s*kuvaLisatiedot,\s*\)/,
    );
  });
});
