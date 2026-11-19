// Värit Ilmari Hubista: palvelimen arvo sallittujen listalta, viimeisin arvo ennen piirtoa (public/vari.js).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { haeVari, normalisoiVari, tumma, VARIT } from "../src/vari";

describe("normalisoiVari", () => {
  it("hyväksyy vain neljä Hubin väriä", () => {
    for (const v of VARIT) expect(normalisoiVari(v)).toBe(v);
    expect(VARIT).toEqual(["paperi", "liitu", "terminaali", "fosfori"]);
  });
  it("muu arvo on paperi", () => {
    for (const v of [undefined, null, "", "TERMINAALI", "<x>", 3, {}])
      expect(normalisoiVari(v)).toBe("paperi");
  });
  it("terminaali ja fosfori ovat tummia", () => {
    expect(VARIT.filter(tumma)).toEqual(["terminaali", "fosfori"]);
  });
});

describe("haeVari", () => {
  const vastaus = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));
  it("lukee värin reitiltä /api/ulkoasu omalla alkuperällä", async () => {
    const hae = vastaus(200, { vari: "fosfori" });
    expect(await haeVari(hae)).toBe("fosfori");
    expect(hae).toHaveBeenCalledWith("/api/ulkoasu", {
      credentials: "same-origin",
      cache: "no-store",
    });
  });
  it("tuntematon arvo palvelimelta on paperi", async () => {
    expect(await haeVari(vastaus(200, { vari: "violetti" }))).toBe("paperi");
    expect(await haeVari(vastaus(200, null))).toBe("paperi");
  });
  it("virhe tai offline: ei arvoa, edellinen väri jää", async () => {
    expect(await haeVari(vastaus(404, { virhe: "ei rajapintaa" }))).toBeNull();
    expect(await haeVari(vastaus(403, { virhe: "x" }))).toBeNull();
    expect(
      await haeVari(
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      ),
    ).toBeNull();
    expect(
      await haeVari(
        vi.fn(async () => new Response("ei json", { status: 200 })),
      ),
    ).toBeNull();
  });
});

describe("public/vari.js", () => {
  const skripti = readFileSync("public/vari.js", "utf8");
  function aja(tallennettu: Record<string, string>, heitto = false) {
    const attribuutit: Record<string, string> = {};
    const metat: Record<string, Record<string, string>> = {
      'meta[name="theme-color"]': { content: "#f1ead9" },
      'meta[name="color-scheme"]': { content: "light" },
    };
    const elementti = (kohde: Record<string, string>) => ({
      setAttribute: (k: string, v: string) => {
        kohde[k] = v;
      },
    });
    runInNewContext(skripti, {
      window: {
        localStorage: {
          getItem: (k: string) => {
            if (heitto) throw new Error("SecurityError");
            return tallennettu[k] ?? null;
          },
        },
      },
      document: {
        documentElement: elementti(attribuutit),
        querySelector: (s: string) => (metat[s] ? elementti(metat[s]) : null),
      },
    });
    return {
      vari: attribuutit["data-vari"],
      teema: metat['meta[name="theme-color"]'].content,
      skeema: metat['meta[name="color-scheme"]'].content,
    };
  }
  it("asettaa viimeksi tunnetun värin ja tilarivin ennen piirtoa", () => {
    expect(
      aja({
        "ravintopolku-vari": "terminaali",
        "ravintopolku-tausta": "#17140f",
      }),
    ).toEqual({ vari: "terminaali", teema: "#17140f", skeema: "dark" });
    expect(aja({ "ravintopolku-vari": "liitu" })).toEqual({
      vari: "liitu",
      teema: "#f1ead9",
      skeema: "light",
    });
  });
  it("ohittaa tuntemattoman arvon ja kelvottoman tilarivin värin", () => {
    expect(aja({ "ravintopolku-vari": "<script>" })).toEqual({
      vari: undefined,
      teema: "#f1ead9",
      skeema: "light",
    });
    expect(
      aja({ "ravintopolku-vari": "fosfori", "ravintopolku-tausta": "red;x" }),
    ).toEqual({ vari: "fosfori", teema: "#f1ead9", skeema: "dark" });
  });
  it("estetty tallennus ei kaada sivua", () => {
    expect(aja({}, true).vari).toBeUndefined();
  });
});

describe("index.html", () => {
  const html = readFileSync("index.html", "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  it("lataa värin erillisenä skriptinä headissa: ei inline-skriptejä eikä -tyylejä (CSP)", () => {
    expect(head).toContain('<script src="%BASE_URL%vari.js"></script>');
    expect(head.indexOf('name="theme-color"')).toBeLessThan(
      head.indexOf("vari.js"),
    );
    expect(html).not.toMatch(/<script>|<style|style="/);
  });
  it("otsikko ja tilarivin väri paperista", () => {
    expect(html).toContain("<title>Ravintopolku</title>");
    expect(html).toContain('<meta name="theme-color" content="#f1ead9" />');
  });
});
