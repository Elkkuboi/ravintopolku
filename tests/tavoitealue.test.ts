// Tavoitealue: päivän hyväksytty vaihtelu yhden tavoitteen ympärillä. Sääntö (domain/nutrition.ts), mittarin
// asteikko ja tekstit (components/makromittarit.ts) sekä Tänään-sivun mittarien piirto (MakroMittarit.tsx).
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  keys,
  emptyDataset,
  emptyNutrients,
  stamped,
  type Dataset,
  type Goal,
} from "../src/domain/model";
import { addDays, localDay } from "../src/domain/dates";
import Kehitys from "../src/nakymat/Kehitys";
import { meal } from "./fixtures";
import {
  TAVOITEALUE,
  aggregate,
  osuma,
  tavoitealue,
  type Total,
} from "../src/domain/nutrition";
import {
  asteikko,
  energiaJaljella,
  energiaTavoite,
  makroOsat,
  makroTeksti,
  meterReading,
  mittariTeksti,
} from "../src/components/makromittarit";
import { MakroMittarit } from "../src/components/MakroMittarit";

const total = (value: number | null, known = 1, missing = 0): Total => ({
  value,
  known,
  missing,
  partial: missing > 0,
});
const nbsp = (s: string) => s.replace(/ /g, " ");
const laske = (html: string, s: string) => html.split(s).length - 1;

describe("tavoitealueen sääntö", () => {
  it("energia ±10 %, hiilihydraatit ja rasva ±20 %, proteiini ja kuitu vähintään 90 %", () => {
    expect(tavoitealue("energy", 2300)).toEqual({ ala: 2070, yla: 2530 });
    expect(tavoitealue("carbs", 260)).toEqual({ ala: 208, yla: 312 });
    expect(tavoitealue("fat", 75)).toEqual({ ala: 60, yla: 90 });
    expect(tavoitealue("protein", 140)).toEqual({ ala: 126, yla: null });
    expect(tavoitealue("fiber", 30)).toEqual({ ala: 27, yla: null });
  });

  it("jokaisella ravintoaineella on sääntö, ja tavoite on aina alueen sisällä", () => {
    for (const k of keys) {
      const { ala, yla } = TAVOITEALUE[k];
      expect(ala).toBeGreaterThan(0);
      expect(ala).toBeLessThan(1);
      if (yla !== null) expect(yla).toBeGreaterThan(1);
      expect(osuma(100, tavoitealue(k, 100))).toBe("sisalla");
    }
  });

  it("rajat pyöristetään kokonaisiksi yksiköiksi", () => {
    expect(tavoitealue("energy", 1850)).toEqual({ ala: 1665, yla: 2035 });
    expect(tavoitealue("protein", 12)).toEqual({ ala: 11, yla: null });
    expect(tavoitealue("fat", 62.5)).toEqual({ ala: 50, yla: 75 });
  });

  it("ei aluetta ilman tavoitetta, nollatavoitteella tai kun alaraja pyöristyy nollaan", () => {
    for (const goal of [null, undefined, 0, -5, 0.3])
      expect(tavoitealue("energy", goal)).toBeNull();
    expect(tavoitealue("fiber", 0.5)).toBeNull();
    expect(tavoitealue("fiber", 1)).toEqual({ ala: 1, yla: null });
  });

  it("rajat kuuluvat alueeseen; yksikin yksikkö ulkona on ulkona", () => {
    const e = tavoitealue("energy", 2300);
    expect(osuma(2070, e)).toBe("sisalla");
    expect(osuma(2530, e)).toBe("sisalla");
    expect(osuma(2069, e)).toBe("alle");
    expect(osuma(2531, e)).toBe("yli");
    expect(osuma(0, e)).toBe("alle");
  });

  it("vertailu tehdään näytetyllä luvulla: 2 530,4 näkyy 2 530:nä ja on alueella", () => {
    const e = tavoitealue("energy", 2300);
    expect(osuma(2530.4, e)).toBe("sisalla");
    expect(osuma(2530.6, e)).toBe("yli");
    expect(osuma(2069.5, e)).toBe("sisalla");
    expect(osuma(2069.4, e)).toBe("alle");
  });

  it("vähintään-tavoitteella ei ole ylitystä", () => {
    const p = tavoitealue("protein", 140);
    expect(osuma(125, p)).toBe("alle");
    expect(osuma(126, p)).toBe("sisalla");
    expect(osuma(150, p)).toBe("sisalla");
    expect(osuma(400, p)).toBe("sisalla");
  });

  it("alaraja (osittainen summa) todistaa vain ylityksen tai vähintään-tavoitteen täyttymisen", () => {
    const e = tavoitealue("energy", 2300),
      p = tavoitealue("protein", 140);
    expect(osuma(2600, e, true)).toBe("yli");
    expect(osuma(2300, e, true)).toBeNull(); // voi vielä ylittää
    expect(osuma(1000, e, true)).toBeNull(); // ei tiedetä, ei "alle"
    expect(osuma(130, p, true)).toBe("sisalla"); // vähintään 126 on jo varmaa
    expect(osuma(100, p, true)).toBeNull();
  });

  it("tuntematon luku tai puuttuva alue ei ole mikään osuma", () => {
    expect(osuma(null, tavoitealue("energy", 2300))).toBeNull();
    expect(osuma(2300, null)).toBeNull();
  });
});

