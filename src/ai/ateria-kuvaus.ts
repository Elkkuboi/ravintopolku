// Ateria vapaasta tekstikuvauksesta: käyttäjä kirjoittaa aterian sanoin ("banaani") ja Ilmari
// täydentää ravintoarvot. Kuvan tulkinnan tapahtuu työaseman palvelimella (palvelin/src/
// ravintopolku_palvelin/ateria_kuvaus.py), joka kutsuu aiops-välittäjää samalla roolilla kuin
// kuva: Hub päättää mallin, pyynnön `model` on rooli. Luonnos on ehdotus: käyttäjä tarkistaa
// nimet, grammat ja arvot lomakkeessa ja tallentaa vasta hyväksyen. Tekstiä ei lähetetä eteenpäin
// lokiin eikä tallenneta.
import { z } from "zod";
import { apiURL } from "./client";
import { draftSchema } from "./provider";

export const ateriaKuvausRooliSchema = z.enum([
  "ateria_kuvaus",
  "ateria_kuvaus_pilvi",
  "ateria_kuvaus_paikallinen",
]);
export const ATERIA_KUVAUS_ROOLIT = ateriaKuvausRooliSchema.options;
export type AteriaKuvausRooli = z.infer<typeof ateriaKuvausRooliSchema>;
export const OLETUSROOLI: AteriaKuvausRooli = "ateria_kuvaus";

export const TEKSTI_MIN = 3,
  TEKSTI_MAX = 500;

export const vastausSchema = z
  .object({
    draft: draftSchema,
    rooli: ateriaKuvausRooliSchema,
  })
  .strict();
export type AteriaKuvausTulos = z.infer<typeof vastausSchema>;

/** Tilat, joiden virheteksti tulee palvelimen ateria_kuvaus.py:stä selkokielisenä; muut korvataan yleisellä viestillä. */
const SELKOKIELISET = new Set([402, 422, 502, 503, 504]);
export const YLEINEN_VIRHE =
  "Ateria epäonnistui. Yritä uudelleen tai kirjoita ateria käsin ilman lukuja.";

/** Pyytää Ilmarilta aterialuonnoksen vapaasta tekstistä palvelimen kautta. Heittää suomenkielisen virheen, jolloin mitään ei tapahdu. */
export async function tulkitseKuvaus(
  teksti: string,
  {
    rooli = OLETUSROOLI,
    hae = fetch,
  }: { rooli?: AteriaKuvausRooli; hae?: typeof fetch } = {},
): Promise<AteriaKuvausTulos> {
  const puhdas = teksti.trim().replace(/\s+/g, " ");
  if (puhdas.length < TEKSTI_MIN)
    throw new Error(
      `Kirjoita ateria sanoin (vähintään ${TEKSTI_MIN} merkkiä).`,
    );
  if (puhdas.length > TEKSTI_MAX)
    throw new Error(
      `Aterian kuvaus on liian pitkä (enintään ${TEKSTI_MAX} merkkiä).`,
    );
  let r: Response;
  try {
    r = await hae(apiURL("ateria-kuvaus"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Ravintopolku": "1" },
      body: JSON.stringify({ teksti: puhdas, rooli }),
    });
  } catch {
    throw new Error(
      "Palvelimeen ei saada yhteyttä. Yritä myöhemmin uudelleen.",
    );
  }
  const body: unknown = await r.json().catch(() => null);
  if (r.status === 404)
    throw new Error("Aterian tulkinta ei ole käytössä tällä palvelimella.");
  if (!r.ok) {
    const virhe =
      body && typeof body === "object" && "virhe" in body ? body.virhe : null;
    throw new Error(
      SELKOKIELISET.has(r.status) && typeof virhe === "string" && virhe
        ? virhe
        : YLEINEN_VIRHE,
    );
  }
  const tulos = vastausSchema.safeParse(body);
  if (!tulos.success) throw new Error("Luonnos ei kelvannut. Yritä uudelleen.");
  return tulos.data;
}
