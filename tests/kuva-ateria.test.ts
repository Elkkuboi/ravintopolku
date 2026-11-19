// Kuvasta ateria (aiops ADR-0027): asiakaspuoli käsin kirjoitetuilla palvelinvastauksilla, kuvan pienennys rajaan,
// luonnoksen tarkistus ennen tallennusta ja Tänään-sivun kaksi kuvakenttää (kamera ja galleria).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  tulkitseKuva,
  kuvaVirhe,
  ateriaKuvasta,
  ateriatyyppi,
  siistiLisatiedot,
  luonnosRivit,
  uusiRivi,
  riviksi,
  rivinKcal,
  luonnosSumma,
  luonnosAteriaksi,
  KUVA_ROOLI,
  KUVA_VIRHE,
  LISATIEDOT_MAX,
  type KuvaTulos,
  type LuonnosRivi,
} from "../src/ai/kuva-ateria";
import {
  pienennaRajaan,
  compressPhoto,
  LAHETYS_MAX,
  ASKELEET,
} from "../src/data/photos";
import {
  mealSchema,
  settingsSchema,
  stamped,
  id,
  emptyDataset,
} from "../src/domain/model";
import { lineNutrients } from "../src/domain/nutrition";
import { DiaryDB, saveMeal, readDataset, saveRecord } from "../src/data/db";
import Tanaan from "../src/nakymat/Tanaan";
import { KuvaKentta } from "../src/components/KuvaKentta";
import { KuvaLuonnos } from "../src/components/KuvaLuonnos";

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
  rooli: "kuva_tulkki",
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
      provider: "aiops-välittäjä / kuva_tulkki",
      model: "gpt-testi",
      note: "Kuvasta tulkittu arvio (rooli kuva_tulkki). Tarkista määrät ja ravintoarvot.",
    },
  },
};
const lisatiedotRaaka =
  " leivässä on kaksi\n  viipaletta Oltermanni light -juustoa  ";
const lisatiedotSiisti =
  "leivässä on kaksi viipaletta Oltermanni light -juustoa";
const databases: DiaryDB[] = [];
const uusiKanta = () => {
  const db = new DiaryDB("test-" + id());
  databases.push(db);
  return db;
};
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});
const kutsu = (hae: ReturnType<typeof vi.fn>) =>
  hae.mock.calls[0] as unknown as [string, RequestInit];

