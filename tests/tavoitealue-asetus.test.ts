// Säädettävä tavoitealue: prosentit kuuluvat tavoitteeseen (Goal.alueet). Sääntö omilla prosenteilla, mittarit ja
// Kehitys tavoitteen omilla alueilla, lomakkeen prosenttikentät, skeema, tallennus, synkronointi ja varmuuskopio.
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ALLE_MAX,
  YLI_MAX,
  alueetSchema,
  emptyDataset,
  emptyNutrients,
  goalSchema,
  id,
  keys,
  stamped,
  type Alueet,
  type Dataset,
  type Goal,
  type Nutrients,
} from "../src/domain/model";
import { addDays, localDay } from "../src/domain/dates";
import {
  OLETUSALUEET,
  aggregate,
  osuma,
  tavoitealue,
  tavoitteenAlueet,
  type Total,
} from "../src/domain/nutrition";
import {
  alueTeksti,
  asteikko,
  energiaTavoite,
  meterReading,
} from "../src/components/makromittarit";
import { macroCharts } from "../src/components/makrokuvaajat";
import {
  alueStrings,
  parseAlue,
  parseAlueet,
} from "../src/components/form-values";
import { MakroMittarit } from "../src/components/MakroMittarit";
import Kehitys from "../src/nakymat/Kehitys";
import { hyvaksyTavoite, tavoiteLomakkeesta } from "../src/ai/tavoitteet";
import { DiaryDB, readDataset, saveGoal } from "../src/data/db";
import { paikallisetMuutokset, sovellaEtamuutokset } from "../src/data/sync";
import { exportBackup, parseBackup } from "../src/data/backup";
import { meal } from "./fixtures";

const total = (value: number | null, known = 1, missing = 0): Total => ({
  value,
  known,
  missing,
  partial: missing > 0,
});
const nbsp = (s: string) => s.replace(/ /g, " ");
/** Rasvaa pudottavan alueet: ylitys tiukalla, proteiinin alaraja tiukalla. */
const TIUKAT: Alueet = {
  energy: { alle: 10, yli: 5 },
  protein: { alle: 5, yli: null },
  carbs: { alle: 20, yli: 10 },
  fat: { alle: 25, yli: 0 },
  fiber: { alle: 10, yli: null },
};
const tavoite = (
  nutrients: Partial<Nutrients>,
  alueet?: Alueet,
  pvm = "2026-11-01",
): Goal => ({
  ...stamped(),
  effectiveDate: pvm,
  kind: "track",
  targetWeight: null,
  targetDate: null,
  nutrients: { ...emptyNutrients(), ...nutrients },
  ...(alueet ? { alueet } : {}),
});
const databases: DiaryDB[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});

