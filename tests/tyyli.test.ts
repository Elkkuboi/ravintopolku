// Tyylikuri: värit vain style.css:n neljässä väriyhdistelmässä, ei pyöristyksiä eikä liukuvärejä, ja CSP:n vuoksi ei
// inline-tyylimerkkijonoja. Koskee kaikkia nykyisiä ja tulevia tiedostoja hakemistoissa src/ ja src/tyylit/.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function tiedostot(hakemisto: string, paate: RegExp): string[] {
  return readdirSync(hakemisto, { recursive: true, encoding: "utf8" })
    .filter((n) => paate.test(n))
    .map((n) => join(hakemisto, n));
}
const ilmanKommentteja = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const VARI = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i;

// Poikkeus: kuvan pienennyksen valkoinen tausta, joka ei ole käyttöliittymän väri.
const SALLITUT_TSX = new Set(["src/data/photos.ts"]);

describe("tyylitiedostot", () => {
  const css = tiedostot("src", /\.css$/);
  it("style.css ja näkymien tyylit ovat mukana", () => {
    expect(css).toContain("src/style.css");
  });
  it("värit vain väriyhdistelmien lohkoissa", () => {
    for (const f of css) {
      let s = ilmanKommentteja(readFileSync(f, "utf8"));
      if (f === "src/style.css")
        s = s.replace(/(?::root, )?\[data-vari="[a-z]+"\]\s*\{[^}]*\}/g, "");
      expect(s.match(VARI)?.[0] ?? null, f).toBeNull();
    }
  });
  it("väriyhdistelmiä on neljä ja niissä samat muuttujat", () => {
    const s = readFileSync("src/style.css", "utf8");
    const lohkot = [...s.matchAll(/\[data-vari="([a-z]+)"\]\s*\{([^}]*)\}/g)];
    expect(lohkot.map((l) => l[1])).toEqual([
      "paperi",
      "liitu",
      "terminaali",
      "fosfori",
    ]);
    const muuttujat = (b: string) =>
      [...b.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]).sort();
    for (const l of lohkot)
      expect(muuttujat(l[2])).toEqual(muuttujat(lohkot[0][2]));
  });
  it("ei pyöristyksiä, liukuvärejä eikä pudotusvarjoja", () => {
    for (const f of css) {
      const s = ilmanKommentteja(readFileSync(f, "utf8"));
      expect(s, f).not.toMatch(
        /border-radius:(?!\s*0\s*[;}])|gradient\(|drop-shadow|text-shadow/,
      );
      // box-shadow vain inset-viivana (Hubin navigaatio) tai pois päältä
      for (const m of s.matchAll(/box-shadow:\s*([^;}]*)/g))
        expect(m[1], f).toMatch(/^(none|inset\b)/);
    }
  });
  it("kirjasimet omasta alkuperästä", () => {
    const s = readFileSync("src/style.css", "utf8");
    const lahteet = [...s.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(lahteet.length).toBe(4);
    for (const l of lahteet)
      expect(l).toMatch(/^\/fonts\/IBMPlexMono-[A-Za-z]+\.woff2$/);
    for (const l of lahteet)
      expect(() => readFileSync("public" + l)).not.toThrow();
  });
});

describe("komponentit", () => {
  const lahteet = tiedostot("src", /\.tsx?$/);
  it("ei kovakoodattuja värejä", () => {
    for (const f of lahteet) {
      if (SALLITUT_TSX.has(f)) continue;
      expect(readFileSync(f, "utf8").match(VARI)?.[0] ?? null, f).toBeNull();
    }
  });
  it("ei inline-tyylimerkkijonoja eikä tyylielementtejä (CSP: style-src 'self')", () => {
    for (const f of lahteet) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(
        /style="|<style|setAttribute\(\s*["']style|dangerouslySetInnerHTML/,
      );
    }
  });
  it("ei kuvakekirjastoa", () => {
    for (const f of lahteet)
      expect(readFileSync(f, "utf8"), f).not.toContain("lucide-react");
    expect(readFileSync("package.json", "utf8")).not.toContain("lucide-react");
  });
});

describe("CSP", () => {
  // Esikatselu (E2E-savu) ja työaseman palvelin antavat saman otsakkeen, joten savu näkee samat rajat kuin puhelin.
  const merkkijono = (s: string) =>
    [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
  it("vite preview käyttää palvelimen CSP:tä sellaisenaan", () => {
    const py = readFileSync(
      "palvelin/src/ravintopolku_palvelin/app.py",
      "utf8",
    ).match(/^CSP = \(([\s\S]*?)\)$/m)?.[1];
    const ts = readFileSync("vite.config.ts", "utf8").match(
      /const TUOTANNON_CSP =([\s\S]*?);\n/,
    )?.[1];
    expect(py && ts).toBeTruthy();
    expect(merkkijono(ts!)).toBe(merkkijono(py!));
    expect(merkkijono(py!)).toContain("style-src 'self';");
    expect(merkkijono(py!)).not.toContain("unsafe");
  });
});
