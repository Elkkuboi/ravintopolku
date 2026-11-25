import { describe, it, expect } from "vitest";
import {
  emptyDataset,
  emptyNutrients,
  stamped,
  type Goal,
} from "../src/domain/model";
import {
  chartDays,
  elatiivi,
  jaksonKeskiarvo,
  jaksonPituus,
  macroCharts,
  macroSummary,
  paivaPylvaat,
  paivaTeksti,
  shortDate,
  tavoitePaivat,
  viikkoPylvaat,
  viikkoPylvaina,
  VIIKOITTAIN_YLI,
  type MacroPoint,
} from "../src/components/makrokuvaajat";
import { tavoitealue } from "../src/domain/nutrition";
import { line, meal } from "./fixtures";
const goal = (effectiveDate: string, energy: number | null): Goal => ({
  ...stamped(),
  effectiveDate,
  kind: "maintain",
  targetWeight: null,
  targetDate: null,
  nutrients: {
    ...emptyNutrients(),
    energy,
    protein: 90,
    carbs: null,
    fat: null,
  },
});
describe("Makrosarjat", () => {
  it("näyttää energian, rasvan, hiilihydraatit ja proteiinin oikeilla yksiköillä", () => {
    const charts = macroCharts(emptyDataset(), "2026-10-08");
    expect(charts.map((c) => c.key)).toEqual([
      "energy",
      "protein",
      "carbs",
      "fat",
    ]);
    expect(charts.map((c) => c.unit)).toEqual(["kcal", "g", "g", "g"]);
    expect(charts.map((c) => c.label)).toEqual([
      "Energia",
      "Proteiini",
      "Hiilihydraatit",
      "Rasva",
    ]);
  });
  it("jakso on seitsemän kalenteripäivää ja päättyy katsottuun päivään", () => {
    expect(chartDays).toBe(7);
    const [first, ...rest] = macroCharts(emptyDataset(), "2026-10-08")[0]
      .points;
    expect(rest.at(-1)!.date).toBe("2026-10-08");
    expect(first.date).toBe("2026-10-02");
    expect(shortDate("2026-10-08")).toBe("8.10.");
  });
  it("tyhjällä päiväkirjalla ei ole dataa eikä keskiarvoa", () => {
    const charts = macroCharts(emptyDataset(), "2026-10-08");
    expect(charts.every((c) => !c.hasData && c.mean.value === null)).toBe(true);
    expect(charts.every((c) => c.goal === null)).toBe(true);
    expect(macroCharts(emptyDataset(), "2026-10-08", 3)[0].points).toHaveLength(
      3,
    );
  });
  it("kirjatut päivät näkyvät palkkeina, puuttuvat päivät eivät muutu nolliksi", () => {
    const d = emptyDataset();
    d.meals = [meal("2026-10-06"), meal("2026-10-08")];
    const energy = macroCharts(d, "2026-10-08")[0];
    expect(energy.hasData).toBe(true);
    expect(energy.points.map((p) => p.value)).toEqual([
      null,
      null,
      null,
      null,
      300,
      null,
      300,
    ]);
    expect(energy.points.every((p) => !p.partial)).toBe(true);
    expect(energy.mean).toEqual({ value: 300, count: 2 });
  });
  it("osittainen summa merkitään eikä sitä oteta keskiarvoon", () => {
    const d = emptyDataset();
    const partial = meal("2026-10-07");
    // toinen rivi ei sisällä energiaa eikä proteiinia → summista tulee osittaisia
    partial.lines.push({
      ...line(),
      values: { ...emptyNutrients(), carbs: 10 },
    });
    d.meals = [meal("2026-10-06"), partial];
    const [energy, protein] = macroCharts(d, "2026-10-08");
    expect(energy.points[5]).toMatchObject({
      date: "2026-10-07",
      value: 300,
      partial: true,
    });
    expect(protein.points[5]).toMatchObject({ value: 15, partial: true });
    expect(protein.mean).toEqual({ value: 15, count: 1 });
    expect(energy.mean).toEqual({ value: 300, count: 1 });
  });
  it("kokonaan tuntematon arvo ei näy eivätkä kirjaamattomat päivät laske keskiarvoa", () => {
    const d = emptyDataset();
    d.meals = [meal("2026-10-08")];
    const fat = macroCharts(d, "2026-10-08").find((c) => c.key === "fat")!;
    expect(fat.hasData).toBe(false);
    expect(fat.points.every((p) => p.value === null)).toBe(true);
    expect(fat.mean).toEqual({ value: null, count: 0 });
  });
  it("tavoitekatkoviiva otetaan katsottuun päivään asti voimassa olevasta tavoitteesta", () => {
    const d = emptyDataset();
    d.goals = [goal("2026-10-01", 1800), goal("2026-10-06", 2400)];
    const later = macroCharts(d, "2026-10-08");
    expect(later.find((c) => c.key === "energy")!.goal).toBe(2400);
    expect(later.find((c) => c.key === "protein")!.goal).toBe(90);
    expect(later.find((c) => c.key === "fat")!.goal).toBeNull();
    const earlier = macroCharts(d, "2026-10-03");
    expect(earlier[0].goal).toBe(1800);
  });
  it("äänilukija saa päivät, puuttuvat arvot, keskiarvon ja tavoitteen", () => {
    const d = emptyDataset();
    d.goals = [goal("2026-10-01", 950)];
    d.meals = [meal("2026-10-08")];
    const energy = macroCharts(d, "2026-10-08")[0];
    const text = macroSummary(energy);
    expect(text).toContain("Energia, 7 päivän kuvaaja");
    expect(text).toContain("8.10. 300 kcal");
    expect(text).toContain("2.10. ei tietoa");
    expect(text).toContain("Keskiarvo 300 kcal 1 päivältä");
    expect(text).toContain("Tavoite 950 kcal");
  });
});