describe("tulkitseKuva", () => {
  it("lähettää kuvan, roolin kuva_tulkki ja päivän multipart-pyyntönä ja validoi luonnoksen", async () => {
    const hae = vi.fn(async () => vastaus({ ...tulos, pvm: "2026-10-28" }));
    const ohjain = new AbortController();
    expect(
      await tulkitseKuva(
        kuva,
        "2026-10-28",
        "",
        hae as unknown as typeof fetch,
        ohjain.signal,
      ),
    ).toEqual(tulos);
    const [url, init] = kutsu(hae);
    expect(url).toBe("/api/kuva-ateria");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.signal).toBe(ohjain.signal);
    const runko = init.body as FormData;
    expect(runko.get("rooli")).toBe("kuva_tulkki");
    expect(runko.get("pvm")).toBe("2026-10-28");
    expect((runko.get("kuva") as File).size).toBe(12);
    expect(runko.get("vihje")).toBeNull(); // tyhjää lisätietoa ei lähetetä
  });

  it("lähettää lisätiedon siistittynä vihje-kenttänä kuvan rinnalla", async () => {
    const hae = vi.fn(async () => vastaus(tulos));
    await tulkitseKuva(
      kuva,
      "2026-10-28",
      lisatiedotRaaka,
      hae as unknown as typeof fetch,
    );
    const runko = kutsu(hae)[1].body as FormData;
    expect(runko.get("vihje")).toBe(lisatiedotSiisti);
    expect(runko.get("kuva")).toBeTruthy();
  });

  it("lisätieto rajan asti kelpaa, yli rajan hylätään lähettämättä kuvaa", async () => {
    const hae = vi.fn(async () => vastaus(tulos));
    await tulkitseKuva(
      kuva,
      "2026-10-28",
      "a".repeat(LISATIEDOT_MAX),
      hae as unknown as typeof fetch,
    );
    expect((kutsu(hae)[1].body as FormData).get("vihje")).toHaveLength(300);
    hae.mockClear();
    await expect(
      tulkitseKuva(
        kuva,
        "2026-10-28",
        "a".repeat(LISATIEDOT_MAX + 1),
        hae as unknown as typeof fetch,
      ),
    ).rejects.toThrow("enintään 300 merkkiä");
    expect(hae).not.toHaveBeenCalled();
    expect(LISATIEDOT_MAX).toBe(300); // sama raja kuin palvelimen VIHJE_MAX
  });

  it("raakaa tai liian suurta kuvaa ei lähetetä: raja on 700 kt", async () => {
    const hae = vi.fn(async () => vastaus(tulos));
    await expect(
      tulkitseKuva(
        new Blob([new Uint8Array(LAHETYS_MAX + 1)]),
        "2026-10-28",
        "",
        hae as unknown as typeof fetch,
      ),
    ).rejects.toThrow(KUVA_VIRHE.liianSuuri);
    expect(hae).not.toHaveBeenCalled();
    await tulkitseKuva(
      new Blob([new Uint8Array(LAHETYS_MAX)]),
      "2026-10-28",
      "",
      hae as unknown as typeof fetch,
    );
    expect(hae).toHaveBeenCalledTimes(1);
  });

  it("virhe on lyhyt suomenkielinen viesti tilan mukaan; tarjoajan teksti ei näy", async () => {
    const tarjoaja =
      "Mallin kutsu epäonnistui välittäjässä. (tarjoaja vastasi HTTP 400: Unsupported parameter: 'temperature')";
    for (const [tila, odotettu] of [
      [401, KUVA_VIRHE.eiKaytossa],
      [404, KUVA_VIRHE.eiKaytossa],
      [402, KUVA_VIRHE.budjetti],
      [413, KUVA_VIRHE.liianSuuri],
      [422, KUVA_VIRHE.eiRuokaa],
      [501, KUVA_VIRHE.eiNyt],
      [503, KUVA_VIRHE.eiNyt],
      [504, KUVA_VIRHE.hidas],
      [500, KUVA_VIRHE.muu],
      [502, KUVA_VIRHE.muu],
    ] as const) {
      expect(kuvaVirhe(tila)).toBe(odotettu);
      const virhe = await tulkitseKuva(kuva, "2026-10-28", "", async () =>
        vastaus({ virhe: tarjoaja, error: { message: "HTTP 400" } }, tila),
      ).catch((e: Error) => e);
      expect((virhe as Error).message).toBe(odotettu);
      expect((virhe as Error).message).not.toMatch(/HTTP|temperature|\(/);
    }
    for (const viesti of Object.values(KUVA_VIRHE))
      expect(viesti).not.toMatch(/[()]|HTTP|\d{3}/);
  });

  it("yhteysvirhe ja kelvoton vastaus", async () => {
    await expect(
      tulkitseKuva(kuva, "2026-10-28", "", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow(KUVA_VIRHE.yhteys);
    await expect(
      tulkitseKuva(kuva, "2026-10-28", "", async () =>
        vastaus({ draft: { name: "x" }, kind: "ateria", rooli: "kuva_tulkki" }),
      ),
    ).rejects.toThrow(KUVA_VIRHE.kelvoton);
  });

  it("Peru keskeyttää pyynnön: keskeytys ei ole yhteysvirhe", async () => {
    const ohjain = new AbortController();
    const hae = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_ok, hylkaa) =>
        init?.signal?.addEventListener("abort", () =>
          hylkaa(new DOMException("Peruttu", "AbortError")),
        ),
      );
    const kesken = tulkitseKuva(
      kuva,
      "2026-10-28",
      "",
      hae as typeof fetch,
      ohjain.signal,
    );
    ohjain.abort();
    const virhe = await kesken.catch((e: Error) => e);
    expect((virhe as Error).name).toBe("AbortError");
    expect((virhe as Error).message).not.toBe(KUVA_VIRHE.yhteys);
  });
});