describe("mittarin asteikko", () => {
  it("kaksisuuntainen: palkki on täynnä alueen ylärajalla, alue on pääty ja tavoite merkki sen sisällä", () => {
    const a = asteikko("energy", meterReading(total(1150), 2300))!;
    expect(a.alue).toEqual({ ala: 2070, yla: 2530 });
    expect(a.alku).toBeCloseTo((2070 / 2530) * 100, 5);
    expect(a.tavoite).toBeCloseTo((2300 / 2530) * 100, 5);
    expect(a.taytto).toBeCloseTo((1150 / 2530) * 100, 5);
    expect(a.alku).toBeLessThan(a.tavoite!);
    expect(a).toMatchObject({ osuma: "alle", varoitus: false });
  });

  it("vähintään-tavoite: palkki on täynnä tavoitteessa, alue on viimeinen kymmenys eikä merkkiä ole", () => {
    const a = asteikko("protein", meterReading(total(70), 140))!;
    expect(a).toMatchObject({
      alku: 90,
      tavoite: null,
      taytto: 50,
      osuma: "alle",
      varoitus: false,
    });
    expect(asteikko("protein", meterReading(total(150), 140))).toMatchObject({
      taytto: 100,
      osuma: "sisalla",
      varoitus: false,
    });
  });

  it("ylitys varoittaa vain energialla; muilla palkki on täysi ilman varoitusta", () => {
    expect(asteikko("energy", meterReading(total(2600), 2300))).toMatchObject({
      taytto: 100,
      osuma: "yli",
      varoitus: true,
    });
    for (const k of ["carbs", "fat"] as const)
      expect(asteikko(k, meterReading(total(500), 100))).toMatchObject({
        taytto: 100,
        osuma: "yli",
        varoitus: false,
      });
    // tavoitteen yli mutta alueella: ei varoitusta energiallakaan
    expect(asteikko("energy", meterReading(total(2420), 2300))).toMatchObject({
      osuma: "sisalla",
      varoitus: false,
    });
  });

  it("tyhjä päivä on alle ja alue näkyy heti; osittainen summa alueella jää ratkaisematta", () => {
    expect(
      asteikko("energy", meterReading(total(null, 0, 0), 2300)),
    ).toMatchObject({ taytto: 0, osuma: "alle" });
    const auki = asteikko("energy", meterReading(total(2200, 3, 1), 2300))!;
    expect(auki.osuma).toBeNull();
    expect(auki.varoitus).toBe(false);
    expect(
      asteikko("energy", meterReading(total(2600, 3, 1), 2300)),
    ).toMatchObject({ osuma: "yli", varoitus: true });
    expect(asteikko("fiber", meterReading(total(28, 3, 1), 30))).toMatchObject({
      osuma: "sisalla",
    });
  });

  it("ei asteikkoa ilman tavoitetta, nollatavoitteella tai tuntemattomalla summalla", () => {
    expect(asteikko("energy", meterReading(total(100), null))).toBeNull();
    expect(asteikko("energy", meterReading(total(100), 0))).toBeNull();
    expect(
      asteikko("energy", meterReading(total(null, 0, 2), 2300)),
    ).toBeNull();
  });
});

