// Kuvasta ateria (aiops ADR-0025/-0027): kuva lähetetään työaseman palvelimelle, joka kutsuu aiops-välittäjää.
//
// Palvelin palauttaa AIDraft-luonnoksen, josta sovellus luo aterian heti päiväkirjaan ilman pakollisia kenttiä.
// Rooli (model-kenttä välittäjälle) valitaan Asetuksista: Hubin valinta, pilvi tai paikallinen malli. Ilman
// työaseman palvelinta tai välittäjää (404) toiminto ei ole käytössä ja päiväkirja toimii kuten ennenkin.
// Kuvan mukana saa lähettää vapaat lisätiedot (palvelimen kenttä `vihje`): tekoäly saa ne datana kuvan kanssa,
// ja sama teksti jää ateriaan näkyviin tarkistusta varten.
import { z } from "zod";
import { draftSchema } from "./provider";
import { apiURL } from "./client";
import { draftNotes } from "./draft-fields";
import {
  type Meal,
  type MealLine,
  type Photo,
  kuvaRooliSchema,
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
export const KUVA_MAX = 8 * 1024 * 1024;
/**
 * Vapaat lisätiedot kuvan mukana. Palvelimen kenttä on `vihje` (enintään 300 merkkiä), ja se liitetään
 * kehotteeseen datana: tekoäly ottaa sen huomioon arvoja täyttäessään. Teksti jää ateriaan näkyviin.
 */
export const LISATIEDOT_MAX = 300;
export const LISATIEDOT_VIRHE = `Lisätiedot saavat olla enintään ${LISATIEDOT_MAX} merkkiä.`;

export const kuvaTulosSchema = z.object({
  draft: draftSchema,
  kind: z.enum(["ateria", "tuoteseloste"]),
  rooli: kuvaRooliSchema,
});
export type KuvaTulos = z.infer<typeof kuvaTulosSchema>;

/** Yhden rivin muoto: trimattu ja välit tasoitettu, jotta tekstistä jää siisti rivi luonnokseenkin. */
export function siistiLisatiedot(teksti: string): string {
  return teksti.trim().replace(/\s+/g, " ");
}

/** Lähettää kuvan (ja mahdolliset vapaat lisätiedot) palvelimelle ja palauttaa tarkistetun luonnoksen. Heittää suomenkielisen virheen. */
export async function tulkitseKuva(
  kuva: Blob,
  rooli: KuvaRooli,
  pvm: string,
  lisatiedot = "",
  hae: typeof fetch = fetch,
): Promise<KuvaTulos> {
  if (kuva.size > KUVA_MAX)
    throw new Error(
      "Kuva on liian suuri (enintään 8 Mt). Valitse pienempi kuva.",
    );
  const vihje = siistiLisatiedot(lisatiedot);
  if (vihje.length > LISATIEDOT_MAX) throw new Error(LISATIEDOT_VIRHE);
  const runko = new FormData();
  runko.append("kuva", kuva, "ateria.jpg");
  runko.append("rooli", rooli);
  runko.append("pvm", pvm);
  if (vihje) runko.append("vihje", vihje);
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

/** Luo tallennettavan aterian luonnoksesta: alkuperä ja oletukset kertovat kuvasta, roolista ja mahdollisista lisätiedoista. */
export function ateriaKuvasta(
  tulos: KuvaTulos,
  date: string,
  time: string,
  photo: Photo | null,
  lisatiedot = "",
): Meal {
  const alkupera = `Kuvasta (rooli ${tulos.rooli})`;
  const oletukset: string[] = [alkupera];
  const vihje = siistiLisatiedot(lisatiedot);
  if (vihje) oletukset.push(`Lisätiedot: ${vihje}`);
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