describe("tallennettu kuva-asetus ei muuta kutsua", () => {
  it('vanha "api"-lähde ja muu rooli säilyvät datassa, mutta kuva lähtee aina /api/kuva-ateria roolilla kuva_tulkki', async () => {
    const db = uusiKanta();
    await saveRecord(
      "settings",
      {
        ...stamped(),
        theme: "dark",
        kuvantunnistus: "api",
        kuvantulkinta: "kuva_tulkki_paikallinen",
      },
      db,
    );
    const [asetus] = (await readDataset(db)).settings;
    expect(asetus.kuvantunnistus).toBe("api"); // skeema ja data ennallaan
    expect(asetus.kuvantulkinta).toBe("kuva_tulkki_paikallinen");
    const hae = vi.fn(async () => vastaus(tulos));
    await tulkitseKuva(kuva, "2026-10-28", "", hae as unknown as typeof fetch);
    expect(kutsu(hae)[0]).toBe("/api/kuva-ateria");
    expect((kutsu(hae)[1].body as FormData).get("rooli")).toBe(KUVA_ROOLI);
    expect(KUVA_ROOLI).toBe("kuva_tulkki");
  });

  it("kuvapolun koodi ei lue asetuksia (ja tarkistus huomaisi lukemisen)", () => {
    const lukee = /\.kuvantunnistus|\.kuvantulkinta|\bsettings\b/;
    for (const f of [
      "src/ai/kuva-ateria.ts",
      "src/components/KuvaLuonnos.tsx",
      "src/components/KuvaKentta.tsx",
      "src/nakymat/Tanaan.tsx",
    ])
      expect(readFileSync(f, "utf8"), f).not.toMatch(lukee);
    expect("data.settings[0]?.kuvantunnistus").toMatch(lukee);
    expect("rooli: asetus.kuvantulkinta").toMatch(lukee);
  });

  it("skeema hyväksyy yhä vanhat kentät ja hylkää tuntemattoman arvon", () => {
    expect(
      settingsSchema.parse({ ...stamped(), theme: "system" }).kuvantunnistus,
    ).toBeUndefined();
    expect(() =>
      settingsSchema.parse({
        ...stamped(),
        theme: "system",
        kuvantunnistus: "openai",
      }),
    ).toThrow();
  });
});

describe("kuvan pienennys", () => {
  const koko = (n: number) => new Blob([new Uint8Array(n)]);

  it("ensimmäinen askel riittää useimmiten: 1600 px ja laatu 0,8", async () => {
    const koodaa = vi.fn(async () => koko(300_000));
    expect((await pienennaRajaan(koodaa)).size).toBe(300_000);
    expect(koodaa.mock.calls).toEqual([[1600, 0.8]]);
  });

  it("laskee laatua ja lopuksi kokoa, kunnes kuva mahtuu 700 kt:hen", async () => {
    const koot = [2_000_000, 1_100_000, 800_000, 650_000];
    const koodaa = vi.fn(async () => koko(koot.shift()!));
    expect((await pienennaRajaan(koodaa)).size).toBe(650_000);
    expect(koodaa.mock.calls).toEqual([
      [1600, 0.8],
      [1600, 0.7],
      [1600, 0.6],
      [1280, 0.6],
    ]);
    expect(ASKELEET).toHaveLength(4);
  });

  it("rajalla oleva kelpaa, tavua suurempi ei; jos mikään ei mahdu, virhe eikä raakaa tiedostoa", async () => {
    expect((await pienennaRajaan(async () => koko(LAHETYS_MAX))).size).toBe(
      LAHETYS_MAX,
    );
    const koodaa = vi.fn(async () => koko(LAHETYS_MAX + 1));
    await expect(pienennaRajaan(koodaa)).rejects.toThrow("tarpeeksi pieneksi");
    expect(koodaa).toHaveBeenCalledTimes(ASKELEET.length);
  });

  it("raja on sama kuin palvelimen KUVA_MAX", () => {
    expect(LAHETYS_MAX).toBe(700_000);
    const palvelin = readFileSync(
      "palvelin/src/ravintopolku_palvelin/kuva.py",
      "utf8",
    );
    expect(palvelin).toMatch(/^KUVA_MAX = 700_000$/m);
  });

  it("avaa kuvan selaimella eikä hylkää tiedostotyypin perusteella; avautumaton kuva hylätään", async () => {
    // HEIC-tyyppinen tiedosto: selain (tässä tynkä) osaa avata sen, joten se pienennetään JPEG:ksi.
    const piirretyt: { w: number; h: number; laatu: number }[] = [];
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 4000,
      height: 3000,
      close: () => {},
    }));
    vi.stubGlobal("document", {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            fillRect: () => {},
            drawImage: () => {},
            fillStyle: "",
          }),
          toBlob: (cb: (b: Blob) => void, tyyppi: string, laatu: number) => {
            piirretyt.push({ w: canvas.width, h: canvas.height, laatu });
            cb(new Blob([new Uint8Array(400_000)], { type: tyyppi }));
          },
        };
        return canvas;
      },
    });
    const tulos = await compressPhoto(
      new Blob([new Uint8Array(3_000_000)], { type: "image/heic" }),
    );
    expect(tulos.type).toBe("image/jpeg");
    expect(piirretyt).toEqual([{ w: 1600, h: 1200, laatu: 0.8 }]);
    vi.stubGlobal("createImageBitmap", async () => {
      throw new DOMException("ei kuva", "InvalidStateError");
    });
    await expect(compressPhoto(new Blob(["ei kuva"]))).rejects.toThrow(
      "Kuvaa ei voitu avata",
    );
  });

  it("yli 15 Mt:n tiedostoa ei edes avata", async () => {
    const avaa = vi.fn();
    vi.stubGlobal("createImageBitmap", avaa);
    await expect(
      compressPhoto(new Blob([new Uint8Array(15 * 1024 * 1024 + 1)])),
    ).rejects.toThrow("liian suuri");
    expect(avaa).not.toHaveBeenCalled();
  });
});

