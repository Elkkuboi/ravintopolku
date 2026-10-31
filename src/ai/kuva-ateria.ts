// Kuvasta ateria (aiops ADR-0025/-0027): kuva lähetetään työaseman palvelimelle, joka kutsuu aiops-välittäjää.
//
// Palvelin palauttaa AIDraft-luonnoksen, josta sovellus luo aterian heti päiväkirjaan ilman pakollisia kenttiä.
// Lähde valitaan Asetuksista (kuvantunnistus): "ilmari" = paikallinen Ilmari työaseman palvelimen kautta,
// "api" = palvelimen (server/) API-avain OpenAIhin. Ilmarin rooli (model-kenttä välittäjälle) valitaan
// erikseen: Hubin valinta, pilvi tai paikallinen malli. Ilman palvelinta, välittäjää tai API-avainta
// toiminto ei ole käytössä ja päiväkirja toimii kuten ennenkin.
import { z } from "zod";
import { draftSchema, type AIDraft } from "./provider";
import { apiURL, HttpProvider } from "./client";
import { draftNotes } from "./draft-fields";
import {
  type Meal,
  type MealLine,
  type Photo,
  kuvaRooliSchema,
  kuvaLahdeSchema,
  type KuvaLahde,
  stamped,
  id,
  TIMEZONE,
} from "../domain/model";
import { mealSnapshot } from "../domain/nutrition";
import { wallTimestamp } from "../domain/dates";

export const KUVA_ROOLIT = kuvaRooliSchema.options;
export type KuvaRooli = z.infer<typeof kuvaRooliSchema>;
export const OLETUSROOLI: KuvaRooli = "kuva_tulkki";
export const ROOLIN_NIMI: Record<KuvaRooli, string> = {
  kuva_tulkki: "Hubin valinta (kuva_tulkki)",
  kuva_tulkki_pilvi: "Pilvi (kuva_tulkki_pilvi)",
  kuva_tulkki_paikallinen: "Paikallinen (kuva_tulkki_paikallinen)",
};
export const KUVA_LAHTEET = kuvaLahdeSchema.options;
export type { KuvaLahde };
export const OLETUSLAHDE: KuvaLahde = "ilmari";
export const LAHTEEN_NIMI: Record<KuvaLahde, string> = {
  ilmari: "Paikallinen Ilmari (työaseman palvelin, ei API-avainta)",
  api: "API-avain (OpenAI-palvelin)",
};
export const KUVA_MAX = 8 * 1024 * 1024;
// API-avaimen reitti (server/) ottaa vastaan enintään 2 Mt:n kuvan; työaseman välittäjä 8 Mt.
export const KUVA_API_MAX = 2 * 1024 * 1024;

export const kuvaTulosSchema = z.object({
  draft: draftSchema,
  kind: z.enum(["ateria", "tuoteseloste"]),
  rooli: kuvaRooliSchema,
});
export type KuvaTulos = {
  draft: AIDraft;
  kind: "ateria" | "tuoteseloste";
  /** Ilmarin rooli (model-kenttä) tai "API-avain", kun kuva tulkittiin palvelimen avaimella. */
  rooli: string;
  /** Moottori: paikallinen Ilmari (oletus) tai palvelimen API-avain. */
  lahde?: KuvaLahde;
};

/** Kehote API-avaimen reitille: kuva on ainoa syöte, joten laji (annos vs. seloste) päätellään luonnoksesta. */
export const API_KEHOTE =
  "Kuva on ainoa syöte: tulkitse joko ruoka-annos (portion, koko annoksen arvot) tai pakkauksen " +
  "tuoteseloste (per100, pakkauksen massa grammoina). Älä kysy lisätietoja.";

/** API-luonnoksesta ei tule lajia mukana: per100-rivi kertoo tuoteselosteesta. */
export function paatteleLaji(draft: AIDraft): KuvaTulos["kind"] {
  return draft.lines.some((l) => l.mode === "per100")
    ? "tuoteseloste"
    : "ateria";
}

