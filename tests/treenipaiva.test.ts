// Treenipäivä: valinta Tänään-sivulla, tallennus päivän kirjaukseen lomaketta kumoamatta ja näkyminen Kehitys-sivulla
// (viiva energian kuvaajan akselin alla, lause kuvaajan alla ja sarake päivittäisissä luvuissa).
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Kehitys from "../src/nakymat/Kehitys";
import Tanaan from "../src/nakymat/Tanaan";
import { lomakkeenAvain } from "../src/nakymat/paiva";
import { DiaryDB, saveLifestyle } from "../src/data/db";
import { parseBackup, exportBackup, restoreBackup } from "../src/data/backup";
import { paikallisetMuutokset } from "../src/data/sync";
import {
  shortDate,
  jaksonPituus,
  treeniLause,
  treeniYhteenveto,
  macroCharts,
  macroSummary,
  treenipaivat,
} from "../src/components/makrokuvaajat";
import {
  emptyDataset,
  id,
  lifestyleSchema,
  stamped,
  type Dataset,
  type Lifestyle,
} from "../src/domain/model";
import { addDays, localDay } from "../src/domain/dates";
import { meal } from "./fixtures";

const databases: DiaryDB[] = [];
const database = () => {
  const d = new DiaryDB("treeni-" + id());
  databases.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});
const props = (data: Dataset) => ({
  data,
  notify: () => {},
  run: async (f: () => Promise<void>) => f(),
});
const laske = (html: string, s: string) => html.split(s).length - 1;
const elama = (date: string, muut: Partial<Lifestyle> = {}): Lifestyle => ({
  ...stamped(),
  date,
  steps: null,
  sleep: null,
  training: "",
  hunger: null,
  energy: null,
  ...muut,
});

describe("treenipäivän tallennus", () => {
  it("vanha kirjaus ilman kenttää kelpaa; vain totuusarvo kelpaa", () => {
    const vanha = elama("2026-11-20");
    expect(lifestyleSchema.safeParse(vanha).success).toBe(true);
    expect(
      lifestyleSchema.safeParse({ ...vanha, trainingDay: true }).success,
    ).toBe(true);
    expect(
      lifestyleSchema.safeParse({ ...vanha, trainingDay: "kyllä" }).success,
    ).toBe(false);
    expect(
      lifestyleSchema.safeParse({ ...vanha, trainingDay: 1 }).success,
    ).toBe(false);
  });

  it("napautus luo päivän kirjauksen ja toinen napautus poistaa merkinnän", async () => {
    const db = database();
    await saveLifestyle("2026-11-20", { trainingDay: true }, db);
    let rivit = await db.lifestyles.toArray();
    expect(rivit).toHaveLength(1);
    expect(rivit[0]).toMatchObject({
      date: "2026-11-20",
      trainingDay: true,
      steps: null,
      sleep: null,
      training: "",
      hunger: null,
      energy: null,
    });
    await saveLifestyle("2026-11-20", { trainingDay: false }, db);
    rivit = await db.lifestyles.toArray();
    expect(rivit).toHaveLength(1);
    expect(rivit[0].trainingDay).toBe(false);
  });

  it("lomake ei kumoa treenipäivää eikä treenipäivä lomaketta; tunniste ja luontiaika säilyvät", async () => {
    const db = database();
    await saveLifestyle("2026-11-20", { trainingDay: true }, db);
    const [eka] = await db.lifestyles.toArray();
    await saveLifestyle(
      "2026-11-20",
      { steps: 9000, sleep: 7.5, training: "sali", hunger: 3, energy: 4 },
      db,
    );
    await saveLifestyle("2026-11-20", { trainingDay: true }, db);
    const rivit = await db.lifestyles.toArray();
    expect(rivit).toHaveLength(1);
    expect(rivit[0]).toMatchObject({
      id: eka.id,
      createdAt: eka.createdAt,
      trainingDay: true,
      steps: 9000,
      sleep: 7.5,
      training: "sali",
      hunger: 3,
      energy: 4,
    });
  });

  it("synkronoinnista tullut kirjaus päivitetään eikä samalle päivälle tule toista", async () => {
    const db = database();
    const etalta = elama("2026-11-21", { steps: 5000 });
    await db.lifestyles.put(etalta);
    await saveLifestyle("2026-11-21", { trainingDay: true }, db);
    const rivit = await db.lifestyles.toArray();
    expect(rivit).toHaveLength(1);
    expect(rivit[0]).toMatchObject({
      id: etalta.id,
      steps: 5000,
      trainingDay: true,
    });
  });

  it("virheellinen päivä tai arvo hylätään eikä mitään tallennu", async () => {
    const db = database();
    await expect(
      saveLifestyle("2026-02-30", { trainingDay: true }, db),
    ).rejects.toThrow();
    await expect(
      saveLifestyle("2026-11-20", { steps: -1, trainingDay: true }, db),
    ).rejects.toThrow();
    expect(await db.lifestyles.count()).toBe(0);
  });

  it("treenipäivä kulkee varmuuskopion ja synkronoinnin muutoslistan mukana", async () => {
    const db = database();
    await saveLifestyle("2026-11-20", { trainingDay: true }, db);
    const muutokset = await paikallisetMuutokset(db);
    expect(muutokset).toHaveLength(1);
    expect(muutokset[0]).toMatchObject({
      taulu: "lifestyles",
      poistettu: false,
      data: { date: "2026-11-20", trainingDay: true },
    });
    const kopio = await exportBackup(db);
    const kohde = database();
    await restoreBackup(parseBackup(JSON.stringify(kopio)), kohde);
    const [palautettu] = await kohde.lifestyles.toArray();
    expect(palautettu.trainingDay).toBe(true);
  });
});