describe("ateriaKuvasta", () => {
  it("luo tallentamattoman kelvollisen aterian: alkuperä yhtenä rivinä, oletukset ilman toistoa, 100 g per100-riville", async () => {
    const photo = { ...stamped(), blob: kuva };
    const meal = ateriaKuvasta(tulos, "2026-10-28", "12:30", photo);
    expect(() => mealSchema.parse(meal)).not.toThrow();
    expect(meal.type).toBe("Lounas");
    expect(meal.origin).toBe("Kuvasta (gpt-testi): ruoka-annos");
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
      "Määrä oletettu 100 g: Rahka",
      "Muusissa on voita",
      "Tuntematon: Lihapullat: kuitu",
      "Kysymys: Oliko kastiketta?",
    ]);
    expect(meal.photoId).toBe(photo.id);
    const db = uusiKanta();
    await saveMeal(meal, photo, false, db);
    const data = await readDataset(db);
    expect(data.meals[0].snapshot.energy).toBe(343);
    expect(data.photos[0].id).toBe(photo.id);
  });

  it("lisätieto jää ateriaan kerran samana tekstinä kuin välittäjälle meni", () => {
    const meal = ateriaKuvasta(
      tulos,
      "2026-10-28",
      "12:30",
      null,
      lisatiedotRaaka,
    );
    expect(meal.assumptions[0]).toBe("Lisätiedot: " + lisatiedotSiisti);
    expect(
      meal.assumptions.filter((a) => a.startsWith("Lisätiedot:")),
    ).toHaveLength(1);
    expect(meal.assumptions).toContain("Kuvaa ei tallennettu laitteelle.");
    expect(
      ateriaKuvasta(tulos, "2026-10-28", "12:30", null, "  \n ").assumptions,
    ).not.toContainEqual(expect.stringMatching(/^Lisätiedot:/));
    expect(siistiLisatiedot(lisatiedotRaaka)).toBe(lisatiedotSiisti);
  });

  it("tuoteseloste ja malliton luonnos; ateriatyyppi kellonajasta", () => {
    const seloste = ateriaKuvasta(
      {
        ...tulos,
        kind: "tuoteseloste",
        draft: {
          ...tulos.draft,
          provenance: { ...tulos.draft.provenance, model: null },
        },
      },
      "2026-10-28",
      "21:00",
      null,
    );
    expect(seloste.origin).toBe("Kuvasta: tuoteseloste");
    expect(
      ["07:30", "11:00", "15:00", "18:30", "21:00"].map(ateriatyyppi),
    ).toEqual(["Aamiainen", "Lounas", "Välipala", "Päivällinen", "Iltapala"]);
  });
});