describe("Kehityksen jakso", () => {
  it("7, 30 ja 90 päivää ovat kiinteitä; kaikki ulottuu ensimmäiseen kirjaukseen tai punnitukseen", () => {
    const d = emptyDataset();
    expect(jaksonPituus(d, "2026-11-19", 30)).toBe(30);
    expect(jaksonPituus(d, "2026-11-19", "kaikki")).toBe(7);
    d.meals = [meal("2026-10-01")];
    expect(jaksonPituus(d, "2026-11-19", "kaikki")).toBe(50);
    d.weights = [
      { ...stamped(), date: "2026-09-20", kg: 80, note: "" },
      // tulevaisuuteen kirjattu ei pidennä jaksoa
      { ...stamped(), date: "2026-12-01", kg: 80, note: "" },
    ];
    expect(jaksonPituus(d, "2026-11-19", "kaikki")).toBe(61);
  });
  it("kaikki on vähintään viikko, vaikka kirjauksia olisi vain pari päivää", () => {
    const d = emptyDataset();
    d.meals = [meal("2026-11-18")];
    expect(jaksonPituus(d, "2026-11-19", "kaikki")).toBe(7);
  });
  it("akselin päivämäärään tulee vuosi vain, kun se on eri kuin jakson lopussa", () => {
    expect(paivaTeksti("2026-10-20", "2026-11-19")).toBe("20.10.");
    expect(paivaTeksti("2025-03-02", "2026-11-19")).toBe("2.3.2025");
  });
});