describe("sääntö omilla prosenteilla", () => {
  it("alue lasketaan tavoitteen prosenteista; ilman niitä oletuksista", () => {
    expect(tavoitealue("energy", 2000, TIUKAT)).toEqual({
      ala: 1800,
      yla: 2100,
    });
    expect(tavoitealue("protein", 150, TIUKAT)).toEqual({
      ala: 143,
      yla: null,
    });
    expect(tavoitealue("carbs", 200, TIUKAT)).toEqual({ ala: 160, yla: 220 });
    expect(tavoitealue("fat", 60, TIUKAT)).toEqual({ ala: 45, yla: 60 });
    expect(tavoitealue("energy", 2000)).toEqual({ ala: 1800, yla: 2200 });
    expect(tavoitealue("energy", 2000, OLETUSALUEET)).toEqual(
      tavoitealue("energy", 2000),
    );
  });

  it("yli 0 tekee tavoitteesta katon ja alle 0 lattian; molemmat nollina alue on yksi luku", () => {
    const katto = tavoitealue("fat", 60, TIUKAT);
    expect(osuma(60, katto)).toBe("sisalla");
    expect(osuma(61, katto)).toBe("yli");
    expect(osuma(45, katto)).toBe("sisalla");
    expect(osuma(44, katto)).toBe("alle");
    const tarkka: Alueet = { ...OLETUSALUEET, energy: { alle: 0, yli: 0 } };
    const yksi = tavoitealue("energy", 2000, tarkka);
    expect(yksi).toEqual({ ala: 2000, yla: 2000 });
    expect([1999, 2000, 2001].map((x) => osuma(x, yksi))).toEqual([
      "alle",
      "sisalla",
      "yli",
    ]);
  });

  it("proteiinille voi antaa ylärajan: silloin ylitys ei ole enää osuma", () => {
    const kaksi: Alueet = { ...OLETUSALUEET, protein: { alle: 10, yli: 20 } };
    const alue = tavoitealue("protein", 100, kaksi);
    expect(alue).toEqual({ ala: 90, yla: 120 });
    expect(osuma(121, alue)).toBe("yli");
    expect(osuma(150, tavoitealue("protein", 100))).toBe("sisalla");
  });

  it("tavoite on aina oman alueensa sisällä, millä tahansa sallituilla prosenteilla", () => {
    for (const alle of [0, 1, 25, ALLE_MAX])
      for (const yli of [0, 1, 50, YLI_MAX, null]) {
        const alueet = { ...OLETUSALUEET, energy: { alle, yli } };
        expect(alueetSchema.safeParse(alueet).success).toBe(true);
        for (const goal of [1, 37.5, 800, 2345, 6000])
          expect(osuma(goal, tavoitealue("energy", goal, alueet))).toBe(
            "sisalla",
          );
      }
  });

  it("tavoitteenAlueet: tavoitteen omat, muuten oletukset", () => {
    expect(tavoitteenAlueet(undefined)).toBe(OLETUSALUEET);
    expect(tavoitteenAlueet(tavoite({ energy: 2000 }))).toBe(OLETUSALUEET);
    expect(tavoitteenAlueet(tavoite({ energy: 2000 }, TIUKAT))).toBe(TIUKAT);
  });
});

