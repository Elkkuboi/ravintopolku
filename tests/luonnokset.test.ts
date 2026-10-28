// ILMARIn luonnoslaatikon asiakaspuoli (aiops ADR-0026): palvelimen vastaukset käsin kirjoitettuna.
import { describe, it, expect, vi } from "vitest";
import { haeLuonnokset, poistaLuonnos } from "../src/ai/luonnokset";

const vastaus = (runko: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => runko }) as Response;
const luonnos = {
  id: 3, externalId: "job-42-result-1", source: "ilmari", saapunut: "2026-10-28T12:00:00+00:00",
  draft: {
    schemaVersion: 1, name: "Kaurapuuro",
    lines: [{ name: "Kaurapuuro", mode: "per100", grams: 250,
      values: { energy: 60, protein: 2.1, carbs: 10, fat: 1.2, fiber: null }, source: "pakkaus", state: "" }],
    unknowns: [], assumptions: [], questions: [], provenance: { provider: "ilmari", model: null, note: "" },
  },
};

describe("haeLuonnokset", () => {
  it("hakee laatikon samasta alkuperästä ja validoi luonnokset", async () => {
    const hae = vi.fn(async () => vastaus({ luonnokset: [luonnos] }));
    expect(await haeLuonnokset(hae as unknown as typeof fetch)).toEqual({ tila: "ok", luonnokset: [luonnos] });
    expect(hae).toHaveBeenCalledWith("/api/luonnokset", { credentials: "same-origin" });
  });

  it("404 tarkoittaa, ettei työaseman palvelinta ole; muu virhe ja kelvoton vastaus raportoidaan", async () => {
    expect(await haeLuonnokset(async () => vastaus({ virhe: "ei rajapintaa" }, 404))).toEqual({ tila: "ei-palvelinta" });
    expect(await haeLuonnokset(async () => vastaus({ error: "Kirjaudu" }, 401))).toEqual({ tila: "ei-palvelinta" });
    expect(await haeLuonnokset(async () => vastaus({}, 403))).toEqual({ tila: "virhe", viesti: "palvelin vastasi 403" });
    expect((await haeLuonnokset(async () => vastaus({ luonnokset: [{ id: "x" }] }))).tila).toBe("virhe");
    expect((await haeLuonnokset(async () => { throw new TypeError("offline"); })).tila).toBe("virhe");
  });
});

describe("poistaLuonnos", () => {
  it("kuittaa DELETE-pyynnöllä ja heittää, jos luonnosta ei enää ole", async () => {
    const hae = vi.fn(async () => vastaus({ ok: true }));
    await poistaLuonnos(3, hae as unknown as typeof fetch);
    expect(hae).toHaveBeenCalledWith("/api/luonnokset/3", {
      method: "DELETE", credentials: "same-origin", headers: { "X-Ravintopolku": "1" },
    });
    await poistaLuonnos("2f1c0a8e-0000-4000-8000-000000000000", hae as unknown as typeof fetch);
    expect(hae).toHaveBeenLastCalledWith("/api/luonnokset/2f1c0a8e-0000-4000-8000-000000000000", expect.anything());
    await expect(poistaLuonnos(3, async () => vastaus({}, 404))).rejects.toThrow("ei enää ole");
    await expect(poistaLuonnos(3, async () => vastaus({}, 403))).rejects.toThrow("403");
  });
});
