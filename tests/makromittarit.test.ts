import { describe, it, expect } from "vitest";
import { emptyNutrients } from "../src/domain/model";
import { dayTotals, type Total } from "../src/domain/nutrition";
import {
  meterReading,
  meterKeys,
  meterUnit,
} from "../src/components/makromittarit";
import { line, meal } from "./fixtures";
const total = (value: number | null, known = 1, missing = 0): Total => ({
  value,
  known,
  missing,
  partial: missing > 0,
});
describe("Makromittarit", () => {
  it("näyttää energian, proteiinin, hiilihydraatit ja rasvan oikeilla yksiköillä", () => {
    expect(meterKeys).toEqual(["energy", "protein", "carbs", "fat"]);
    expect(meterUnit("energy")).toBe("kcal");
    expect(meterUnit("protein")).toBe("g");
  });
  it("laskee syödyn, jäljellä olevan ja täyttöprosentin", () => {
    const r = meterReading(total(1250), 2000);
    expect(r).toMatchObject({
      consumed: 1250,
      goal: 2000,
      remaining: 750,
      over: 0,
      percent: 62.5,
      partial: false,
      empty: false,
    });
  });
  it("ylitys näkyy erikseen ja jäljellä pysyy nollassa", () => {
    const r = meterReading(total(2300), 2000);
    expect(r.remaining).toBe(0);
    expect(r.over).toBe(300);
    expect(r.percent).toBe(100);
  });
  it("tasan tavoitteessa jäljellä on 0 eikä ylitystä", () => {
    const r = meterReading(total(120), 120);
    expect(r).toMatchObject({ remaining: 0, over: 0, percent: 100 });
  });
  it("ilman tavoitetta näytetään vain syöty", () => {
    expect(meterReading(total(80), null)).toMatchObject({
      consumed: 80,
      goal: null,
      remaining: null,
      over: null,
      percent: 0,
    });
    expect(meterReading(total(80), undefined).goal).toBeNull();
  });
  it("osittainen summa merkitään eikä sitä esitetä tarkkana", () => {
    const r = meterReading(total(40, 2, 1), 100);
    expect(r.partial).toBe(true);
    expect(r.missing).toBe(1);
    expect(r.consumed).toBe(40);
    expect(r.remaining).toBe(60);
    expect(r.percent).toBe(40);
  });
  it("tuntematon summa ei ole nolla: ei jäljellä-arvoa eikä täyttöä", () => {
    const unknown = meterReading(total(null, 0, 2), 100);
    expect(unknown).toMatchObject({
      consumed: null,
      remaining: null,
      over: null,
      percent: 0,
      partial: true,
      empty: false,
    });
    const empty = meterReading(total(null, 0, 0), 100);
    expect(empty).toMatchObject({
      consumed: null,
      remaining: null,
      empty: true,
    });
  });
  it("nollatavoite ei jaa nollalla", () => {
    expect(meterReading(total(0), 0)).toMatchObject({
      percent: 0,
      remaining: 0,
      over: 0,
    });
    expect(meterReading(total(5), 0)).toMatchObject({ percent: 100, over: 5 });
  });
  it("toimii päivän summilla: puuttuva hiilihydraatti merkitsee mittarin osittaiseksi", () => {
    const m = meal();
    m.lines.push({
      ...line(),
      values: { ...emptyNutrients(), energy: 100, protein: 5, carbs: 20 },
    });
    const totals = dayTotals([m]);
    const energy = meterReading(totals.energy, 2000);
    expect(energy).toMatchObject({
      consumed: 450,
      remaining: 1550,
      partial: false,
    });
    const carbs = meterReading(totals.carbs, 250);
    expect(carbs).toMatchObject({ consumed: 30, missing: 1, partial: true });
    expect(meterReading(totals.fat, 70)).toMatchObject({
      consumed: null,
      remaining: null,
      partial: true,
    });
  });
});