describe("mittarit tavoitteen omilla alueilla", () => {
  it("asteikko ja otsikko seuraavat prosentteja", () => {
    const r = meterReading(total(2150), 2000);
    expect(asteikko("energy", r)).toMatchObject({
      alue: { ala: 1800, yla: 2200 },
      osuma: "sisalla",
      varoitus: false,
    });
    const a = asteikko("energy", r, TIUKAT)!;
    expect(a).toMatchObject({
      alue: { ala: 1800, yla: 2100 },
      osuma: "yli",
      varoitus: true,
      taytto: 100,
    });
    expect(a.tavoite).toBeCloseTo((2000 / 2100) * 100, 5);
    expect(nbsp(energiaTavoite(r, TIUKAT))).toBe(
      "tavoite 2 000 (1 800–2 100) kcal",
    );
    expect(nbsp(energiaTavoite(r))).toBe("tavoite 2 000 (1 800–2 200) kcal");
  });

  it("energia ilman ylärajaa: otsikossa vähintään-raja, palkki täysi tavoitteessa eikä ylitys varoita", () => {
    const lattia: Alueet = { ...OLETUSALUEET, energy: { alle: 5, yli: null } };
    const r = meterReading(total(2600), 2000);
    expect(nbsp(energiaTavoite(r, lattia))).toBe(
      "tavoite 2 000 (väh. 1 900) kcal",
    );
    expect(asteikko("energy", r, lattia)).toMatchObject({
      alku: 95,
      tavoite: null,
      taytto: 100,
      osuma: "sisalla",
      varoitus: false,
    });
  });

  it("rasvan katto: tavoitteen ylitys ei ole vihreä, mutta ei myöskään varoita", () => {
    expect(asteikko("fat", meterReading(total(61), 60), TIUKAT)).toMatchObject({
      osuma: "yli",
      varoitus: false,
      taytto: 100,
    });
    // tavoite on palkin pää, joten merkki on oikeassa reunassa
    expect(asteikko("fat", meterReading(total(50), 60), TIUKAT)).toMatchObject({
      osuma: "sisalla",
      tavoite: 100,
      alku: 75,
    });
  });

  it("alueTeksti lomakkeeseen: väli, vähintään tai tyhjä", () => {
    expect(nbsp(alueTeksti("energy", 2000, TIUKAT))).toBe("1 800–2 100 kcal");
    expect(alueTeksti("protein", 150, TIUKAT)).toBe("vähintään 143 g");
    expect(alueTeksti("fat", 60, TIUKAT)).toBe("45–60 g");
    expect(alueTeksti("fiber", null, TIUKAT)).toBe("");
    expect(alueTeksti("fiber", 0, TIUKAT)).toBe("");
    expect(nbsp(alueTeksti("energy", 2300))).toBe("2 070–2 530 kcal");
  });

  it("Tänään-sivun mittarit piirtyvät tavoitteen alueilla", () => {
    const totals = aggregate([
      { energy: 2150, protein: 145, carbs: 200, fat: 61, fiber: null },
    ]);
    const piirra = (goal: Goal) =>
      nbsp(
        renderToStaticMarkup(createElement(MakroMittarit, { totals, goal })),
      );
    const luvut = { energy: 2000, protein: 150, carbs: 200, fat: 60 };
    const oletus = piirra(tavoite(luvut));
    expect(oletus).toContain("tavoite 2 000 (1 800–2 200) kcal");
    expect(oletus).toContain('<span class="figure-num osui">2 150</span>');
    expect(oletus).toContain('<span class="osui">145</span> / 150 g');
    expect(oletus).toContain('<span class="osui">61</span> / 60 g');
    expect(oletus).not.toContain("meter--over");
    const tiukka = piirra(tavoite(luvut, TIUKAT));
    expect(tiukka).toContain("tavoite 2 000 (1 800–2 100) kcal");
    // energia on yli alueen: ei vihreää, varoitus
    expect(tiukka).toContain('<span class="figure-num">2 150</span>');
    expect(tiukka).toContain('<span class="figure-of yli">yli 150</span>');
    expect(tiukka).toContain("meter--over");
    expect(tiukka).toContain(
      "2 150 kcal, tavoite 2 000 kcal, yli tavoitealueen",
    );
    // proteiini 145 on tiukan alarajan (143) yläpuolella, rasva 61 katon (60) yli
    expect(tiukka).toContain('<span class="osui">145</span> / 150 g');
    expect(tiukka).not.toContain('<span class="osui">61</span>');
    expect(tiukka).toContain('<span class="osui">200</span> / 200 g');
  });
});

describe("Kehitys tavoitteen omilla alueilla", () => {
  const paivat = (alueet?: Alueet): Dataset => {
    const end = localDay();
    const d = emptyDataset();
    // fixtures.meal: 15 g proteiinia. Tavoite 16 g: oletusalue alkaa 14 g:sta, 5 %:n alue 15 g:sta, 0 %:n 16 g:sta.
    d.goals = [tavoite({ protein: 16 }, alueet, addDays(end, -30))];
    d.meals = [meal(addDays(end, -2)), meal(addDays(end, -1))];
    return d;
  };
  const piirra = (data: Dataset) =>
    renderToStaticMarkup(
      createElement(Kehitys, {
        data,
        notify: () => {},
        run: async (f: () => Promise<void>) => f(),
      }),
    );

  it("kuvaajan alue tulee voimassa olevan tavoitteen prosenteista", () => {
    const end = localDay();
    const alue = (alueet?: Alueet) =>
      macroCharts(paivat(alueet), end).find((c) => c.key === "protein")!.alue;
    expect(alue()).toEqual({ ala: 14, yla: null });
    expect(alue({ ...OLETUSALUEET, protein: { alle: 0, yli: null } })).toEqual({
      ala: 16,
      yla: null,
    });
    expect(alue({ ...OLETUSALUEET, protein: { alle: 10, yli: 50 } })).toEqual({
      ala: 14,
      yla: 24,
    });
    const ilman = emptyDataset();
    expect(macroCharts(ilman, end).every((c) => c.alue === null)).toBe(true);
  });

  it("tiukempi alaraja pudottaa samat päivät alueelta", () => {
    expect(piirra(paivat())).toContain("Tavoitealueella 2 päivänä 2:sta.");
    expect(
      piirra(paivat({ ...OLETUSALUEET, protein: { alle: 0, yli: null } })),
    ).toContain("Tavoitealueella 0 päivänä 2:sta.");
  });

  it("proteiinin yläraja: ylittänyt päivä ei ole alueella", () => {
    // 15 g on yli alueen 9–11 g (tavoite 10 g, −10/+10 %)
    const d = paivat({ ...OLETUSALUEET, protein: { alle: 10, yli: 10 } });
    d.goals[0].nutrients.protein = 10;
    expect(piirra(d)).toContain("Tavoitealueella 0 päivänä 2:sta.");
  });
});

