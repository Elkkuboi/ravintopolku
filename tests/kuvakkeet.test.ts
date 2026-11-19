// Kuvakkeet: käännöksen manifestin jokainen kuvake on public/-hakemistossa ja kooltaan sama kuin manifestissa.
// Manifesti tehdään samalla vite-plugin-pwa:n koodilla kuin `vite build`. Uusi kuva saa uuden nimen (-v2, -v3),
// koska puhelimeen asennettu sovellus ei hae samasta osoitteesta uutta kuvaa.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveConfig, type Plugin } from "vite";
import type { VitePluginPWAAPI } from "vite-plugin-pwa";

type Kuvake = { src: string; sizes: string; type: string; purpose: string };

// Leveys ja korkeus PNG:n IHDR-lohkosta; null, jos tiedosto ei ole PNG.
function pngKoko(b: Buffer): [number, number] | null {
  const allekirjoitus = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (b.length < 24 || !b.subarray(0, 8).equals(allekirjoitus)) return null;
  if (b.toString("latin1", 12, 16) !== "IHDR") return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

async function kaannoksenManifesti() {
  const c = await resolveConfig(
    { configFile: "vite.config.ts", logLevel: "silent" },
    "build",
    "production",
  );
  const pwa = c.plugins.find((p) => p.name === "vite-plugin-pwa") as
    (Plugin & { api: VitePluginPWAAPI }) | undefined;
  const tiedosto = pwa?.api.generateBundle({})?.["manifest.webmanifest"];
  if (!tiedosto || tiedosto.type !== "asset")
    throw new Error("manifest.webmanifest puuttuu");
  return {
    base: c.base,
    icons: JSON.parse(String(tiedosto.source)).icons as Kuvake[],
  };
}

describe("kuvakkeet", () => {
  it("manifestin kuvakkeet ovat public/:ssa oikean kokoisina", async () => {
    const { base, icons } = await kaannoksenManifesti();
    expect(icons.map((k) => k.purpose).sort()).toEqual([
      "any",
      "any",
      "maskable",
    ]);
    for (const k of icons) {
      expect(k.src.startsWith(base), k.src).toBe(true);
      expect(k.type).toBe("image/png");
      const koko = pngKoko(readFileSync("public/" + k.src.slice(base.length)));
      expect(koko?.join("x"), k.src).toBe(k.sizes);
    }
  });
  it("muu kuin PNG ei käy kuvakkeeksi", () => {
    expect(pngKoko(readFileSync("public/vari.js"))).toBeNull();
    expect(
      pngKoko(readFileSync("public/fonts/IBMPlexMono-Regular.woff2")),
    ).toBeNull();
  });
});
