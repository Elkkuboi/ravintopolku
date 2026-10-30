import { describe, it, expect } from "vitest";
import {
  emptyDataset,
  emptyNutrients,
  stamped,
  type Goal,
} from "../src/domain/model";
import {
  chartDays,
  macroCharts,
  macroSummary,
  shortDate,
} from "../src/components/makrokuvaajat";
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
describe("Kotinäkymän makrokuvaajat", () => {
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