describe("lomakkeen prosenttikentät", () => {
  it("alueStrings ja parseAlueet ovat toistensa käänteiset; tyhjä yli on ei ylärajaa", () => {
    const kentat = alueStrings(TIUKAT);
    expect(kentat.energy).toEqual({ alle: "10", yli: "5" });
    expect(kentat.protein).toEqual({ alle: "5", yli: "" });
    expect(kentat.fat).toEqual({ alle: "25", yli: "0" });
    expect(parseAlueet(kentat)).toEqual(TIUKAT);
    expect(parseAlueet(alueStrings(OLETUSALUEET))).toEqual(OLETUSALUEET);
    expect(parseAlue({ alle: " 7 ", yli: "  " })).toEqual({
      alle: 7,
      yli: null,
    });
  });

  it("kelvoton rivi: null esikatselussa ja suomenkielinen virhe tallennuksessa", () => {
    for (const rivi of [
      { alle: "", yli: "10" },
      { alle: "10,5", yli: "10" },
      { alle: "-5", yli: "10" },
      { alle: "51", yli: "10" },
      { alle: "10", yli: "101" },
      { alle: "10", yli: "x" },
      { alle: "1e1", yli: "" },
      { alle: "0010", yli: "" },
    ]) {
      expect(parseAlue(rivi), JSON.stringify(rivi)).toBeNull();
      const kentat = { ...alueStrings(OLETUSALUEET), carbs: rivi };
      expect(() => parseAlueet(kentat)).toThrow(
        "Tavoitealue, hiilihydraatit: alle 0–50 ja yli 0–100 kokonaisina prosentteina.",
      );
    }
    expect(parseAlue({ alle: "50", yli: "100" })).toEqual({
      alle: ALLE_MAX,
      yli: YLI_MAX,
    });
    expect(parseAlue({ alle: "0", yli: "0" })).toEqual({ alle: 0, yli: 0 });
  });
});

