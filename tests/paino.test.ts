// Päivän paino on valinnainen kirjaus. Testit rajaavat neljä lupausta:
// 1) painon voi kirjoittaa yhdellä kentällä myös luonnollisella kielellä,
// 2) luku on aina kiloina ja yhden desimaalin tarkkuudella,
// 3) puuttuvaa painoa ei tulkita nollaksi (päivän sivu, Kehityksen kuvaaja),
// 4) paino synkronoituu kuten muut kirjaukset.
import { describe, it, expect, afterEach } from "vitest";
import { tulkitsePaino } from "../src/domain/paino";
import { stamped, id, weightSchema, type Weight } from "../src/domain/model";
import { weightSeries } from "../src/domain/analytics";
import { saveRecord, findWeight, readDataset, DiaryDB } from "../src/data/db";
import {
  SYNKATTAVAT,
  paikallisetMuutokset,
  sovellaEtamuutokset,
  vakaa,
  type EtaMuutos,
} from "../src/data/sync";

const kannat: DiaryDB[] = [];
const kanta = () => {
  const d = new DiaryDB("paino-" + id());
  kannat.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(kannat.splice(0).map((d) => d.delete()));
});
const mittaus = (päivä: string, kg: number, tunniste = id()): Weight => ({
  ...stamped(),
  id: tunniste,
  date: päivä,
  kg,
  note: "",
});

describe("Päivän painon tulkinta vapaasta tekstistä", () => {
  it("yksi kenttä: numerot ja luonnollinen kieli antavat saman arvon", () => {
    for (const [teksti, kg] of [
      ["82,4", 82.4],
      ["82.4", 82.4],
      ["paino 82,4", 82.4],
      ["Painoin itseni 82,4 kiloa aamulla", 82.4],
      ["punnitsin itseni 82,4 kg", 82.4],
      ["82", 82],
      ["30.10.2026 paino 82,4", 82.4],
      ["2026-10-30, painoin 81,9", 81.9],
      ["30.10. punnitsin itseni 82,4", 82.4],
      ["eilen 30. paino oli 81,9", 81.9],
    ] as const)
      expect(tulkitsePaino(teksti)).toBe(kg);
  });
  it("tulos on aina yhden desimaalin tarkkuudella", () => {
    expect(tulkitsePaino("paino 82,44")).toBe(82.4);
    expect(tulkitsePaino("paino 82,45")).toBe(82.5);
    expect(tulkitsePaino("paino 82,4 kg")).toBe(82.4);
  });
  it("puuttuvasta tai epäselvästä tekstistä ei arvata", () => {
    for (const teksti of [
      "",
      "    ",
      "en punninnut tänään",
      "painoin 82,4 ja 90,1",
      "30.10.2026",
      "kello oli kaksitoista",
      "8",
      "1000",
      "1 000",
    ])
      expect(tulkitsePaino(teksti)).toBeNull();
  });
});

describe("Painon tallennus on koodin vastuulla", () => {
  it("skeema ja tallennus pyöristävät yhteen desimaaliin", async () => {
    expect(
      weightSchema.parse({
        ...stamped(),
        date: "2026-10-02",
        kg: 82.44,
        note: "",
      }).kg,
    ).toBe(82.4);
    const db = kanta();
    await saveRecord("weights", mittaus("2026-10-02", 82.46), db);
    expect((await findWeight("2026-10-02", db))?.kg).toBe(82.5);
    for (const kg of [9.9, 501])
      expect(() =>
        weightSchema.parse({ ...stamped(), date: "2026-10-02", kg, note: "" }),
      ).toThrow();
  });
  it("saman päivän uusi arvo korvaa edellisen: yksi rivi päivää kohti", async () => {
    const db = kanta();
    expect(await findWeight("2026-10-02", db)).toBeUndefined();
    await saveRecord("weights", mittaus("2026-10-02", 82.4, "w1"), db);
    // Samoin kuin kirjauksessa: olemassa oleva rivi päivitetään, ei lisätä.
    const olemassa = await findWeight("2026-10-02", db);
    await saveRecord(
      "weights",
      { ...stamped(olemassa), date: "2026-10-02", kg: 81.9, note: "" },
      db,
    );
    expect(await db.weights.count()).toBe(1);
    expect((await findWeight("2026-10-02", db))?.kg).toBe(81.9);
  });
  it("paino on valinnainen: päivä ilman painoa tallentuu ja on luettavissa", async () => {
    const db = kanta();
    await saveRecord(
      "days",
      { ...stamped(), date: "2026-10-02", complete: true },
      db,
    );
    const data = await readDataset(db);
    expect(data.weights).toEqual([]);
    expect(data.days[0].complete).toBe(true);
    expect(await findWeight("2026-10-02", db)).toBeUndefined();
  });
});

describe("Kehityksen painosarja", () => {
  it("puuttuvat päivät jäävät rakoihin, ne eivät muutu nolliksi", () => {
    const sarja = weightSeries(
      [mittaus("2026-10-01", 82.4), mittaus("2026-10-03", 82.2)],
      "2026-10-05",
      5,
    );
    expect(sarja.map((r) => r.weight)).toEqual([82.4, null, 82.2, null, null]);
    expect(sarja.every((r) => r.weight !== 0)).toBe(true);
    // Keskiarvo vaatii vähintään kolme mittausta seitsemän päivän ikkunasta.
    expect(sarja.every((r) => r.average === null)).toBe(true);
  });
  it("tyhjä päiväkirja antaa vain puuttuvia arvoja", () => {
    expect(
      weightSeries([], "2026-10-05", 7).every(
        (r) => r.weight === null && r.measurements === 0,
      ),
    ).toBe(true);
  });
});

describe("Paino synkronoituu kuten muut kirjaukset", () => {
  it("paino on synkätty taulu ja paikallinen muutos lähtee palvelimelle", async () => {
    expect(SYNKATTAVAT).toContain("weights");
    const db = kanta();
    await saveRecord("weights", mittaus("2026-10-02", 82.4, "w1"), db);
    const muutokset = await paikallisetMuutokset(db);
    expect(muutokset.map((m) => [m.taulu, m.id, m.poistettu])).toEqual([
      ["weights", "w1", false],
    ]);
    await db
      .table("synkPohja")
      .put({ taulu: "weights", id: "w1", json: vakaa(muutokset[0].data) });
    expect(await paikallisetMuutokset(db)).toEqual([]);
  });
  it("palvelimen saman päivän mittaus voittaa ja poistaa vanhan", async () => {
    const db = kanta();
    await saveRecord("weights", mittaus("2026-10-02", 82.4, "w1"), db);
    const etämuutos: EtaMuutos = {
      seq: 1,
      taulu: "weights",
      id: "w2",
      data: mittaus("2026-10-02", 81.9, "w2"),
      poistettu: false,
    };
    await sovellaEtamuutokset([etämuutos], 1, db);
    expect((await db.weights.toArray()).map((w) => w.id)).toEqual(["w2"]);
    expect((await findWeight("2026-10-02", db))?.kg).toBe(81.9);
    expect((await db.table("synkPohja").toArray()).map((r) => r.id)).toEqual([
      "w2",
    ]);
    expect(await paikallisetMuutokset(db)).toEqual([]);
  });
});