/** Kuva palvelimen /api/ai/draft-reitille, joka käyttää palvelimen API-avainta; avain ei ole selaimessa. */
export async function tulkitseKuvaApi(
  kuva: Blob,
  hae: typeof fetch = fetch,
): Promise<KuvaTulos> {
  if (kuva.size > KUVA_API_MAX)
    throw new Error(
      "Kuva on liian suuri API-avaimelle (enintään 2 Mt). Valitse pienempi kuva tai ota käyttöön paikallinen Ilmari.",
    );
  let draft: AIDraft;
  try {
    draft = await new HttpProvider(
      { imageInput: true, structuredOutput: true },
      undefined,
      hae,
      "Kuvantunnistuksen API-avaimen reittiä ei ole tässä osoitteessa. Valitse paikallinen Ilmari tai käynnistä palvelin, jolla on API-avain.",
    ).interpret("portion", { text: API_KEHOTE, image: kuva });
  } catch (e) {
    // Providerin raaka virhe (Zod) ei kelpaa käyttäjälle: palvelimen vastaus hylätään kokonaan.
    if (e instanceof z.ZodError)
      throw new Error("Palvelimen vastaus ei kelpaa. Mitään ei tallennettu.");
    throw e;
  }
  return { draft, kind: paatteleLaji(draft), rooli: "API-avain", lahde: "api" };
}

/** Lähettää kuvan valitulla lähteellä ja palauttaa tarkistetun luonnoksen. Heittää suomenkielisen virheen. */
export async function tulkitseKuva(
  kuva: Blob,
  rooli: KuvaRooli,
  pvm: string,
  hae: typeof fetch = fetch,
  lahde: KuvaLahde = OLETUSLAHDE,
): Promise<KuvaTulos> {
  if (kuva.size > KUVA_MAX)
    throw new Error(
      "Kuva on liian suuri (enintään 8 Mt). Valitse pienempi kuva.",
    );
  if (lahde === "api") return tulkitseKuvaApi(kuva, hae);
  const runko = new FormData();
  runko.append("kuva", kuva, "ateria.jpg");
  runko.append("rooli", rooli);
  runko.append("pvm", pvm);
  let r: Response;
  try {
    r = await hae(apiURL("kuva-ateria"), {
      method: "POST",
      credentials: "same-origin",
      body: runko,
    });
  } catch {
    throw new Error(
      "Työaseman palvelimeen ei saada yhteyttä. Kuvaa ei lähetetty.",
    );
  }
  const body: unknown = await r.json().catch(() => null);
  if (r.status === 404 || r.status === 401)
    throw new Error(
      "Kuvasta ateria ei ole käytössä tällä palvelimella (vaatii työaseman palvelimen ja aiops-välittäjän).",
    );
  if (!r.ok)
    throw new Error(
      body && typeof body === "object" && "virhe" in body
        ? String(body.virhe)
        : `Kuvantulkinta epäonnistui: palvelin vastasi ${r.status}.`,
    );
  const tulos = kuvaTulosSchema.safeParse(body);
  if (!tulos.success)
    throw new Error("Palvelimen vastaus ei kelpaa. Mitään ei tallennettu.");
  return { ...tulos.data, lahde };
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

/** Luo tallennettavan aterian luonnoksesta: alkuperä ja oletukset kertovat kuvasta ja lähteestä. */
export function ateriaKuvasta(
  tulos: KuvaTulos,
  date: string,
  time: string,
  photo: Photo | null,
): Meal {
  const malli = tulos.draft.provenance.model;
  const alkupera =
    tulos.lahde === "api"
      ? `Kuvasta (API-avain${malli ? ": " + malli : ""})`
      : `Kuvasta (rooli ${tulos.rooli})`;
  const oletukset: string[] = [alkupera];
  const lines: MealLine[] = tulos.draft.lines.map((l) => {
    const grams = l.mode === "per100" && l.grams === null ? 100 : l.grams;
    if (grams !== l.grams) oletukset.push(`Määrä oletettu 100 g: ${l.name}`);
    return { ...l, id: id(), foodId: null, grams };
  });
  if (!photo) oletukset.push("Kuvaa ei tallennettu laitteelle.");
  return {
    ...stamped(),
    date,
    time,
    timestamp: wallTimestamp(date, time),
    timezone: TIMEZONE,
    type: ateriatyyppi(time),
    lines,
    snapshot: mealSnapshot(lines),
    note: tulos.draft.name,
    origin: `${alkupera}: ${tulos.kind === "tuoteseloste" ? "tuoteseloste" : "ruoka-annos"}`,
    assumptions: [...oletukset, ...draftNotes(tulos.draft)].slice(0, 302),
    photoId: photo?.id ?? null,
  };
}
