// Kuori: alapalkin Hub-linkki ja tallennusrivi, synkronoinnin viimeisin tulos.
import { describe, it, expect } from "vitest";
import { hubOsoite, tallennusRivi } from "../src/kuori";
import { kirjaaTulos, viimeisinTulos } from "../src/data/sync";

describe("hubOsoite", () => {
  it("on saman isännän /hub ilman porttia", () => {
    expect(hubOsoite("tyoasema.taild1a5b7.ts.net")).toBe(
      "https://tyoasema.taild1a5b7.ts.net/hub",
    );
    expect(hubOsoite("tyoasema.taild1a5b7.ts.net")).not.toContain("8443");
  });
});

describe("tallennusRivi", () => {
  const nyt = new Date("2026-11-19T10:00:00Z"); // klo 12.00 Helsingissä
  it("onnistunut synkronointi samana päivänä: kellonaika suomalaisittain", () => {
    expect(
      tallennusRivi(
        { tila: "ok", lahetetty: 1, vastaanotettu: 0, seq: 3 },
        "2026-11-19T05:42:00Z",
        nyt,
      ),
    ).toBe("Tallennettu · synkronoitu klo 07.42");
  });
  it("aiempana päivänä mukana päivämäärä", () => {
    expect(tallennusRivi(null, "2026-11-18T16:05:00Z", nyt)).toBe(
      "Tallennettu · synkronoitu 18.11. klo 18.05",
    );
  });
  it("kertoo, miksi synkronointi ei onnistunut", () => {
    const viimeksi = "2026-11-19T05:42:00Z";
    expect(tallennusRivi({ tila: "ei-palvelinta" }, viimeksi, nyt)).toBe(
      "Tallennettu laitteelle · palvelimeen ei yhteyttä",
    );
    expect(
      tallennusRivi({ tila: "vahvista-poistot", poistoja: 30 }, viimeksi, nyt),
    ).toBe(
      "Tallennettu laitteelle · 30 poistoa odottaa vahvistusta Asetuksissa",
    );
    expect(
      tallennusRivi(
        { tila: "virhe", viesti: "palvelin vastasi 500" },
        viimeksi,
        nyt,
      ),
    ).toBe("Tallennettu laitteelle · synkronointi epäonnistui");
  });
  it("ei synkronoitu koskaan tai kelvoton aika: vain laitteella", () => {
    expect(tallennusRivi(null, null, nyt)).toBe("Tallennettu laitteelle");
    expect(tallennusRivi(null, "ei aika", nyt)).toBe("Tallennettu laitteelle");
  });
});

describe("synkronoinnin viimeisin tulos", () => {
  it("kirjataan alapalkkia varten", () => {
    const tulos = { tila: "ei-palvelinta" } as const;
    expect(kirjaaTulos(tulos)).toBe(tulos);
    expect(viimeisinTulos()).toBe(tulos);
  });
});
