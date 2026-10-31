// Tavoitteet luonnollisesta kielestä: asiakaspuoli käsin kirjoitetuilla palvelinvastauksilla, numeroiden
// rajatarkistus ja hyväksytyn ehdotuksen tallennus päivän tavoitteeksi. Mitään ei tallenneta ennen hyväksymistä.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  makroenergia,
  profiiliKuvaus,
  tarkistaRajat,
  vertaaMakroja,
  ehdotaTavoitteet,
  hyvaksyTavoite,
  OLETUSROOLI,
  RAJAT,
  TAVOITE_ROOLIT,
  TEKSTI_MAX,
  VALMIIT_TAVOITTEET,
} from "../src/ai/tavoitteet";
import {
  emptyNutrients,
  goalSchema,
  id,
  stamped,
  type Nutrients,
  type Profile,
} from "../src/domain/model";
import { DiaryDB, readDataset, saveGoal, saveRecord } from "../src/data/db";

const vastaus = (runko: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => runko,
  }) as Response;
const f = (hae: unknown) => hae as unknown as typeof fetch;
const TAVOITE = "painon lievä pudotus";
const vastausRunko = {
  ehdotus: { energy: 2350, protein: 165, carbs: 245, fat: 78 },
  perustelu: "Kevyt alipaino ja runsas proteiini sopivat tavoitteeseen.",
  oletukset: ["Kolme ateriaa ja yksi välipala"],
  rooli: "tavoite_ehdottaja",
  malli: "gpt-testi",
};
const profiili = (lisaa: Partial<Profile> = {}): Profile => ({
  ...stamped(),
  name: "Elias",
  height: 181,
  startWeight: 84,
  startDate: "2026-01-01",
  age: 34,
  activity: "",
  training: 3,
  preferences: "",
  ...lisaa,
});
const arvot = (lisaa: Partial<Nutrients> = {}): Nutrients => ({
  ...emptyNutrients(),
  energy: 2350,
  protein: 165,
  carbs: 245,
  fat: 78,
  ...lisaa,
});
const databases: DiaryDB[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});

