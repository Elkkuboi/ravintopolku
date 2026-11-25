// Asetukset-sivu: synkronoinnin tilarivi, poistovahvistuksen nappi, tavoitelomakkeen kentät ja karsittujen osien
// poissaolo. Vitest ajetaan ilman selainta, joten osat piirretään palvelinrenderöinnillä (renderToStaticMarkup).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyDataset, stamped, type Dataset } from "../src/domain/model";
import { localDay } from "../src/domain/dates";
import { synkRivi } from "../src/components/synkronointi";
import { SyncPanel } from "../src/components/SyncPanel";
import { Tavoitteet } from "../src/components/Tavoitteet";

const notify = () => {};

describe("synkRivi", () => {
  const nyt = new Date("2026-11-19T10:00:00Z"); // klo 12.00 Helsingissä
  it("viimeisin synkronointi suomalaisella kellonajalla", () => {
    const ok = { tila: "ok", lahetetty: 0, vastaanotettu: 2, seq: 9 } as const;
    expect(synkRivi(ok, "2026-11-19T05:42:00Z", nyt)).toBe(
      "synkronoitu klo 07.42",
    );
    expect(synkRivi(null, "2026-11-18T16:05:00Z", nyt)).toBe(
      "synkronoitu 18.11. klo 18.05",
    );
    expect(synkRivi(null, null, nyt)).toBe("ei synkronoitu");
    expect(synkRivi(null, "ei aika", nyt)).toBe("ei synkronoitu");
  });
  it("kertoo syyn, kun synkronointi ei onnistunut", () => {
    const viimeksi = "2026-11-19T05:42:00Z";
    expect(synkRivi({ tila: "ei-palvelinta" }, viimeksi, nyt)).toBe(
      "palvelimeen ei yhteyttä",
    );
    expect(
      synkRivi({ tila: "vahvista-poistot", poistoja: 30 }, viimeksi, nyt),
    ).toBe("synkronointi odottaa");
    expect(synkRivi({ tila: "virhe", viesti: "HTTP 500" }, viimeksi, nyt)).toBe(
      "synkronointi epäonnistui",
    );
  });
});

describe("poistojen vahvistus säilyy", () => {
  const piirra = (tulos: Parameters<typeof SyncPanel>[0]["tulos"]) =>
    renderToStaticMarkup(createElement(SyncPanel, { tulos, notify }));
  it("pysähtynyt synkronointi näyttää napin Lähetä N poistoa", () => {
    const html = piirra({ tila: "vahvista-poistot", poistoja: 30 });
    expect(html).toContain("30 poistoa odottaa");
    expect(html).toMatch(/<button[^>]*>Lähetä 30 poistoa<\/button>/);
  });
  it("muuten nappia ei ole", () => {
    expect(piirra(null)).toBe("");
    expect(piirra({ tila: "ok", lahetetty: 1, vastaanotettu: 0, seq: 1 })).toBe(
      "",
    );
    expect(piirra({ tila: "ei-palvelinta" })).toBe("");
  });
});

