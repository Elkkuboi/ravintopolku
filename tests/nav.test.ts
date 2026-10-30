// Päänavigaatio: "Tänään" on ainoa päiväkirjanäkymä, joten erillistä
// "Päiväkirja"-välilehteä ei enää ole.
import { describe, it, expect } from "vitest";
import { tabs } from "../src/components/nav";

const ids: string[] = tabs.map((t) => t.id);
const labels: string[] = tabs.map((t) => t.label);

describe("tabs", () => {
  it("on kolme välilehteä järjestyksessä Tänään, Kehitys, Asetukset", () => {
    expect(labels).toEqual(["Tänään", "Kehitys", "Asetukset"]);
    expect(ids).toEqual(["today", "progress", "settings"]);
  });
  it("erillistä päiväkirjavälilehteä ei ole", () => {
    expect(labels).not.toContain("Päiväkirja");
    expect(ids).not.toContain("diary");
  });
  it("jokaisella välilehdellä on ainutlaatuinen tunniste ja ikoni", () => {
    expect(new Set(ids).size).toBe(tabs.length);
    for (const t of tabs) expect(typeof t.icon).toBe("object");
  });
});