describe("tavoitealueet tallentuvat tavoitteen mukana", () => {
  const arvot: Nutrients = {
    energy: 2000,
    protein: 150,
    carbs: 200,
    fat: 60,
    fiber: 30,
  };
  const { fiber: _kuitu, ...EHDOTETUT } = TIUKAT;

  it("skeema: alueet on valinnainen, mutta annettuna täydellinen ja rajoissa", () => {
    const g = tavoite(arvot, TIUKAT);
    expect(goalSchema.parse(g).alueet).toEqual(TIUKAT);
    expect(goalSchema.parse(tavoite(arvot)).alueet).toBeUndefined();
    for (const huono of [
      { ...TIUKAT, energy: { alle: 51, yli: 5 } },
      { ...TIUKAT, energy: { alle: 10, yli: 101 } },
      { ...TIUKAT, energy: { alle: 2.5, yli: 5 } },
      { ...TIUKAT, energy: { alle: null, yli: 5 } },
      { ...TIUKAT, energy: { alle: 10 } },
      { ...TIUKAT, energy: { alle: 10, yli: 5, muu: 1 } },
      (({ fiber: _pois, ...muut }) => muut)(TIUKAT),
      { ...TIUKAT, sokeri: { alle: 10, yli: 5 } },
    ])
      expect(
        goalSchema.safeParse({ ...g, alueet: huono }).success,
        JSON.stringify(huono),
      ).toBe(false);
    expect(Object.keys(OLETUSALUEET)).toEqual([...keys]);
    expect(alueetSchema.parse(OLETUSALUEET)).toEqual(OLETUSALUEET);
  });

  it("lomake: annetut alueet tallentuvat; ilman niitä voimassa olevan tavoitteen alueet säilyvät", () => {
    const vanha = tavoite(arvot, TIUKAT);
    const oma: Alueet = { ...OLETUSALUEET, fat: { alle: 30, yli: 5 } };
    expect(
      tavoiteLomakkeesta(arvot, null, "2026-11-25", vanha, oma).alueet,
    ).toEqual(oma);
    expect(tavoiteLomakkeesta(arvot, null, "2026-11-25", vanha).alueet).toEqual(
      TIUKAT,
    );
    const ilman = tavoiteLomakkeesta(arvot, null, "2026-11-25", tavoite(arvot));
    expect("alueet" in ilman).toBe(false);
    expect(goalSchema.parse(ilman).alueet).toBeUndefined();
  });

  it("hyväksytty ehdotus: mallin alueet neljälle luvulle, kuidun alue säilyy ennallaan", () => {
    const kuitu = { alle: 30, yli: null };
    const vanha = tavoite(arvot, { ...OLETUSALUEET, fiber: kuitu });
    const goal = hyvaksyTavoite(arvot, "2026-11-25", vanha, EHDOTETUT);
    expect(goalSchema.parse(goal).alueet).toEqual({ ...TIUKAT, fiber: kuitu });
    // ilman aiempia alueita kuitu saa oletuksen
    expect(
      hyvaksyTavoite(arvot, "2026-11-25", tavoite(arvot), EHDOTETUT).alueet,
    ).toEqual({ ...TIUKAT, fiber: OLETUSALUEET.fiber });
    expect(
      hyvaksyTavoite(arvot, "2026-11-25", undefined, EHDOTETUT).alueet,
    ).toEqual({ ...TIUKAT, fiber: OLETUSALUEET.fiber });
    // ilman ehdotettuja alueita voimassa olevat säilyvät
    expect(hyvaksyTavoite(arvot, "2026-11-25", vanha).alueet).toEqual(
      vanha.alueet,
    );
    expect("alueet" in hyvaksyTavoite(arvot, "2026-11-25")).toBe(false);
  });

  it("kanta, synkronointi ja varmuuskopio kuljettavat alueet muuttumattomina", async () => {
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    const g = tavoite(arvot, TIUKAT, "2026-11-25");
    await saveGoal(g, db);
    expect((await readDataset(db)).goals[0].alueet).toEqual(TIUKAT);
    const muutokset = await paikallisetMuutokset(db);
    expect(muutokset).toHaveLength(1);
    expect(muutokset[0].data).toMatchObject({ id: g.id, alueet: TIUKAT });
    // toinen laite saa saman tietueen palvelimelta
    const toinen = new DiaryDB("test-" + id());
    databases.push(toinen);
    await sovellaEtamuutokset([{ ...muutokset[0], seq: 1 }], 1, toinen);
    const saatu = (await readDataset(toinen)).goals;
    expect(saatu).toHaveLength(1);
    expect(goalSchema.parse(saatu[0]).alueet).toEqual(TIUKAT);
    expect(await paikallisetMuutokset(toinen)).toEqual([]);
    const kopio = parseBackup(JSON.stringify(await exportBackup(db)));
    expect(kopio.data.goals[0].alueet).toEqual(TIUKAT);
  });
});