describe("Kehityksen keskiarvo ja tavoitepäivät", () => {
  const p = (
    date: string,
    value: number | null,
    partial = false,
  ): MacroPoint => ({
    date,
    value,
    partial,
  });
  const end = "2026-11-19";
  it("keskeneräinen tämä päivä ei laske keskiarvoa, valmiiksi merkitty laskee", () => {
    const d = emptyDataset();
    const points = [p("2026-11-17", 2000), p("2026-11-18", 2200), p(end, 400)];
    expect(jaksonKeskiarvo(d, end, points)).toEqual({ value: 2100, count: 2 });
    d.days = [{ ...stamped(), date: end, complete: true }];
    expect(jaksonKeskiarvo(d, end, points).count).toBe(3);
  });
  it("osittaiset ja puuttuvat päivät jäävät keskiarvon ulkopuolelle", () => {
    const points = [
      p("2026-11-16", 2000),
      p("2026-11-17", 900, true),
      p("2026-11-18", null),
    ];
    expect(jaksonKeskiarvo(emptyDataset(), end, points)).toEqual({
      value: 2000,
      count: 1,
    });
  });
  it("vähintään-tavoite täyttyy alueen alarajasta; osittainen alaraja riittää, jos se yltää alueelle", () => {
    // proteiini 100 g: alue vähintään 90 g, ei ylärajaa (sama sääntö kuin Tänään-sivun mittarissa)
    const alue = tavoitealue("protein", 100)!;
    expect(alue).toEqual({ ala: 90, yla: null });
    const points = [
      p("2026-11-13", 250), // reilusti yli: vähintään-tavoitteessa ei ylärajaa
      p("2026-11-14", 90), // alarajalla: täyttyi
      p("2026-11-15", 89), // juuri alle: ei täyttynyt
      p("2026-11-16", 95, true), // osittainen mutta alueella: täyttyi varmasti
      p("2026-11-17", 60, true), // osittainen ja alle: ei tiedetä
      p("2026-11-18", null),
      p(end, 40), // tänään kesken: ei tiedetä
    ];
    expect(tavoitePaivat(emptyDataset(), end, points, alue)).toEqual({
      taytti: 3,
      paivia: 4,
    });
    expect(tavoitePaivat(emptyDataset(), end, [p(end, 92)], alue)).toEqual({
      taytti: 1,
      paivia: 1,
    });
  });
  it("kaksisuuntainen alue: ylitys ei ole osuma, ja alaraja todistaa vain ylityksen", () => {
    const alue = tavoitealue("energy", 2000)!; // 1800–2200
    const points = [
      p("2026-11-13", 1800),
      p("2026-11-14", 2200),
      p("2026-11-15", 2201), // yli: tiedetään, ei osuma
      p("2026-11-16", 1799), // alle: tiedetään, ei osuma
      p("2026-11-17", 2000, true), // osittainen alueella: voi vielä ylittää, ei tiedetä
      p("2026-11-18", 2500, true), // osittainen jo yli: tiedetään
      p(end, 2000), // tänään kesken alueella: ei tiedetä
    ];
    expect(tavoitePaivat(emptyDataset(), end, points, alue)).toEqual({
      taytti: 2,
      paivia: 5,
    });
    // valmiiksi merkitty tämä päivä lasketaan
    const valmis = emptyDataset();
    valmis.days = [{ ...stamped(), date: end, complete: true }];
    expect(tavoitePaivat(valmis, end, [p(end, 2000)], alue)).toEqual({
      taytti: 1,
      paivia: 1,
    });
  });
  it("lukumäärän elatiivi: 14:stä, 12:sta, 30:stä, 100:sta", () => {
    expect(
      [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 20, 30, 41, 90, 100, 110,
        200, 1000,
      ].map(elatiivi),
    ).toEqual([
      "1:stä",
      "2:sta",
      "3:sta",
      "4:stä",
      "5:stä",
      "6:sta",
      "7:stä",
      "8:sta",
      "9:stä",
      "10:stä",
      "11:stä",
      "12:sta",
      "14:stä",
      "20:stä",
      "30:stä",
      "41:stä",
      "90:stä",
      "100:sta",
      "110:stä",
      "200:sta",
      "1000:sta",
    ]);
  });
});

describe("Energian pylväät pitkällä jaksolla", () => {
  const end = "2026-11-19";
  it("30 päivään asti pylväs on päivä, 90 päivää ja kaikki yli 30 päivän viikon keskiarvo", () => {
    expect(VIIKOITTAIN_YLI).toBe(30);
    expect([7, 30].map(viikkoPylvaina)).toEqual([false, false]);
    expect([31, 90, 400].map(viikkoPylvaina)).toEqual([true, true, true]);
    // 90 päivää: 13 pylvästä (12 täyttä viikkoa ja kuuden päivän alku), ei 90 kapeaa päiväpylvästä.
    const [pitka] = macroCharts(emptyDataset(), end, 90);
    expect(viikkoPylvaat(emptyDataset(), end, pitka.points)).toHaveLength(13);
    const d = emptyDataset();
    d.meals = [meal("2026-11-18")];
    const [energia] = macroCharts(d, end, 7);
    expect(paivaPylvaat(energia.points).map((p) => p.nimi)).toEqual([
      "13.11.",
      "14.11.",
      "15.11.",
      "16.11.",
      "17.11.",
      "18.11.",
      "19.11.",
    ]);
  });
  it("viikot lasketaan jakson lopusta taaksepäin; vanhin viikko voi olla lyhyempi", () => {
    const [energia] = macroCharts(emptyDataset(), end, 100);
    const viikot = viikkoPylvaat(emptyDataset(), end, energia.points);
    expect(viikot).toHaveLength(15);
    expect(viikot.at(-1)!.nimi).toBe("13.11.–19.11. keskiarvo");
    // 100 = 14 × 7 + 2: jakso alkaa 12.8., joten vanhimmassa viikossa on kaksi päivää
    expect(viikot[0].nimi).toBe("12.8.–13.8. keskiarvo");
    expect(viikot.every((v) => v.value === null && !v.partial)).toBe(true);
  });
  it("viikon pylväs on lopullisten päivien keskiarvo: osittainen ja kesken oleva tämä päivä jäävät pois", () => {
    const d = emptyDataset();
    const osittainen = meal("2026-11-17");
    osittainen.lines.push({ ...line(), values: emptyNutrients() });
    const iso = meal("2026-11-15");
    iso.lines.push(line()); // 600 kcal
    d.meals = [iso, meal("2026-11-16"), osittainen, meal(end)];
    const [energia] = macroCharts(d, end, 14);
    const viikot = viikkoPylvaat(d, end, energia.points);
    expect(viikot.map((v) => v.value)).toEqual([null, 450]);
  });
});
