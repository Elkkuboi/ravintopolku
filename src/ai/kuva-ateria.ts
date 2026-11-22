// Kuvasta ateria (aiops ADR-0025/-0027): kuva lähetetään työaseman palvelimelle (/api/kuva-ateria), joka kutsuu
// aiops-välittäjää aina roolilla kuva_tulkki. Hub päättää mallin ja välittäjä hoitaa varareitin, joten asetuksiin
// tallennetut vanhat lähde- ja roolivalinnat eivät vaikuta kutsuun: tulkitseKuva ei lue asetuksia lainkaan.
//
// Palvelin palauttaa luonnoksen, jonka käyttäjä tarkistaa ennen tallennusta (components/KuvaLuonnos.tsx). Virhe näytetään
// lyhyenä suomenkielisenä viestinä HTTP-tilan mukaan: palvelimen tai välittäjän tekninen teksti ei päädy näkyviin.
// Kuvan mukana saa lähettää vapaan lisätiedon (palvelimen kenttä `vihje`); sama teksti jää ateriaan näkyviin.
import { z } from "zod";
import { draftSchema } from "./provider";
import { apiURL } from "./client";
import {
  type Meal,
  type MealLine,
  type Photo,
  kuvaRooliSchema,
  keys,
  emptyNutrients,
  numberInput,
  stamped,
  id,
  TIMEZONE,
} from "../domain/model";
import {
  aggregate,
  lineNutrients,
  mealSnapshot,
  type Totals,
} from "../domain/nutrition";
import { wallTimestamp } from "../domain/dates";
import { LAHETYS_MAX } from "../data/photos";

export const KUVA_ROOLI = "kuva_tulkki";

/** Vapaa lisätieto kuvan mukana: palvelimen VIHJE_MAX on sama raja. */
export const LISATIEDOT_MAX = 300;
export const LISATIEDOT_VIRHE = `Lisätieto saa olla enintään ${LISATIEDOT_MAX} merkkiä.`;

export const kuvaTulosSchema = z.object({
  draft: draftSchema,
  kind: z.enum(["ateria", "tuoteseloste"]),
  rooli: kuvaRooliSchema,
});
export type KuvaTulos = z.infer<typeof kuvaTulosSchema>;

/** Käyttäjälle näytettävät viestit. Napit "Yritä uudelleen" ja "Kirjoita käsin" kertovat, mitä voi tehdä. */
export const KUVA_VIRHE = {
  yhteys: "Palvelimeen ei saada yhteyttä. Kuvaa ei lähetetty.",
  eiKaytossa: "Kuvan tulkinta ei ole käytössä.",
  budjetti: "Viikon AI-budjetti on käytetty.",
  liianSuuri: "Kuva on liian suuri tulkittavaksi.",
  eiRuokaa: "Kuvasta ei tunnistettu ruokaa.",
  eiNyt: "Kuvan tulkinta ei ole juuri nyt käytettävissä.",
  hidas: "Tulkinta kesti liian kauan.",
  kelvoton: "Tulkinnan tulos ei kelpaa. Mitään ei tallennettu.",
  muu: "Kuvan tulkinta ei onnistunut.",
} as const;

/** HTTP-tilasta lyhyt viesti. Vastauksen tekstiä ei käytetä, joten tarjoajan virhe ei voi näkyä käyttäjälle. */
export function kuvaVirhe(tila: number): string {
  switch (tila) {
    case 401:
    case 404:
      return KUVA_VIRHE.eiKaytossa;
    case 402:
      return KUVA_VIRHE.budjetti;
    case 413:
      return KUVA_VIRHE.liianSuuri;
    case 422:
      return KUVA_VIRHE.eiRuokaa;
    case 501:
    case 503:
      return KUVA_VIRHE.eiNyt;
    case 504:
      return KUVA_VIRHE.hidas;
    default:
      return KUVA_VIRHE.muu;
  }
}