describe("mittarin tekstit", () => {
  const lue = (kcal: number | null, known = 1, missing = 0) => {
    const r = meterReading(total(kcal, known, missing), 2300);
    return { r, a: asteikko("energy", r) };
  };

  it("otsikossa yksi tavoite ja sen alue; ilman aluetta vain tavoite", () => {
    expect(nbsp(energiaTavoite(lue(1000).r))).toBe(
      "tavoite 2 300 (2 070–2 530) kcal",
    );
    // alue riippuu vain tavoitteesta: sama otsikko tyhjänä päivänä ja kun energiaa ei tiedetä
    expect(nbsp(energiaTavoite(lue(null, 0, 0).r))).toBe(
      "tavoite 2 300 (2 070–2 530) kcal",
    );
    expect(nbsp(energiaTavoite(lue(null, 0, 1).r))).toBe(
      "tavoite 2 300 (2 070–2 530) kcal",
    );
    expect(energiaTavoite(meterReading(total(10), 0))).toBe("tavoite 0 kcal");
    expect(energiaTavoite(meterReading(total(10), null))).toBe("ei tavoitetta");
  });

  it("jäljellä ja yli lasketaan aina yhdestä tavoitteesta; luokka kertoo osuman", () => {
    const jaljella = (kcal: number | null, known = 1, missing = 0) => {
      const { r, a } = lue(kcal, known, missing);
      const j = energiaJaljella(r, a);
      return j && [nbsp(j.teksti), j.luokka];
    };
    expect(jaljella(1850)).toEqual(["450 jäljellä", null]);
    expect(jaljella(2070)).toEqual(["230 jäljellä", "osui"]);
    expect(jaljella(2300)).toEqual(["0 jäljellä", "osui"]);
    expect(jaljella(2420)).toEqual(["yli 120", "osui"]);
    expect(jaljella(2530)).toEqual(["yli 230", "osui"]);
    expect(jaljella(2531)).toEqual(["yli 231", "yli"]);
    // osittainen summa: ei vihreää, vaikka luku on alueella; varma ylitys varoittaa
    expect(jaljella(2200, 3, 1)).toEqual(["enint. 100 jäljellä", null]);
    expect(jaljella(2400, 3, 1)).toEqual(["yli 100", null]);
    expect(jaljella(2600, 3, 1)).toEqual(["yli 300", "yli"]);
    expect(jaljella(null, 0, 0)).toEqual(["2 300 jäljellä", null]);
    expect(jaljella(null, 0, 2)).toBeNull();
    // teksti lasketaan näytetyistä luvuista: 2 300,4 näkyy 2 300:na eikä ole "yli 0"
    expect(jaljella(2300.4)).toEqual(["0 jäljellä", "osui"]);
    expect(jaljella(2300.6)).toEqual(["yli 1", "osui"]);
    expect(jaljella(2299.6)).toEqual(["0 jäljellä", "osui"]);
  });

  it("makrorivin luku kahtena osana on sama teksti kuin ennen", () => {
    for (const r of [
      meterReading(total(84), 100),
      meterReading(total(84, 2, 1), 100),
      meterReading(total(84), null),
      meterReading(total(null, 0, 0), 30),
      meterReading(total(null, 0, 2), 30),
    ])
      expect(makroOsat(r).join("")).toBe(makroTeksti(r));
    expect(makroOsat(meterReading(total(84, 2, 1), 100))).toEqual([
      "≥84",
      " / 100 g",
    ]);
    expect(makroOsat(meterReading(total(null, 0, 2), 30))).toEqual([
      "ei tietoa",
      "",
    ]);
  });

  it("ruudunlukija kuulee luvun, tavoitteen ja osuman sanana", () => {
    const teksti = (kcal: number) => {
      const { r, a } = lue(kcal);
      return nbsp(mittariTeksti(r, a, "kcal"));
    };
    expect(teksti(1850)).toBe("1 850 kcal, tavoite 2 300 kcal");
    expect(teksti(2420)).toBe(
      "2 420 kcal, tavoite 2 300 kcal, tavoitealueella",
    );
    expect(teksti(2600)).toBe(
      "2 600 kcal, tavoite 2 300 kcal, yli tavoitealueen",
    );
    const p = meterReading(total(150), 140);
    expect(mittariTeksti(p, asteikko("protein", p), "g")).toBe(
      "150 g, tavoite 140 g, tavoitealueella",
    );
  });
});