describe("Tänään-sivun treenipäivä", () => {
  const piirra = (data: Dataset) =>
    renderToStaticMarkup(createElement(Tanaan, props(data)));

  it("valinta näkyy taitteen ulkopuolella, tyhjänä kun päivää ei ole merkitty", () => {
    const html = piirra(emptyDataset());
    const kohta = html.indexOf("Treenipäivä</label>");
    expect(kohta).toBeGreaterThan(0);
    expect(kohta).toBeLessThan(html.indexOf('<details class="fold">'));
    expect(html).toMatch(
      /<label class="inline treeni"><input type="checkbox"\/>Treenipäivä<\/label>/,
    );
  });

  it("merkitty päivä näkyy valittuna; toisen päivän merkintä ei", () => {
    const d = emptyDataset();
    d.lifestyles = [elama(localDay(), { trainingDay: true })];
    expect(piirra(d)).toMatch(
      /<label class="inline treeni"><input type="checkbox" checked=""\/>Treenipäivä<\/label>/,
    );
    d.lifestyles = [elama(addDays(localDay(), -1), { trainingDay: true })];
    expect(piirra(d)).not.toContain('checked=""/>Treenipäivä');
  });

  it("lomakkeen avain ei muutu treenipäivästä eikä tyhjän kirjauksen luonnista", () => {
    const tyhja = elama("2026-11-20");
    expect(lomakkeenAvain("2026-11-20", undefined)).toBe(
      lomakkeenAvain("2026-11-20", tyhja),
    );
    expect(lomakkeenAvain("2026-11-20", tyhja)).toBe(
      lomakkeenAvain("2026-11-20", { ...tyhja, trainingDay: true }),
    );
    expect(lomakkeenAvain("2026-11-20", tyhja)).not.toBe(
      lomakkeenAvain("2026-11-20", { ...tyhja, steps: 100 }),
    );
    expect(lomakkeenAvain("2026-11-20", tyhja)).not.toBe(
      lomakkeenAvain("2026-11-21", tyhja),
    );
    // tekstikenttä ei sekoitu numerokenttään
    expect(lomakkeenAvain("2026-11-20", { ...tyhja, training: "1" })).not.toBe(
      lomakkeenAvain("2026-11-20", { ...tyhja, steps: 1 }),
    );
  });
});