/** Yhden rivin muoto: trimattu ja välit tasoitettu. */
export function siistiLisatiedot(teksti: string): string {
  return teksti.trim().replace(/\s+/g, " ");
}

/**
 * Lähettää pienennetyn kuvan ja lisätiedon tulkittavaksi ja palauttaa tarkistetun luonnoksen. Heittää suomenkielisen
 * virheen. Keskeytetty pyyntö (Peru) heittää selaimen AbortErrorin sellaisenaan.
 */
export async function tulkitseKuva(
  kuva: Blob,
  pvm: string,
  lisatiedot = "",
  hae: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<KuvaTulos> {
  if (kuva.size > LAHETYS_MAX) throw new Error(KUVA_VIRHE.liianSuuri);
  const vihje = siistiLisatiedot(lisatiedot);
  if (vihje.length > LISATIEDOT_MAX) throw new Error(LISATIEDOT_VIRHE);
  const runko = new FormData();
  runko.append("kuva", kuva, "ateria.jpg");
  runko.append("rooli", KUVA_ROOLI);
  runko.append("pvm", pvm);
  if (vihje) runko.append("vihje", vihje);
  let r: Response;
  try {
    r = await hae(apiURL("kuva-ateria"), {
      method: "POST",
      credentials: "same-origin",
      body: runko,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(KUVA_VIRHE.yhteys);
  }
  if (!r.ok) throw new Error(kuvaVirhe(r.status));
  const tulos = kuvaTulosSchema.safeParse(await r.json().catch(() => null));
  if (!tulos.success) throw new Error(KUVA_VIRHE.kelvoton);
  return tulos.data;
}

/** Ateriatyyppi kellonajan mukaan; käyttäjä voi vaihtaa sen muokkauksessa. */
export function ateriatyyppi(time: string): Meal["type"] {
  const h = Number(time.slice(0, 2));
  if (h < 10) return "Aamiainen";
  if (h < 14) return "Lounas";
  if (h < 17) return "Välipala";
  if (h < 20) return "Päivällinen";
  return "Iltapala";
}

/** Tallentamaton ateria luonnoksesta: nimi muistiinpanona, alkuperä yhtenä rivinä, mallin huomiot oletuksina. */
export function ateriaKuvasta(
  tulos: KuvaTulos,
  date: string,
  time: string,
  photo: Photo | null,
  lisatiedot = "",
): Omit<Meal, "profiiliId"> & { profiiliId?: string } {
  const d = tulos.draft;
  const oletukset: string[] = [];
  const vihje = siistiLisatiedot(lisatiedot);
  if (vihje) oletukset.push(`Lisätiedot: ${vihje}`);
  const lines: MealLine[] = d.lines.map((l) => {
    const grams = l.mode === "per100" && l.grams === null ? 100 : l.grams;
    if (grams !== l.grams) oletukset.push(`Määrä oletettu 100 g: ${l.name}`);
    return { ...l, id: id(), foodId: null, grams };
  });
  if (!photo) oletukset.push("Kuvaa ei tallennettu laitteelle.");
  const malli = d.provenance.model;
  return {
    ...stamped(),
    date,
    time,
    // profiiliId puuttuu tarkoituksella: tallennus hoitaa aktiivisen profiilin
    // tuntemisen, ja luonnos tulkitaan tallennettaessa.
    timestamp: wallTimestamp(date, time),
    timezone: TIMEZONE,
    type: ateriatyyppi(time),
    lines,
    snapshot: mealSnapshot(lines),
    note: d.name,
    origin: `Kuvasta${malli ? ` (${malli})` : ""}: ${tulos.kind === "tuoteseloste" ? "tuoteseloste" : "ruoka-annos"}`,
    assumptions: [
      ...oletukset,
      ...d.assumptions,
      ...d.unknowns.map((s) => "Tuntematon: " + s),
      ...d.questions.map((s) => "Kysymys: " + s),
    ].slice(0, 302),
    photoId: photo?.id ?? null,
  };
}

// --- Luonnoksen tarkistus: rivit ruoka / g / kcal ------------------------------------------------------------------

/** Muokattava rivi: alkuperäinen rivi ja kenttien tekstit. kcal null = lasketaan grammoista. */
export interface LuonnosRivi {
  pohja: MealLine;
  nimi: string;
  g: string;
  kcal: string | null;
}

const pyorista = (n: number) => Math.round(n * 10) / 10;
const kentaksi = (n: number | null) =>
  n === null ? "" : String(pyorista(n)).replace(".", ",");

export const luonnosRivit = (meal: Omit<Meal, "profiiliId"> & { profiiliId?: string }): LuonnosRivi[] =>
  meal.lines.map((l) => ({
    pohja: l,
    nimi: l.name,
    g: kentaksi(l.grams),
    kcal: null,
  }));

export const uusiRivi = (): LuonnosRivi => ({
  pohja: {
    id: id(),
    name: "",
    foodId: null,
    mode: "portion",
    grams: null,
    values: emptyNutrients(),
    source: "Oma arvio",
    state: "",
  },
  nimi: "",
  g: "",
  kcal: null,
});

/**
 * Rivi kenttien mukaan. Annoksen arvot skaalautuvat grammoihin (isompi annos, enemmän kaikkea); per 100 g -rivi
 * laskee itse. Oma kcal-luku korvaa energian ja pysyy, vaikka grammoja muutetaan. Heittää, jos luku ei kelpaa.
 */
export function riviksi(r: LuonnosRivi): MealLine {
  const p = r.pohja;
  const g = numberInput(r.g, p.mode === "portion");
  const values = { ...p.values };
  if (p.mode === "portion" && p.grams && g && g !== p.grams)
    for (const k of keys) {
      const v = values[k];
      values[k] = v === null ? null : pyorista((v * g) / p.grams);
    }
  if (r.kcal !== null) {
    const kcal = numberInput(r.kcal, true);
    values.energy =
      p.mode === "per100" && kcal !== null && g
        ? pyorista((kcal * 100) / g)
        : kcal;
  }
  return { ...p, name: r.nimi.trim(), grams: g, values };
}

/** kcal-kentän teksti: oma luku tai grammoista laskettu; tyhjä, jos kentät eivät vielä kelpaa. */
export function rivinKcal(r: LuonnosRivi): string {
  if (r.kcal !== null) return r.kcal;
  try {
    const e = lineNutrients(riviksi(r)).energy;
    return e === null ? "" : String(Math.round(e));
  } catch {
    return "";
  }
}

/** Yhteensä-rivin summat nimetyistä riveistä; null, jos jokin luku ei kelpaa. */
export function luonnosSumma(rivit: LuonnosRivi[]): Totals | null {
  try {
    return aggregate(
      rivit.filter((r) => r.nimi.trim()).map((r) => lineNutrients(riviksi(r))),
    );
  } catch {
    return null;
  }
}

/** Tallennettava ateria: tyhjänimiset rivit jäävät pois, ateriatyyppi seuraa kelloa. */
export function luonnosAteriaksi(
  pohja: Omit<Meal, "profiiliId"> & { profiiliId?: string },
  nimi: string,
  kello: string,
  rivit: LuonnosRivi[],
): Omit<Meal, "profiiliId"> & { profiiliId?: string } {
  const lines = rivit.filter((r) => r.nimi.trim()).map(riviksi);
  if (!lines.length) throw new Error("Lisää vähintään yksi ruoka.");
  return {
    ...pohja,
    time: kello,
    timestamp: wallTimestamp(pohja.date, kello),
    type: ateriatyyppi(kello),
    note: nimi.trim(),
    lines,
    snapshot: mealSnapshot(lines),
  };
}
