// Tavoitteet luonnollisesta kielestä: vapaa teksti työaseman palvelimelle, joka kutsuu aiops-välittäjää.
//
// Elias kirjoittaa tavoitteensa sanoin ("painon lievä pudotus"), ja Ilmari ehdottaa päivän energia- ja makrotavoitteet
// sekä lyhyen perustelun. Ehdotus näytetään tarkistettavaksi: vasta hyväksytyt luvut tallentuvat päivän tavoitteeksi.
// Numerot tarkistetaan koodissa täällä ja palvelimella (palvelin/src/ravintopolku_palvelin/tavoitteet.py). Käyttäjä
// näkee vain lyhyen suomenkielisen virheen; tekninen syy jää palvelimen lokiin. Sama tiedosto muodostaa myös
// Asetusten tavoitelomakkeen tallentaman tavoitteen (tavoiteLomakkeesta).
import { z } from "zod";
import { apiURL } from "./client";
import {
  type Goal,
  type Nutrients,
  type Profile,
  PAINO_MAX,
  PAINO_MIN,
  stamped,
} from "../domain/model";

export const tavoiteRooliSchema = z.enum([
  "tavoite_ehdottaja",
  "tavoite_ehdottaja_pilvi",
  "tavoite_ehdottaja_paikallinen",
]);
export const TAVOITE_ROOLIT = tavoiteRooliSchema.options;
export type TavoiteRooli = z.infer<typeof tavoiteRooliSchema>;
export const OLETUSROOLI: TavoiteRooli = "tavoite_ehdottaja";

export const TEKSTI_MIN = 3,
  TEKSTI_MAX = 500,
  PROFIILI_MAX = 300;
/** Järkiperäiset rajat yhden päivän tavoitteille: palvelin hylkää tätä pienemmän ja leikkaa suuremman arvon. */
export const RAJAT = {
  energy: [800, 6000],
  protein: [30, 250],
  carbs: [20, 700],
  fat: [20, 200],
} as const;
export const NIMET: Record<keyof typeof RAJAT, string> = {
  energy: "Energia (kcal)",
  protein: "Proteiini (g)",
  carbs: "Hiilihydraatit (g)",
  fat: "Rasva (g)",
};
const rajattu = (avain: keyof typeof RAJAT) =>
  z.number().finite().min(RAJAT[avain][0]).max(RAJAT[avain][1]).nullable();

export const ehdotusSchema = z
  .object({
    energy: rajattu("energy"),
    protein: rajattu("protein"),
    carbs: rajattu("carbs"),
    fat: rajattu("fat"),
  })
  .strict();
export const vastausSchema = z
  .object({
    ehdotus: ehdotusSchema,
    perustelu: z.string().max(400),
    oletukset: z.array(z.string().max(300)).max(10),
    rooli: tavoiteRooliSchema,
    malli: z.string().max(200).nullable(),
  })
  .strict();
export type TavoiteEhdotus = z.infer<typeof vastausSchema>;

/** Tilat, joiden virheteksti tulee palvelimen tavoitteet.py:stä selkokielisenä; muut korvataan yleisellä viestillä. */
const SELKOKIELISET = new Set([402, 422, 502, 503, 504]);
export const YLEINEN_VIRHE =
  "Tavoite-ehdotus epäonnistui. Yritä uudelleen tai kirjoita tavoitteet itse.";

/** Pyytää Ilmarilta tavoite-ehdotuksen palvelimen kautta. Heittää suomenkielisen virheen, jolloin mitään ei tapahdu. */
export async function ehdotaTavoitteet(
  teksti: string,
  {
    profiili = "",
    hae = fetch,
  }: { profiili?: string; hae?: typeof fetch } = {},
): Promise<TavoiteEhdotus> {
  const puhdas = teksti.trim().replace(/\s+/g, " ");
  if (puhdas.length < TEKSTI_MIN)
    throw new Error(
      `Kirjoita tavoite sanoin (vähintään ${TEKSTI_MIN} merkkiä).`,
    );
  if (puhdas.length > TEKSTI_MAX)
    throw new Error(
      `Tavoitekuvaus on liian pitkä (enintään ${TEKSTI_MAX} merkkiä).`,
    );
  let r: Response;
  try {
    r = await hae(apiURL("tavoitteet"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Ravintopolku": "1" },
      body: JSON.stringify({
        teksti: puhdas,
        rooli: OLETUSROOLI,
        profiili: profiili.trim().slice(0, PROFIILI_MAX),
      }),
    });
  } catch {
    throw new Error(
      "Palvelimeen ei saada yhteyttä. Yritä myöhemmin uudelleen.",
    );
  }
  const body: unknown = await r.json().catch(() => null);
  if (r.status === 404)
    throw new Error("Tavoite-ehdotus ei ole käytössä tällä palvelimella.");
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
  if (!tulos.success) throw new Error("Ehdotus ei kelvannut. Yritä uudelleen.");
  return tulos.data;
}

