import { describe, it, expect } from "vitest";
import {
  emptyNutrients,
  numberInput,
  stamped,
  id,
  daySchema,
  lineSchema,
} from "../src/domain/model";
import {
  lineNutrients,
  mealSnapshot,
  dayTotals,
  goalForDay,
} from "../src/domain/nutrition";
import {
  weightSeries,
  dailySeries,
  observedMean,
} from "../src/domain/analytics";
import { localDay, wallTimestamp, dayRange } from "../src/domain/dates";
import { emptyDataset } from "../src/domain/model";
import { parseDraft, MockProvider, DisabledProvider } from "../src/ai/provider";
import { line, meal } from "./fixtures";
describe("Ravintoainelaskenta", () => {
  it("150 g ja 200 kcal / 100 g on 300 kcal; pakkausenergia säilyy", () => {
    const l = line();
    expect(lineNutrients(l).energy).toBe(300);
    expect(lineNutrients({ ...l, mode: "portion" }).energy).toBe(200);
  });
  it("tuntematon kuitu ei muutu nollaksi ja tunnettu osasumma näkyy osittaisena", () => {
    const m = meal();
    expect(m.snapshot.fiber).toBeNull();
    expect(dayTotals([m]).fiber).toMatchObject({
      value: null,
      missing: 1,
      partial: true,
    });
    m.lines.push({ ...line(), values: { ...emptyNutrients(), fiber: 4 } });
    expect(dayTotals([m]).fiber).toMatchObject({
      value: 6,
      known: 1,
      missing: 1,
      partial: true,
    });
    expect(mealSnapshot(m.lines).fiber).toBeNull();
  });
  it("nolla on tunnettu arvo eikä tyhjä päivä ole nolla", () => {
    expect(
      lineNutrients({ ...line(), values: { ...emptyNutrients(), fiber: 0 } })
        .fiber,
    ).toBe(0);
    expect(dayTotals([]).energy.value).toBeNull();
  });
  it("desimaalipilkku toimii ja virheelliset syötteet estetään", () => {
    expect(numberInput(" 75,25 ")).toBe(75.25);
    expect(numberInput("", true)).toBeNull();
    for (const s of ["-1", "NaN", "Infinity", "1e2", "1,2,3", "", "1 000"])
      expect(() => numberInput(s)).toThrow();
  });
  it("tavoitteet valitaan kirjauspäivän mukaan", () => {
    const g = {
      ...stamped(),
      kind: "track" as const,
      targetDate: null,
      targetWeight: null,
      nutrients: emptyNutrients(),
    };
    expect(
      goalForDay(
        [
          { ...g, effectiveDate: "2026-01-01" },
          {
            ...g,
            id: id(),
            effectiveDate: "2026-02-01",
            nutrients: { ...emptyNutrients(), energy: 2000 },
          },
        ],
        "2026-01-31",
      )?.nutrients.energy,
    ).toBeNull();
  });
});
describe("Helsingin päivät ja tilastot", () => {
  it("UTC-vuorokauden raja ei muuta paikallista päivää", () => {
    expect(localDay(new Date("2026-01-01T22:30:00Z"))).toBe("2026-01-02");
    expect(localDay(new Date("2026-06-01T21:30:00Z"))).toBe("2026-06-02");
  });
  it("kesä- ja talviaika sekä siirtymät ovat oikeita", () => {
    expect(wallTimestamp("2026-03-29", "02:30")).toBe(
      "2026-03-29T00:30:00.000Z",
    );
    expect(wallTimestamp("2026-03-29", "04:30")).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(() => wallTimestamp("2026-03-29", "03:30")).toThrow();
    expect(wallTimestamp("2026-10-25", "03:30")).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    expect(wallTimestamp("2026-10-25", "04:30")).toBe(
      "2026-10-25T02:30:00.000Z",
    );
    expect(dayRange("2026-03-30", 3)).toEqual([
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ]);
    expect(daySchema.safeParse("2026-02-30").success).toBe(false);
  });
  it("liukuva keskiarvo käyttää seitsemää kalenteripäivää ja vaatii 3 mittausta", () => {
    const weights = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-08",
      "2026-01-10",
      "2026-01-14",
    ].map((date, i) => ({
      ...stamped(),
      date,
      kg: [100, 90, 80, 70, 60][i],
      note: "",
    }));
    const series = weightSeries(weights, "2026-01-14", 7);
    expect(series[0].average).toBeNull();
    expect(series.at(-1)).toMatchObject({ average: 70, measurements: 3 });
    expect(series[2].weight).toBe(70);
  });
  it("puuttuvat päivät eivät muutu nolliksi keskiarvossa", () => {
    const d = emptyDataset();
    d.meals = [meal("2026-01-02")];
    const daily = dailySeries(d, "2026-01-07", 7);
    expect(daily[0].energy).toBeNull();
    expect(observedMean(daily.map((r) => r.energy))).toEqual({
      value: 300,
      count: 1,
    });
  });
});
describe("AI-luonnokset", () => {
  it("virheellinen JSON ja negatiiviset arvot hylätään", async () => {
    expect(() => parseDraft("{bad")).toThrow();
    const d = await new MockProvider().interpret();
    d.lines[0].values.energy = -1;
    expect(() => parseDraft(JSON.stringify(d))).toThrow();
  });
  it("tuntematon annosmassa sallitaan luonnoksessa mutta ei lopullisessa per100-kirjauksessa", async () => {
    const draft = await new MockProvider().interpret();
    draft.lines[0].mode = "per100";
    draft.lines[0].grams = null;
    const parsed = parseDraft(JSON.stringify(draft));
    const l = { ...parsed.lines[0], id: id(), foodId: null };
    expect(lineNutrients(l).energy).toBeNull();
    expect(lineSchema.safeParse(l).success).toBe(false);
    expect(lineSchema.safeParse({ ...l, grams: 150 }).success).toBe(true);
  });
  it("disabled on aidosti poissa käytöstä ja mock merkitty simulaatioksi", async () => {
    await expect(new DisabledProvider().interpret()).rejects.toThrow(
      "ei ole käytössä",
    );
    expect((await new MockProvider().interpret()).provenance.note).toContain(
      "Simulaatio",
    );
  });
});