describe("Kehitys-sivun tavoitepäivät", () => {
  const piirra = (data: Dataset) =>
    renderToStaticMarkup(
      createElement(Kehitys, {
        data,
        notify: () => {},
        run: async (f: () => Promise<void>) => f(),
      }),
    );
  // fixtures.meal: 15 g proteiinia. Tavoite 16 g: alue alkaa 14 g:sta, joten 15 g on alueella mutta alle tavoitteen.
  const data = (proteiini: number): Dataset => {
    const end = localDay();
    const d = emptyDataset();
    d.goals = [
      {
        ...stamped(),
        effectiveDate: addDays(end, -30),
        kind: "track",
        targetWeight: null,
        targetDate: null,
        nutrients: { ...emptyNutrients(), protein: proteiini },
      },
    ];
    d.meals = [meal(addDays(end, -2)), meal(addDays(end, -1))];
    return d;
  };

  it("päivä alueella mutta alle tavoitteen lasketaan; lause nimeää alueen", () => {
    expect(tavoitealue("protein", 16)).toEqual({ ala: 14, yla: null });
    const html = piirra(data(16));
    expect(html).toContain("tavoite 16 g");
    expect(html).toContain("Tavoitealueella 2 päivänä 2:sta.");
    expect(html).not.toContain("Tavoite täyttyi");
  });

  it("päivä alueen alla ei osu; nollatavoitteella lausetta ei ole", () => {
    expect(tavoitealue("protein", 18)).toEqual({ ala: 16, yla: null });
    expect(piirra(data(18))).toContain("Tavoitealueella 0 päivänä 2:sta.");
    const nolla = piirra(data(0));
    expect(nolla).not.toContain("Tavoitealueella");
    expect(nolla).not.toContain("Ei vielä valmiita päiviä");
  });
});