describe("luonnoksen tarkistus: ruoka / g / kcal", () => {
  const pohja = ateriaKuvasta(
    tulos,
    "2026-10-28",
    "18:00",
    { ...stamped(), blob: kuva },
    "iso annos",
  );
  const rivit = () => luonnosRivit(pohja);
  const muuta = (r: LuonnosRivi[], i: number, m: Partial<LuonnosRivi>) =>
    r.map((x, j) => (j === i ? { ...x, ...m } : x));

  it("rivit näyttävät nimen, grammat ja lasketun kcal-luvun", () => {
    const r = rivit();
    expect(r.map((x) => [x.nimi, x.g, rivinKcal(x)])).toEqual([
      ["Lihapullat", "120", "280"],
      ["Rahka", "100", "63"],
    ]);
    const summa = luonnosSumma(r)!;
    expect(summa.energy.value).toBe(343);
    expect(summa.fiber.partial).toBe(true); // lihapullien kuitu puuttuu: ei nolla
  });

  it("annoksen grammat skaalaavat kaikki arvot, per 100 g -rivi laskee itse", () => {
    let r = muuta(rivit(), 0, { g: "240" });
    r = muuta(r, 1, { g: "250" });
    expect(rivinKcal(r[0])).toBe("560");
    expect(riviksi(r[0]).values).toEqual({
      energy: 560,
      protein: 36,
      carbs: 16,
      fat: 38,
      fiber: null,
    });
    expect(riviksi(r[1]).values.energy).toBe(63); // per 100 g ennallaan
    expect(rivinKcal(r[1])).toBe("158");
  });

  it("oma kcal-luku korvaa energian ja pysyy, kun grammoja muutetaan", () => {
    let r = muuta(rivit(), 0, { kcal: "300" });
    r = muuta(r, 0, { g: "240" });
    expect(rivinKcal(r[0])).toBe("300");
    expect(lineNutrients(riviksi(r[0])).energy).toBe(300);
    expect(riviksi(r[0]).values.protein).toBe(36); // muut arvot seuraavat grammoja
    r = muuta(r, 1, { g: "250", kcal: "300" });
    expect(riviksi(r[1]).values.energy).toBe(120); // per 100 g
    expect(lineNutrients(riviksi(r[1])).energy).toBe(300);
    expect(riviksi(muuta(r, 0, { kcal: "" })[0]).values.energy).toBeNull();
  });

  it("kelvoton luku: summa odottaa korjausta ja tallennus kertoo syyn", () => {
    const r = muuta(rivit(), 1, { g: "" }); // per 100 g -rivi tarvitsee grammat
    expect(rivinKcal(r[1])).toBe("");
    expect(luonnosSumma(r)).toBeNull();
    expect(() => luonnosAteriaksi(pohja, "x", "18:00", r)).toThrow(
      "Anna positiivinen numero",
    );
    expect(() => riviksi(muuta(rivit(), 0, { g: "-5" })[0])).toThrow();
  });

  it("uusi rivi: nimi ja kcal riittävät, muut arvot jäävät tuntemattomiksi", () => {
    const uusi = { ...uusiRivi(), nimi: "Leipä", kcal: "90" };
    expect(uusi.pohja.mode).toBe("portion");
    expect(uusi.pohja.source).toBe("Oma arvio");
    const rivi = riviksi(uusi);
    expect(rivi.values).toEqual({
      energy: 90,
      protein: null,
      carbs: null,
      fat: null,
      fiber: null,
    });
    expect(luonnosSumma([...rivit(), uusi])!.protein.partial).toBe(true);
  });

  it("tallennettava ateria: tyhjänimiset rivit pois, kello ja nimi muuttuvat, piilokentät säilyvät", async () => {
    const r = [
      ...muuta(rivit(), 1, { nimi: "  " }),
      { ...uusiRivi(), nimi: "" },
    ];
    const meal = luonnosAteriaksi(pohja, " Lihapullat ", "08:15", r);
    expect(() => mealSchema.parse(meal)).not.toThrow();
    expect(meal.lines.map((l) => l.name)).toEqual(["Lihapullat"]);
    expect(meal.time).toBe("08:15");
    expect(meal.type).toBe("Aamiainen");
    expect(meal.note).toBe("Lihapullat");
    expect(meal.timestamp).toBe("2026-10-28T06:15:00.000Z");
    expect(meal.snapshot.energy).toBe(280);
    for (const k of [
      "id",
      "createdAt",
      "origin",
      "assumptions",
      "photoId",
      "date",
    ] as const)
      expect(meal[k]).toEqual(pohja[k]);
    expect(meal.lines[0]).toMatchObject({
      id: pohja.lines[0].id,
      source: "Kuvasta arvioitu annos",
      mode: "portion",
      foodId: null,
    });
    expect(() =>
      luonnosAteriaksi(pohja, "x", "18:00", [{ ...uusiRivi() }]),
    ).toThrow("vähintään yksi");
    expect(() => luonnosAteriaksi(pohja, "x", "25:00", rivit())).toThrow();
    const db = uusiKanta();
    await saveMeal(meal, null, false, db);
    expect((await readDataset(db)).meals[0].note).toBe("Lihapullat");
  });
});