describe("Tavoitteet-osio", () => {
  const piirra = (data: Dataset) =>
    renderToStaticMarkup(createElement(Tavoitteet, { data, notify }));
  /** Tavoitealueen prosenttikentät järjestyksessä: [aria-label, arvo]. */
  const prosenttikentat = (html: string) =>
    [
      ...html.matchAll(/aria-label="([^"]+prosenttia)"[^>]*? value="([^"]*)"/g),
    ].map((m) => [m[1], m[2]]);
  it("kuusi kenttää voimassa olevilla luvuilla, Tallenna ja kaksi taitetta", () => {
    const data = emptyDataset();
    data.goals.push({
      ...stamped(),
      effectiveDate: localDay(),
      kind: "lose",
      targetWeight: 76.5,
      targetDate: "2027-03-01",
      nutrients: { energy: 2200, protein: 100, carbs: 250, fat: 70, fiber: 30 },
    });
    const html = piirra(data);
    const kentat = [...html.matchAll(/<label for="[^"]+">([^<]+)<\/label>/g)];
    expect(kentat.map((m) => m[1]).slice(0, 6)).toEqual([
      "Energia kcal",
      "Proteiini g",
      "Hiilihydraatit g",
      "Rasva g",
      "Kuitu g",
      "Tavoitepaino kg",
    ]);
    for (const arvo of ["2200", "100", "250", "70", "30", "76,5"])
      expect(html).toContain(`value="${arvo}"`);
    expect(html).toMatch(/<button class="btn btn--primary"[^>]*>Tallenna</);
    expect(html).toContain(
      '<details class="fold"><summary>Ehdota tavoitteet omin sanoin</summary>',
    );
    expect(html).toContain('<details class="fold"><summary>Profiili</summary>');
  });
  it("ilman tavoitetta tavoitekentät ovat tyhjät ja tavoitealueessa on oletukset", () => {
    const html = piirra(emptyDataset());
    const [lomake, alue] = html.split("<summary>Tavoitealue</summary>");
    expect(lomake).not.toMatch(/value="\d/);
    expect(lomake).toContain("Tavoitepaino kg");
    expect(prosenttikentat(alue)).toEqual([
      ["Energia: alle tavoitteen, prosenttia", "10"],
      ["Energia: yli tavoitteen, prosenttia", "10"],
      ["Proteiini: alle tavoitteen, prosenttia", "10"],
      ["Proteiini: yli tavoitteen, prosenttia", ""],
      ["Hiilihydraatit: alle tavoitteen, prosenttia", "20"],
      ["Hiilihydraatit: yli tavoitteen, prosenttia", "20"],
      ["Rasva: alle tavoitteen, prosenttia", "20"],
      ["Rasva: yli tavoitteen, prosenttia", "20"],
      ["Kuitu: alle tavoitteen, prosenttia", "10"],
      ["Kuitu: yli tavoitteen, prosenttia", ""],
    ]);
  });
  it("tavoitealue taitteena lomakkeen sisällä: tavoitteen omat prosentit ja alue yksikköinä", () => {
    const data = emptyDataset();
    data.goals.push({
      ...stamped(),
      effectiveDate: localDay(),
      kind: "track",
      targetWeight: null,
      targetDate: null,
      nutrients: {
        energy: 2000,
        protein: 150,
        carbs: 200,
        fat: 60,
        fiber: null,
      },
      alueet: {
        energy: { alle: 10, yli: 5 },
        protein: { alle: 5, yli: null },
        carbs: { alle: 20, yli: 10 },
        fat: { alle: 25, yli: 0 },
        fiber: { alle: 10, yli: null },
      },
    });
    const html = piirra(data);
    // taite on saman lomakkeen sisällä kuin Tallenna, joten yksi tallennus vie luvut ja alueet
    expect(html).toMatch(
      /<form class="lomake">.*<details class="fold"><summary>Tavoitealue<\/summary>.*Tallenna<\/button><\/div><\/form>/s,
    );
    const alue = html.split("<summary>Tavoitealue</summary>")[1];
    expect(prosenttikentat(alue).map(([, arvo]) => arvo)).toEqual([
      "10",
      "5",
      "5",
      "",
      "20",
      "10",
      "25",
      "0",
      "10",
      "",
    ]);
    const teksti = alue.replace(/\u00a0/g, " ");
    expect(teksti).toContain(
      'Energia<small class="muted">1 800–2 100 kcal</small>',
    );
    expect(teksti).toContain(
      'Proteiini<small class="muted">vähintään 143 g</small>',
    );
    expect(teksti).toContain('Rasva<small class="muted">45–60 g</small>');
    // kuidulla ei ole tavoitetta: rivi on, alue yksikköinä puuttuu
    expect(teksti).toContain('Kuitu<small class="muted"> </small>');
  });
});

describe("karsitut osat pysyvät poissa", () => {
  const tiedostot = [
    "src/nakymat/Asetukset.tsx",
    "src/components/Tavoitteet.tsx",
    "src/components/Tiedot.tsx",
    "src/components/SyncPanel.tsx",
    "src/components/ProfileForm.tsx",
  ];
  const lahde = tiedostot.map((f) => readFileSync(f, "utf8")).join("\n");
  it("ei kuvan lähde- tai roolivalintaa, AI-yhteyttä, poista kaikkea, vakioaterioita eikä tallennuksen tilaa", () => {
    for (const kielletty of [
      "kuvantunnistus",
      "kuvantulkinta",
      "KUVA_ROOLIT",
      "AIConnection",
      "useAIStatus",
      "eraseAll",
      "Poista kaikki",
      "removeTemplate",
      "templates",
      "storage.persist",
      "Kokeilu",
    ])
      expect(lahde, kielletty).not.toContain(kielletty);
  });
  it("ei vanhan ulkoasun luokkia (src/tyylit/vanha.css)", () => {
    const vanhat = new Set(
      "card primary secondary quiet notice error two-cols file-button check button-row section-heading page-heading eyebrow icon-button danger-link library-row unit accent".split(
        " ",
      ),
    );
    const luokat = [...lahde.matchAll(/className="([^"]+)"/g)].flatMap((m) =>
      m[1].split(/\s+/),
    );
    expect(luokat.length).toBeGreaterThan(10);
    expect(luokat.filter((l) => vanhat.has(l))).toEqual([]);
    expect(readFileSync("src/nakymat/Asetukset.tsx", "utf8")).toContain(
      'import "../tyylit/asetukset.css";',
    );
  });
  it("Hubin värilinkki ja kamerakuvan tiedostokenttä vain varmuuskopiolle", () => {
    expect(lahde).toContain(
      'hubOsoite(location.hostname) + "/asetukset#ulkoasu"',
    );
    const kentat = [...lahde.matchAll(/type="file"\s+accept="([^"]+)"/g)];
    expect(kentat.map((m) => m[1])).toEqual(["application/json,.json"]);
    expect(lahde).not.toContain("capture");
  });
});