describe("Tänään-sivun mittarit piirrettynä", () => {
  const goal: Goal = {
    ...stamped(),
    effectiveDate: "2026-01-01",
    kind: "lose",
    targetWeight: 77,
    targetDate: "2027-03-01",
    nutrients: { energy: 2300, protein: 140, carbs: 260, fat: 75, fiber: 30 },
  };
  const piirra = (
    arvot: Partial<Record<(typeof keys)[number], number | null>> | null,
    tavoite: Goal | null = goal,
  ) =>
    renderToStaticMarkup(
      createElement(MakroMittarit, {
        totals: aggregate(arvot ? [{ ...emptyNutrients(), ...arvot }] : []),
        goal: tavoite ?? undefined,
      }),
    );

  it("tyhjä päivä: alue ja tavoitteen merkki näkyvät, mikään ei vihreä", () => {
    const html = piirra(null);
    expect(nbsp(html)).toContain("tavoite 2 300 (2 070–2 530) kcal");
    expect(laske(html, 'class="meter-alue"')).toBe(5);
    // merkki vain kaksisuuntaisilla: energia, hiilihydraatit ja rasva
    expect(laske(html, 'class="meter-tavoite"')).toBe(3);
    expect(html).not.toContain("osui");
    expect(html).not.toContain("meter-osuma");
    expect(html).not.toContain("meter--over");
  });

  it("alle alueen: täyttö ilman vihreää", () => {
    const html = piirra({
      energy: 850,
      protein: 45,
      carbs: 90,
      fat: 28,
      fiber: 8,
    });
    expect(html).toContain('<span class="figure-num">850</span>');
    expect(nbsp(html)).toContain(
      '<span class="figure-of">1 450 jäljellä</span>',
    );
    expect(html).not.toContain("osui");
    expect(html).not.toContain("meter-osuma");
  });

  it("alueella: luvut vihertävät, palkissa osuma, ei varoitusta vaikka tavoite ylittyy", () => {
    const html = piirra({
      energy: 2420,
      protein: 152,
      carbs: 285,
      fat: 80,
      fiber: 33,
    });
    expect(nbsp(html)).toContain('<span class="figure-num osui">2 420</span>');
    expect(html).toContain('<span class="figure-of osui">yli 120</span>');
    expect(laske(html, 'class="meter-osuma"')).toBe(5);
    for (const luku of ["152", "285", "80", "33"])
      expect(html).toContain(`<span class="osui">${luku}</span>`);
    expect(html).not.toContain("meter--over");
    expect(nbsp(html)).toContain(
      'aria-valuetext="2 420 kcal, tavoite 2 300 kcal, tavoitealueella"',
    );
  });

  it("yli alueen: energia varoittaa, hiilihydraatit ja rasva eivät; proteiini ja kuitu pysyvät vihreinä", () => {
    const html = piirra({
      energy: 2680,
      protein: 170,
      carbs: 330,
      fat: 95,
      fiber: 40,
    });
    expect(nbsp(html)).toContain('<span class="figure-num">2 680</span>');
    expect(html).toContain('<span class="figure-of yli">yli 380</span>');
    expect(laske(html, "meter--over")).toBe(1);
    expect(html).toContain('class="meter meter--over"');
    expect(html).toContain('<span class="osui">170</span>');
    expect(html).toContain('<span class="osui">40</span>');
    expect(html).not.toContain('<span class="osui">330</span>');
    expect(html).not.toContain('<span class="osui">95</span>');
    expect(laske(html, 'class="meter-osuma"')).toBe(2);
  });

  it("osittainen summa alueella ei vihreä; ilman tavoitetta ei aluetta eikä mittaria", () => {
    const osittainen = renderToStaticMarkup(
      createElement(MakroMittarit, {
        totals: aggregate([
          { ...emptyNutrients(), energy: 2200, protein: 130 },
          emptyNutrients(),
        ]),
        goal,
      }),
    );
    expect(nbsp(osittainen)).toContain('<span class="figure-num">2 200</span>');
    expect(osittainen).toContain("enint. 100 jäljellä");
    // proteiini on vähintään-tavoite: alaraja 130 ≥ 126 riittää
    expect(osittainen).toContain('<span class="osui">≥130</span>');
    const ilman = piirra({ energy: 2300 }, null);
    expect(ilman).toContain("ei tavoitetta");
    expect(ilman).not.toContain("meter-alue");
    expect(ilman).not.toContain('role="meter"');
  });

  it("nollatavoite toimii kuten ennen: ei aluetta, ylitys varoittaa", () => {
    const html = piirra(
      { energy: 5 },
      { ...goal, nutrients: { ...emptyNutrients(), energy: 0 } },
    );
    expect(html).toContain("tavoite 0 kcal");
    expect(html).not.toContain("meter-alue");
    expect(html).toContain('class="meter meter--over"');
    expect(html).toContain('<span class="figure-of yli">yli 5</span>');
  });
});
