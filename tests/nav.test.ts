// Yläpalkki: kolme tekstisivua ilman kuvakkeita, sivu osoitteen risuaidassa.
import { describe, it, expect } from "vitest";
import { tabs, tabFromHash } from "../src/components/nav";

const ids: string[] = tabs.map((t) => t.id);
const labels: string[] = tabs.map((t) => t.label);

describe("tabs", () => {
  it("on kolme sivua järjestyksessä Tänään, Kehitys, Asetukset", () => {
    expect(labels).toEqual(["Tänään", "Kehitys", "Asetukset"]);
    expect(ids).toEqual(["today", "progress", "settings"]);
  });
  it("erillistä päiväkirjasivua ei ole", () => {
    expect(labels).not.toContain("Päiväkirja");
    expect(ids).not.toContain("diary");
  });
  it("sivut ovat pelkkää tekstiä: ei kuvakkeita", () => {
    expect(new Set(ids).size).toBe(tabs.length);
    for (const t of tabs)
      expect(Object.keys(t).sort()).toEqual(["hash", "id", "label"]);
  });
});

describe("tabFromHash", () => {
  it("tunnistaa sivun risuaidasta", () => {
    expect(tabFromHash("#kehitys")).toBe("progress");
    expect(tabFromHash("#asetukset")).toBe("settings");
    expect(tabFromHash("asetukset")).toBe("settings");
  });
  it("tyhjä tai tuntematon on Tänään", () => {
    expect(tabFromHash("")).toBe("today");
    expect(tabFromHash("#")).toBe("today");
    expect(tabFromHash("#tuntematon")).toBe("today");
    expect(tabFromHash("#Kehitys")).toBe("today");
  });
});