describe("Kehitys-sivun treenipäivät", () => {
  const piirra = (data: Dataset) =>
    renderToStaticMarkup(createElement(Kehitys, props(data)));
  // fixtures.meal on 300 kcal; treenipäivälle kaksi ateriaa eli 600 kcal.
  function data(): Dataset {
    const end = localDay();
    const d = emptyDataset();
    d.meals = [
      meal(addDays(end, -3)),
      meal(addDays(end, -3)),
      meal(addDays(end, -2)),
      meal(addDays(end, -1)),
    ];
    d.lifestyles = [
      elama(addDays(end, -3), { trainingDay: true }),
      elama(addDays(end, -2), { trainingDay: false, steps: 4000 }),
      // treenipäivä ilman aterioita: näkyy viivana ja taulukossa, ei keskiarvossa
      elama(addDays(end, -5), { trainingDay: true }),
    ];
    return d;
  }

  it("treenipäivät viivana akselin alla, myös päivä ilman kirjauksia", () => {
    const html = piirra(data());
    expect(laske(html, '<g class="merkki">')).toBe(1);
    const merkit = html.slice(html.indexOf('<g class="merkki">'));
    expect(laske(merkit.slice(0, merkit.indexOf("</g>")), "<rect ")).toBe(2);
    // viivat ja pylväiden vihjeet osuvat oikeille päiville: treeni end-5 (ei aterioita) ja end-3 (600 kcal)
    const pv = (n: number) => shortDate(addDays(localDay(), n));
    expect(html).toContain(`<title>${pv(-3)} 600 kcal, treenipäivä</title>`);
    expect(html).toContain(`<title>${pv(-3)} treenipäivä</title>`);
    expect(html).toContain(`<title>${pv(-5)} treenipäivä</title>`);
    expect(html).toContain(`<title>${pv(-2)} 300 kcal</title>`);
    expect(html).not.toContain(`${pv(-2)} treenipäivä`);
    expect(laske(html, "treenipäivä</title>")).toBe(3);
  });

  it("lause kertoo määrän ja energian keskiarvot treeni- ja muina päivinä", () => {
    const html = piirra(data());
    expect(html).toContain(
      '<p class="muted"><span class="treeni-merkki" aria-hidden="true"></span>Treenattu 2 päivänä 30:stä. Energian keskiarvo treenipäivinä 600 kcal (1\u00a0pv), muina päivinä 300 kcal (2\u00a0pv).</p>',
    );
  });

  it("päivittäisissä luvuissa sarake T; päivä pelkällä treenillä on mukana", () => {
    const html = piirra(data());
    expect(html).toContain('<abbr title="treenipäivä">T</abbr>');
    expect(laske(html, "<td>✓</td>")).toBe(2);
    // neljä päivää: kolme aterioilla ja yksi pelkällä treenillä
    const taulukko = html.slice(html.indexOf("<tbody>"));
    expect(laske(taulukko, "<tr>")).toBe(4);
  });

  it("ilman treenipäiviä ei viivaa, lausetta eikä merkkejä", () => {
    const d = data();
    d.lifestyles = d.lifestyles.map((l) => ({ ...l, trainingDay: false }));
    const html = piirra(d);
    expect(html).not.toContain('class="merkki"');
    expect(html).not.toContain("Treenattu");
    expect(html).not.toContain("<td>✓</td>");
    // vanha kirjaus ilman kenttää on sama kuin ei treeniä
    d.lifestyles = [elama(addDays(localDay(), -3))];
    expect(piirra(d)).not.toContain("Treenattu");
  });

  it("pelkkiä treenipäiviä ilman aterioita: lause ilman keskiarvoja ja merkkiä", () => {
    const d = emptyDataset();
    d.lifestyles = [elama(addDays(localDay(), -1), { trainingDay: true })];
    const html = piirra(d);
    expect(html).toContain('<p class="muted">Treenattu 1 päivänä 30:stä.</p>');
    expect(html).not.toContain("treeni-merkki");
  });

  it("tämän päivän keskeneräinen treenipäivä lasketaan määrään mutta ei keskiarvoon", () => {
    const end = localDay();
    const d = emptyDataset();
    d.meals = [meal(end), meal(addDays(end, -1))];
    d.lifestyles = [elama(end, { trainingDay: true })];
    const [energia] = macroCharts(d, end, 7);
    const y = treeniYhteenveto(d, end, energia.points);
    expect(y).toMatchObject({ paivia: 7, treeni: 1 });
    expect(y.treenipaivina.value).toBeNull();
    expect(y.muina).toEqual({ value: 300, count: 1 });
    expect(treeniLause(y)).toBe(
      "Treenattu 1 päivänä 7:stä. Energian keskiarvo muina päivinä 300 kcal (1\u00a0pv).",
    );
    // valmiiksi merkitty päivä lasketaan
    d.days = [{ ...stamped(), date: end, complete: true }];
    expect(treeniYhteenveto(d, end, energia.points).treenipaivina).toEqual({
      value: 300,
      count: 1,
    });
  });

  it("Kaikki-jakso ulottuu ensimmäiseen treenipäivään; merkitsemätön kirjaus ei pidennä", () => {
    const end = localDay();
    const d = emptyDataset();
    d.lifestyles = [elama(addDays(end, -20), { trainingDay: true })];
    expect(jaksonPituus(d, end, "kaikki")).toBe(21);
    d.lifestyles = [elama(addDays(end, -20), { steps: 100 })];
    expect(jaksonPituus(d, end, "kaikki")).toBe(7);
  });

  it("ruudunlukijan kuvaus kertoo treenipäivät", () => {
    const d = data();
    const [energia] = macroCharts(d, localDay(), 7);
    const kuvaus = macroSummary(energia, treenipaivat(d));
    expect(laske(kuvaus, "treenipäivä")).toBe(2);
    expect(macroSummary(energia)).not.toContain("treenipäivä");
  });
});