/** Lyhyt kuvaus nykytilanteesta mallin avuksi. Puuttuvaa ei mainita: malli ei saa keksiä arvoja. */
export function profiiliKuvaus(
  profile: Profile | undefined,
  {
    weight = null,
    goalEnergy = null,
  }: { weight?: number | null; goalEnergy?: number | null } = {},
): string {
  const osat = [
    profile?.age !== null && profile?.age !== undefined
      ? `ikä ${profile.age} vuotta`
      : "",
    profile ? `pituus ${profile.height} cm` : "",
    weight
      ? `uusin paino ${weight} kg`
      : profile
        ? `lähtöpaino ${profile.startWeight} kg`
        : "",
    profile?.training ? `treenejä ${profile.training} kertaa viikossa` : "",
    profile?.activity ? `liikuntaa: ${profile.activity}` : "",
    goalEnergy ? `nykyinen energiatavoite ${goalEnergy} kcal` : "",
  ].filter(Boolean);
  return osat.join("; ").slice(0, PROFIILI_MAX);
}

/** Makrojen energia: 4×proteiini + 4×hiilihydraatit + 9×rasva, tai null jos jokin makro puuttuu. */
export const makroenergia = (arvot: {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}): number | null =>
  arvot.protein === null || arvot.carbs === null || arvot.fat === null
    ? null
    : Math.round(4 * arvot.protein + 4 * arvot.carbs + 9 * arvot.fat);

/** Varoitus, jos makrot eivät täsmää energiatavoitteen kanssa (enintään 10 %:n ero sallittu). */
export const vertaaMakroja = (arvot: {
  energy: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}): string | null => {
  const summa = makroenergia(arvot);
  if (arvot.energy === null || summa === null) return null;
  if (Math.abs(summa - arvot.energy) / arvot.energy <= 0.1) return null;
  return `Makrot vastaavat ${summa} kcal, kun energiatavoite on ${arvot.energy} kcal. Tarkista suhteet.`;
};

/** Vertaa käyttäjän tarkistamia lukuja äärirajoihin. Heittää suomenkielisen virheen, jos jokin luku ei kelpaa. */
export function tarkistaRajat(arvot: Nutrients): void {
  const viat: string[] = [];
  for (const avain of Object.keys(RAJAT) as (keyof typeof RAJAT)[]) {
    const arvo = arvot[avain];
    if (arvo === null) continue;
    const [alin, ylin] = RAJAT[avain];
    if (arvo < alin)
      viat.push(`${NIMET[avain]} ${arvo} on alle äärirajan ${alin}`);
    else if (arvo > ylin)
      viat.push(`${NIMET[avain]} ${arvo} on yli äärirajan ${ylin}`);
  }
  if (viat.length)
    throw new Error(`${viat.join("; ")}. Säädä luvut äärirajojen sisälle.`);
}

/**
 * Hyväksytty ehdotus päivän tavoitteeksi. Kuitu ei kuulu ehdotukseen, joten se säilyy ennallaan; painotavoite ja
 * sen päivämäärä peritään voimassa olevalta tavoitteelta, joten niiden kanssa ei tingata.
 */
export function hyvaksyTavoite(
  arvot: Nutrients,
  pvm: string,
  current?: Goal,
): Goal {
  return {
    ...stamped(),
    effectiveDate: pvm,
    kind: current?.kind ?? "track",
    targetWeight: current?.targetWeight ?? null,
    targetDate: current?.targetDate ?? null,
    nutrients: {
      energy: arvot.energy,
      protein: arvot.protein,
      carbs: arvot.carbs,
      fat: arvot.fat,
      fiber: arvot.fiber ?? current?.nutrients.fiber ?? null,
    },
  };
}

/**
 * Asetusten tavoitelomake: energia, makrot, kuitu ja tavoitepaino tämän päivän tavoitteeksi. Tavoitetyyppi ja
 * tavoitepäivä, joita lomake ei näytä, peritään voimassa olevalta tavoitteelta. Jos tavoitepaino tyhjennetään,
 * painon pudotus- tai nostotavoite muuttuu pelkäksi seurannaksi (skeema vaatii niiltä painon ja päivän).
 */
export function tavoiteLomakkeesta(
  arvot: Nutrients,
  tavoitepaino: number | null,
  pvm: string,
  nykyinen?: Goal,
): Goal {
  if (
    tavoitepaino !== null &&
    (tavoitepaino < PAINO_MIN || tavoitepaino > PAINO_MAX)
  )
    throw new Error(`Tavoitepainon pitää olla ${PAINO_MIN}–${PAINO_MAX} kg.`);
  const painotavoite = nykyinen?.kind === "lose" || nykyinen?.kind === "gain";
  return {
    ...stamped(),
    effectiveDate: pvm,
    kind:
      painotavoite && tavoitepaino === null
        ? "track"
        : (nykyinen?.kind ?? "track"),
    targetWeight: tavoitepaino,
    targetDate: tavoitepaino === null ? null : (nykyinen?.targetDate ?? null),
    nutrients: { ...arvot },
  };
}