describe("ehdotaTavoitteet", () => {
  it("POST /api/tavoitteet JSON-rungolla ja validoi ehdotuksen", async () => {
    const hae = vi.fn(async () => vastaus(vastausRunko));
    expect(
      await ehdotaTavoitteet(`   ${TAVOITE}\n  `, {
        profiili: "ikä 34, paino 82 kg",
        hae: f(hae),
      }),
    ).toEqual(vastausRunko);
    const [url, init] = hae.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tavoitteet");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["X-Ravintopolku"]).toBe(
      "1",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      teksti: TAVOITE,
      rooli: OLETUSROOLI,
      profiili: "ikä 34, paino 82 kg",
    });
  });

  it("rooli välitetään ja profiili katkaistaan", async () => {
    const hae = vi.fn(async () =>
      vastaus({ ...vastausRunko, rooli: "tavoite_ehdottaja_paikallinen" }),
    );
    const tulos = await ehdotaTavoitteet(TAVOITE, {
      rooli: "tavoite_ehdottaja_paikallinen",
      profiili: "x".repeat(400),
      hae: f(hae),
    });
    expect(tulos.rooli).toBe("tavoite_ehdottaja_paikallinen");
    const runko = JSON.parse(
      String((hae.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(runko.rooli).toBe("tavoite_ehdottaja_paikallinen");
    expect(runko.profiili).toHaveLength(300);
  });

  it("tyhjä tai liian pitkä teksti ei lähetä mitään", async () => {
    const hae = vi.fn(async () => vastaus(vastausRunko));
    await expect(ehdotaTavoitteet("   ", { hae: f(hae) })).rejects.toThrow(
      "Kirjoita tavoite sanoin",
    );
    await expect(
      ehdotaTavoitteet("x".repeat(TEKSTI_MAX + 1), { hae: f(hae) }),
    ).rejects.toThrow("liian pitkä");
    expect(hae).not.toHaveBeenCalled();
  });

  it("palvelimen suomenkielinen virhe, 404 ja offline näkyvät sellaisinaan", async () => {
    await expect(
      ehdotaTavoitteet(TAVOITE, {
        hae: async () =>
          vastaus({ virhe: "Viikon AI-budjetti on käytetty." }, 402),
      }),
    ).rejects.toThrow("Viikon AI-budjetti");
    await expect(
      ehdotaTavoitteet(TAVOITE, {
        hae: async () => vastaus({ virhe: "ei rajapintaa" }, 404),
      }),
    ).rejects.toThrow("ei ole käytössä tällä palvelimella");
    await expect(
      ehdotaTavoitteet(TAVOITE, { hae: async () => vastaus({}, 500) }),
    ).rejects.toThrow("palvelin vastasi 500");
    await expect(
      ehdotaTavoitteet(TAVOITE, {
        hae: f(async () => {
          throw new TypeError("Palvelimeen ei saada yhteyttä");
        }),
      }),
    ).rejects.toThrow("Tavoitteita ei ehdotettu");
  });

  it("kelvoton vastaus hylätään: uhkarooli, äärirajojen ulkopuolinen luku ja ylimääräinen kenttä", async () => {
    for (const runko of [
      { ...vastausRunko, rooli: "gpt-4o" },
      { ...vastausRunko, ehdotus: { ...vastausRunko.ehdotus, energy: 700 } },
      { ...vastausRunko, ehdotus: { ...vastausRunko.ehdotus, energy: 6100 } },
      { ...vastausRunko, ehdotus: { ...vastausRunko.ehdotus, kuitu: 30 } },
      { ...vastausRunko, ehdotus: null },
      { ...vastausRunko, malli: "x".repeat(300) },
      {
        ...vastausRunko,
        oletukset: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"],
      },
      { ...vastausRunko, virhe: "eikös näytetä" },
    ])
      await expect(
        ehdotaTavoitteet(TAVOITE, { hae: async () => vastaus(runko) }),
      ).rejects.toThrow("Ehdotusta ei näytetä");
  });
});

describe("numerot ja oletukset", () => {
  it("rajat, roolit ja valmiit tavoitteet ovat samat kuin palvelimella", () => {
    expect(RAJAT).toEqual({
      energy: [800, 6000],
      protein: [30, 250],
      carbs: [20, 700],
      fat: [20, 200],
    });
    expect(TAVOITE_ROOLIT).toEqual([
      "tavoite_ehdottaja",
      "tavoite_ehdottaja_pilvi",
      "tavoite_ehdottaja_paikallinen",
    ]);
    expect(OLETUSROOLI).toBe("tavoite_ehdottaja");
    expect(VALMIIT_TAVOITTEET).toContain("Painon lievä pudotus");
    expect(VALMIIT_TAVOITTEET).toContain("Rasvan muuttaminen lihakseksi");
    expect(
      VALMIIT_TAVOITTEET.every(
        (teksti) => teksti.length >= 3 && teksti.length <= TEKSTI_MAX,
      ),
    ).toBe(true);
    expect(new Set(VALMIIT_TAVOITTEET).size).toBe(VALMIIT_TAVOITTEET.length);
  });

  it("tarkistaRajat hylkää äärirajojen ulkopuoliset luvut, tyhjät kelpaavat", () => {
    expect(() => tarkistaRajat(arvot())).not.toThrow();
    expect(() => tarkistaRajat(emptyNutrients())).not.toThrow();
    expect(() => tarkistaRajat(arvot({ energy: 700 }))).toThrow(
      "Energia (kcal) 700 on alle äärirajan 800",
    );
    expect(() => tarkistaRajat(arvot({ fat: 201 }))).toThrow(
      "Rasva (g) 201 on yli äärirajan 200",
    );
    expect(() => tarkistaRajat(arvot({ energy: 200, protein: 500 }))).toThrow(
      "Energia (kcal) 200 on alle äärirajan 800; Proteiini (g) 500 on yli äärirajan 250",
    );
  });

  it("makroenergia ja varoitus suhteista", () => {
    expect(makroenergia({ protein: 150, carbs: 200, fat: 70 })).toBe(2030);
    expect(makroenergia({ protein: null, carbs: 200, fat: 70 })).toBeNull();
    expect(
      vertaaMakroja({ energy: 2030, protein: 150, carbs: 200, fat: 70 }),
    ).toBeNull();
    expect(
      vertaaMakroja({ energy: 2200, protein: 150, carbs: 200, fat: 70 }),
    ).toBeNull();
    expect(
      vertaaMakroja({ energy: 2400, protein: 150, carbs: 200, fat: 70 }),
    ).toBe(
      "Makrot vastaavat 2030 kcal, kun energiatavoite on 2400 kcal. Tarkista suhteet.",
    );
    expect(
      vertaaMakroja({ energy: null, protein: 150, carbs: 200, fat: 70 }),
    ).toBeNull();
    expect(
      vertaaMakroja({ energy: 2400, protein: null, carbs: null, fat: null }),
    ).toBeNull();
  });

  it("profiiliKuvaus kertoo vain sen mitä tiedetään", () => {
    expect(profiiliKuvaus(undefined)).toBe("");
    expect(profiiliKuvaus(undefined, { goalEnergy: 2000 })).toBe(
      "nykyinen energiatavoite 2000 kcal",
    );
    expect(profiiliKuvaus(profiili(), { weight: 82, goalEnergy: 2400 })).toBe(
      "ikä 34 vuotta; pituus 181 cm; uusin paino 82 kg; treenejä 3 kertaa viikossa; nykyinen energiatavoite 2400 kcal",
    );
    expect(profiiliKuvaus(profiili({ age: null, training: 0 }))).toBe(
      "pituus 181 cm; lähtöpaino 84 kg",
    );
    expect(profiiliKuvaus(profiili({ activity: "reippaat lenkit" }))).toContain(
      "liikuntaa: reippaat lenkit",
    );
    expect(
      profiiliKuvaus(profiili({ activity: "x".repeat(400) })).length,
    ).toBeLessThanOrEqual(300);
  });
});

describe("hyväksytty ehdotus tallentuu tavoitteeksi", () => {
  it("korvaa tämän päivän tavoitteen ja säilyttää kuidun sekä painotavoitteen", async () => {
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    const vanha = {
      ...stamped(),
      effectiveDate: "2026-10-01",
      kind: "lose" as const,
      targetWeight: 78,
      targetDate: "2026-12-31",
      nutrients: { energy: 2400, protein: 150, carbs: 250, fat: 70, fiber: 25 },
    };
    await saveRecord("goals", vanha, db);
    await saveGoal(
      hyvaksyTavoite(arvot({ fiber: null }), "2026-10-30", vanha),
      db,
    );
    const eka = await db.goals
      .where("effectiveDate")
      .equals("2026-10-30")
      .toArray();
    expect(eka).toHaveLength(1);
    expect(eka[0].nutrients).toEqual({
      energy: 2350,
      protein: 165,
      carbs: 245,
      fat: 78,
      fiber: 25,
    });
    expect([eka[0].kind, eka[0].targetWeight, eka[0].targetDate]).toEqual([
      "lose",
      78,
      "2026-12-31",
    ]);
    expect(() => goalSchema.parse(eka[0])).not.toThrow();
    // toinen hyväksyminen samalle päivälle korvaa, eikä vanhaa päivää koske
    await saveGoal(
      hyvaksyTavoite(arvot({ energy: 2100, fiber: 30 }), "2026-10-30", vanha),
      db,
    );
    const nyt = await db.goals
      .where("effectiveDate")
      .equals("2026-10-30")
      .toArray();
    expect(nyt).toHaveLength(1);
    expect(nyt[0].nutrients).toEqual({
      energy: 2100,
      protein: 165,
      carbs: 245,
      fat: 78,
      fiber: 30,
    });
    expect(nyt[0].id).not.toBe(eka[0].id);
    const data = await readDataset(db);
    expect(data.goals.map((g) => g.effectiveDate).sort()).toEqual([
      "2026-10-01",
      "2026-10-30",
    ]);
  });

  it("ilman voimassa olevaa tavoitetta tulee pelkän seurannan tavoite", () => {
    const goal = hyvaksyTavoite(arvot({ energy: null }), "2026-10-30");
    expect(goalSchema.parse(goal)).toMatchObject({
      effectiveDate: "2026-10-30",
      kind: "track",
      targetWeight: null,
      targetDate: null,
      nutrients: {
        energy: null,
        protein: 165,
        carbs: 245,
        fat: 78,
        fiber: null,
      },
    });
  });

  it("saveGoal validoi skeeman: mahdoton painotavoite hylkyy tallennuksen", async () => {
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    const rikkinainen = {
      ...hyvaksyTavoite(arvot(), "2026-10-30"),
      kind: "lose" as const,
    };
    await expect(saveGoal(rikkinainen, db)).rejects.toThrow();
    expect((await readDataset(db)).goals).toEqual([]);
  });
});
