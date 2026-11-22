// Ateria vapaasta tekstikuvauksesta: asiakaspuoli käsin kirjoitetuilla palvelinvastauksilla,
// tekstirajat ja virheviestit. Mitään ei tallenneta ennen käyttäjän hyväksyntää lomakkeessa.
import { describe, it, expect, vi } from "vitest";
import {
  ateriaKuvausRooliSchema,
  ATERIA_KUVAUS_ROOLIT,
  OLETUSROOLI,
  TEKSTI_MIN,
  TEKSTI_MAX,
  YLEINEN_VIRHE,
  tulkitseKuvaus,
} from "../src/ai/ateria-kuvaus";
import { emptyNutrients } from "../src/domain/model";

const vastaus = (runko: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => runko,
  }) as Response;
const f = (hae: unknown) => hae as unknown as typeof fetch;
const KUVAUS = "banaani";

const rivi = {
  name: "banaani",
  mode: "portion",
  grams: 120,
  values: {
    ...emptyNutrients(),
    energy: 89,
    protein: 1.1,
    carbs: 22.8,
    fat: 0.3,
    fiber: 2.6,
  },
  source: "Kuvauksesta arvioitu annos",
  state: "",
};
const luonnos = {
  schemaVersion: 1,
  name: "Ateria kuvauksesta",
  lines: [rivi],
  unknowns: [],
  assumptions: ["Banaani noin 120 g."],
  questions: [],
  provenance: {
    provider: "aiops-välittäjä / ateria_kuvaus",
    model: "gpt-testi",
    note: "Kuvauksesta tulkittu arvio (rooli ateria_kuvaus). Tarkista määrät ja ravintoarvot.",
  },
};
const vastausRunko = { draft: luonnos, rooli: OLETUSROOLI };

describe("tulkitseKuvaus", () => {
  it("POST /api/ateria-kuvaus JSON-rungolla ja validoi vastauksen", async () => {
    const hae = vi.fn(async () => vastaus(vastausRunko));
    expect(await tulkitseKuvaus(`  ${KUVAUS}\n `, { hae: f(hae) })).toEqual(
      vastausRunko,
    );
    const [url, init] = hae.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ateria-kuvaus");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["X-Ravintopolku"]).toBe(
      "1",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      teksti: KUVAUS,
      rooli: OLETUSROOLI,
    });
  });

  it("rooli on aina Hubin valinta", async () => {
    const hae = vi.fn(async () => vastaus(vastausRunko));
    await tulkitseKuvaus(KUVAUS, { rooli: "ateria_kuvaus_pilvi", hae: f(hae) });
    const runko = JSON.parse(
      String((hae.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(runko.rooli).toBe("ateria_kuvaus_pilvi");
    expect(ATERIA_KUVAUS_ROOLIT).toEqual([
      "ateria_kuvaus",
      "ateria_kuvaus_pilvi",
      "ateria_kuvaus_paikallinen",
    ]);
  });

  it("liian lyhyt tai liian pitkä teksti ei lähetä mitään", async () => {
    const hae = vi.fn(async () => vastaus(vastausRunko));
    await expect(tulkitseKuvaus("   ", { hae: f(hae) })).rejects.toThrow(
      "Kirjoita ateria sanoin",
    );
    await expect(
      tulkitseKuvaus("x".repeat(TEKSTI_MIN - 1), { hae: f(hae) }),
    ).rejects.toThrow("Kirjoita ateria sanoin");
    await expect(
      tulkitseKuvaus("x".repeat(TEKSTI_MAX + 1), { hae: f(hae) }),
    ).rejects.toThrow("liian pitkä");
    expect(hae).not.toHaveBeenCalled();
  });

  it("fetch-virhe antaa selkokielisen yhteysohjeen", async () => {
    const hae = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(tulkitseKuvaus(KUVAUS, { hae: f(hae) })).rejects.toThrow(
      "Palvelimeen ei saada yhteyttä. Yritä myöhemmin uudelleen.",
    );
  });

  it("404 kertoo, ettei tulkintaa ole käytössä", async () => {
    const hae = vi.fn(async () => vastaus({ virhe: "ei löydy" }, 404));
    await expect(tulkitseKuvaus(KUVAUS, { hae: f(hae) })).rejects.toThrow(
      "Aterian tulkinta ei ole käytössä tällä palvelimella.",
    );
  });

  it("palvelimen selkokielinen virhe näytetään, muu korvataan yleisellä viestillä", async () => {
    const selkokielinen = async (status: number, viesti: string) =>
      expect(
        tulkitseKuvaus(KUVAUS, { hae: f(vi.fn(async () => vastaus({ virhe: viesti }, status))) }),
      ).rejects.toThrow(viesti);
    await selkokielinen(402, "Rajat ylittynyt.");
    await selkokielinen(422, "Ilmari ei osannut tunnistaa ateriaa kuvauksesta.");
    await selkokielinen(502, "Aterian luvut eivät kelvanneet. Mitään ei tallennettu.");
    await selkokielinen(503, "Ilmarin palvelu ei vastannut.");
    await selkokielinen(504, "Aterian tulkinta kesti liian kauan.");
    await expect(
      tulkitseKuvaus(KUVAUS, { hae: f(vi.fn(async () => vastaus({ virhe: "sisäinen" }, 500))) }),
    ).rejects.toThrow(YLEINEN_VIRHE);
    await expect(
      tulkitseKuvaus(KUVAUS, { hae: f(vi.fn(async () => vastaus({ viesti: "ei virhe-kenttää" }, 402))) }),
    ).rejects.toThrow(YLEINEN_VIRHE);
    await expect(
      tulkitseKuvaus(KUVAUS, { hae: f(vi.fn(async () => vastaus(null, 402))) }),
    ).rejects.toThrow(YLEINEN_VIRHE);
  });

  it("kelvoton vastaus hylätään", async () => {
    const hae = vi.fn(async () => vastaus({ draft: luonnos }, 200));
    await expect(tulkitseKuvaus(KUVAUS, { hae: f(hae) })).rejects.toThrow(
      "Luonnos ei kelvannut. Yritä uudelleen.",
    );
    const puuttuuRooli = { ...vastausRunko };
    delete (puuttuuRooli as { rooli: string }).rooli;
    await expect(
      tulkitseKuvaus(KUVAUS, { hae: f(vi.fn(async () => vastaus(puuttuuRooli))) }),
    ).rejects.toThrow("Luonnos ei kelvannut. Yritä uudelleen.");
    const tuntematonKentta = { ...vastausRunko, ylimpaara: 1 };
    await expect(
      tulkitseKuvaus(KUVAUS, { hae: f(vi.fn(async () => vastaus(tuntematonKentta))) }),
    ).rejects.toThrow("Luonnos ei kelvannut. Yritä uudelleen.");
  });
});

describe("roolien skeema", () => {
  it("sallii vain kolme roolia", () => {
    expect(ateriaKuvausRooliSchema.safeParse("ateria_kuvaus").success).toBe(true);
    expect(ateriaKuvausRooliSchema.safeParse("ceo").success).toBe(false);
  });
});
