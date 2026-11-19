// Kehitys-sivu piirrettynä: mallin rakenne (paino, energia, proteiini, jakson valinta, taitettu taulukko), oma SVG
// ilman rechartsia ja vanhoja luokkia, ja tyhjä tila yhtenä harmaana rivinä.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Kehitys from "../src/nakymat/Kehitys";
import {
  emptyDataset,
  emptyNutrients,
  stamped,
  type Dataset,
} from "../src/domain/model";
import { addDays, localDay } from "../src/domain/dates";
import { paivaTeksti } from "../src/components/makrokuvaajat";
import { line, meal } from "./fixtures";

const piirra = (data: Dataset) =>
  renderToStaticMarkup(
    createElement(Kehitys, {
      data,
      notify: () => {},
      run: async (f: () => Promise<void>) => f(),
    }),
  );
const laske = (html: string, s: string) => html.split(s).length - 1;

function data(): Dataset {
  const end = localDay();
  const d = emptyDataset();
  d.goals = [
    {
      ...stamped(),
      effectiveDate: addDays(end, -60),
      kind: "lose",
      targetWeight: 76.5,
      targetDate: addDays(end, 90),
      nutrients: { ...emptyNutrients(), energy: 2200, protein: 12 },
    },
  ];
  d.weights = [10, 5, 1].map((n, i) => ({
    ...stamped(),
    date: addDays(end, -n),
    kg: [78.4, 77.9, 77.6][i],
    note: "",
  }));
  // fixtures.meal: 300 kcal ja 15 g proteiinia
  d.meals = [meal(addDays(end, -3)), meal(addDays(end, -2)), meal(end)];
  const osittainen = meal(addDays(end, -1));
  osittainen.lines.push({ ...line(), values: emptyNutrients() });
  d.meals.push(osittainen);
  return d;
}

describe("Kehitys-sivu", () => {
  it("näyttää painon, energian ja proteiinin mallin mukaan omana SVG:nä", () => {
    const html = piirra(data());
    expect(html).toContain('<h2 class="label">Paino');
    expect(html).toContain('<span class="aside">−0,8 kg / 9 pv</span>');
    expect(html).toContain("Energia");
    expect(html).toContain("keskiarvo 300 kcal · tavoite 2\u00a0200 kcal");
    expect(html).toContain("keskiarvo 15 g · tavoite 12 g");
    expect(laske(html, '<svg class="chart"')).toBe(2);
    expect(laske(html, '<polyline class="line"')).toBe(1);
    expect(laske(html, '<circle class="pt"')).toBe(1);
    expect(laske(html, '<line class="target"')).toBe(2);
    expect(html).toContain(">tavoite 76,5</text>");
    // neljä kirjattua päivää: kolme kokonaista ja yksi osittainen (ontto) pylväs
    expect(laske(html, "<rect ")).toBe(4);
    expect(laske(html, '<rect class="osittainen"')).toBe(1);
  });
  it("proteiinitavoite lasketaan päättyneistä päivistä; tämän päivän kesken oleva jää pois", () => {
    const html = piirra(data());
    // kolme päättynyttä päivää ≥ 12 g (osittainenkin ylittää), tänään 15 g ≥ 12 g on jo täyttynyt
    expect(html).toContain("Tavoite täyttyi 4 päivänä 4:stä.");
  });
  it("jakso 7 / 30 / 90 pv / kaikki, oletuksena 30 pv, painikkeina", () => {
    const html = piirra(data());
    expect(html).toContain(
      '<div class="range" role="group" aria-label="Jakso">',
    );
    for (const t of ["7 pv", "30 pv", "90 pv", "Kaikki"])
      expect(html).toContain(`>${t}</button>`);
    expect(html).toContain('aria-pressed="true">30 pv</button>');
    expect(laske(html, 'aria-pressed="false"')).toBe(3);
    // risuaita on sivun osoite: jaksonvalinta ei saa olla linkki
    expect(html).not.toContain('href="#"');
  });
  it("päivittäiset luvut ovat taitettuna, uusin ensin, osittainen summa alarajana", () => {
    const html = piirra(data());
    expect(html).toMatch(
      /<details class="fold"><summary>Päivittäiset luvut<\/summary>/,
    );
    expect(html).not.toContain('<details class="fold" open');
    const end = localDay();
    const ensin = html.indexOf(`>${short(end)}</td>`),
      sitten = html.indexOf(`>${short(addDays(end, -10))}</td>`);
    expect(ensin).toBeGreaterThan(0);
    expect(sitten).toBeGreaterThan(ensin);
    expect(html).toContain("≥300");
  });
  it("ei rechartsia, vanhoja luokkia, kovakoodattuja värejä eikä inline-tyylejä", () => {
    const html = piirra(data());
    for (const vanha of [
      "recharts",
      'class="card',
      "section-heading",
      "legend",
      "segments",
      "chart-empty",
      "page-heading",
      "Jakso päättyy",
      "style=",
    ])
      expect(html).not.toContain(vanha);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
  it("tyhjä päiväkirja: yksi harmaa rivi osiota kohden, ei kuvaajia eikä taulukkoa", () => {
    const html = piirra(emptyDataset());
    expect(laske(html, '<p class="empty">')).toBe(3);
    expect(html).toContain("Ei punnituksia tällä jaksolla.");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<details");
    expect(html).not.toContain('class="aside"');
  });
  it("kaukainen tavoitepaino ei litistä viivaa: se kerrotaan otsikossa", () => {
    const d = data();
    d.goals[0].targetWeight = 65;
    const html = piirra(d);
    expect(html).toContain("−0,8 kg / 9 pv · tavoite 65 kg");
    expect(html).not.toContain(">tavoite 65</text>");
  });
});

const short = (day: string) => paivaTeksti(day, localDay());
