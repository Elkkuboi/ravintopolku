// Asetukset → Promptit: kielimallin ohjeet näkyvät sellaisinaan ja vain luettavina (GET /api/kehotteet).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { haeKehotteet } from "../src/ai/kehotteet";
import { PromptiLista } from "../src/components/Promptit";

const KUVA = {
  tunniste: "kuva",
  otsikko: "Kuvasta ateriaksi",
  kuvaus: "Kun otat kuvan annoksesta.",
  teksti: "Olet kuvantulkki.\nPalauta JSON.",
};
const vastaus = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("haeKehotteet", () => {
  it("lukee ohjeet reitiltä /api/kehotteet omalla alkuperällä", async () => {
    const hae = vastaus(200, { kehotteet: [KUVA] });
    expect(await haeKehotteet(hae)).toEqual([KUVA]);
    expect(hae).toHaveBeenCalledWith("/api/kehotteet", {
      credentials: "same-origin",
      cache: "no-store",
    });
  });
  it("kelvoton vastaus, virhe tai offline: ei mitään", async () => {
    for (const huono of [
      null,
      {},
      { kehotteet: "x" },
      { kehotteet: [{ ...KUVA, teksti: "" }] },
      { kehotteet: [{ ...KUVA, teksti: 5 }] },
      { kehotteet: [{ tunniste: "kuva" }] },
      { kehotteet: Array.from({ length: 21 }, () => KUVA) },
    ])
      expect(await haeKehotteet(vastaus(200, huono))).toBeNull();
    expect(await haeKehotteet(vastaus(404, { virhe: "x" }))).toBeNull();
    expect(await haeKehotteet(vastaus(403, { virhe: "x" }))).toBeNull();
    expect(
      await haeKehotteet(
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      ),
    ).toBeNull();
  });
});

describe("PromptiLista", () => {
  const piirra = (tila: Parameters<typeof PromptiLista>[0]["tila"]) =>
    renderToStaticMarkup(createElement(PromptiLista, { tila }));
  it("näyttää otsikon, kuvauksen ja tekstin sellaisenaan", () => {
    const html = piirra([KUVA]);
    expect(html).toContain("<strong>Kuvasta ateriaksi</strong>");
    expect(html).toContain('<small class="muted">Kun otat kuvan annoksesta.</small>');
    expect(html).toContain('<div class="sheet pre">Olet kuvantulkki.\nPalauta JSON.</div>');
  });
  it("teksti on dataa: merkintä koodataan", () => {
    const html = piirra([{ ...KUVA, teksti: "<script>alert(1)</script>" }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("tyhjä ennen avaamista, yksi rivi haun ja virheen aikana", () => {
    expect(piirra(null)).toBe("");
    expect(piirra("haetaan")).toBe('<p class="empty">Haetaan…</p>');
    expect(piirra("virhe")).toBe(
      '<p class="empty">Prompteja ei saatu palvelimelta.</p>',
    );
  });
});

describe("Asetukset-sivun osio", () => {
  const lahde = readFileSync("src/components/Promptit.tsx", "utf8");
  it("on Asetuksissa taitettuna ja vain luettavana", () => {
    const asetukset = readFileSync("src/nakymat/Asetukset.tsx", "utf8");
    expect(asetukset).toContain("<Promptit />");
    expect(lahde).toContain('<details className="fold"');
    for (const kielletty of ["<textarea", "<input", "<button", "method:"])
      expect(lahde, kielletty).not.toContain(kielletty);
  });
  it("linkki Ilmarin prompteihin vie Hubin sivulle", () => {
    expect(lahde).toContain('hubOsoite(location.hostname) + "/kehotteet"');
  });
});