describe("Tänään-sivun kuvanapit", () => {
  const sivu = renderToStaticMarkup(
    createElement(Tanaan, {
      data: emptyDataset(),
      notify: () => {},
      run: async () => {},
    }),
  );
  const kentat = [
    ...sivu.matchAll(/<label[^>]*>([^<]*)<input type="file"[^>]*>/g),
  ];

  it("kaksi erillistä tiedostokenttää: Ota kuva avaa kameran, Galleriasta ei", () => {
    expect(kentat.map((k) => k[1])).toEqual(["Ota kuva", "Galleriasta"]);
    const [kamera, galleria] = kentat.map((k) => k[0]);
    expect(kamera).toContain('capture="environment"');
    expect(kamera).toContain('class="btn file btn--primary"');
    expect(galleria).not.toContain("capture");
    for (const k of [kamera, galleria])
      expect(k).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(sivu.match(/type="file"/g)).toHaveLength(2);
  });

  it("Kirjoita avaa käsin kirjauksen; lisätietoa ei kysytä ennen kuvaa", () => {
    expect(sivu).toContain('<button class="btn">Kirjoita</button>');
    expect(sivu).not.toContain("Lisätieto");
    expect(sivu).not.toContain('<textarea maxLength="300"');
  });

  it("kuvan jälkeen: uusi kuva samalla tavalla kuin ensimmäinen", () => {
    const kamera = renderToStaticMarkup(
      createElement(KuvaKentta, {
        lahde: "kamera",
        uusi: true,
        onValittu: () => {},
      }),
    );
    const galleria = renderToStaticMarkup(
      createElement(KuvaKentta, {
        lahde: "galleria",
        uusi: true,
        onValittu: () => {},
      }),
    );
    expect(kamera).toMatch(
      /^<label class="btn file">Ota uusi<input[^>]*capture="environment"/,
    );
    expect(galleria).toMatch(/^<label class="btn file">Valitse toinen<input/);
    expect(galleria).not.toContain("capture");
  });

  it("kuvapolun alku: pikkukuva, valinnainen lisätieto ja Tulkitse kuva; mitään ei tallenneta vielä", () => {
    const html = renderToStaticMarkup(
      createElement(KuvaLuonnos, {
        photo: { ...stamped(), blob: kuva },
        lahde: "kamera",
        date: "2026-10-28",
        onUusi: () => {},
        onPeru: () => {},
        onTallennettu: () => {},
        onKasin: () => {},
      }),
    );
    expect(html).toContain('class="thumb"');
    expect(html).toContain("Lisätieto (ei pakollinen)");
    expect(html).toContain('maxLength="300"');
    expect(html).toContain("Tulkitse kuva");
    expect(html).toContain("Ota uusi");
    expect(html).not.toContain("Tallenna");
    expect(html).not.toContain("Tulkitaan");
  });
});
