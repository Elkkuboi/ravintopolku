// Tavoitteet luonnollisesta kielestä: vapaa teksti työaseman palvelimelle, joka kutsuu aiops-välittäjää.
//
// Elias ei täytä lomakkeita: hän kirjoittaa tavoitteensa sanoin ("painon lievä pudotus") tai valitsee valmiin
// kuvauksen, ja Ilmari ehdottaa päivän energia- ja makrotavoitteet sekä lyhyen perustelun. Ehdotus näytetään
// tarkistettavaksi: vasta hyväksytyt luvut tallentuvat päivän tavoitteeksi. Numerot tarkistetaan koodissa täällä ja
// palvelimella (palvelin/src/ravintopolku_palvelin/tavoitteet.py). Ilman työaseman palvelinta tai välittäjää (404)
// toiminto ei ole käytössä ja tavoitteet säädetään kuten ennenkin.
import { z } from "zod";
import { apiURL } from "./client";
import {
  type Goal,
  type Nutrients,
  type Profile,
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
export const ROOLIN_NIMI: Record<TavoiteRooli, string> = {
  tavoite_ehdottaja: "Hubin valinta (tavoite_ehdottaja)",
  tavoite_ehdottaja_pilvi: "Pilvi (tavoite_ehdottaja_pilvi)",
  tavoite_ehdottaja_paikallinen: "Paikallinen (tavoite_ehdottaja_paikallinen)",
};

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
/** Valmiit kuvaukset samoista tavoitteista — tekstiä saa tietenkin muokata. */
export const VALMIIT_TAVOITTEET = [
  "Painon lievä pudotus",
  "Rasvan muuttaminen lihakseksi",
  "Painon ylläpito",
  "Lihasmassan kasvatus",
  "Vähähiilihydraattinen arki",
];

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
export type TavoiteArvot = z.infer<typeof ehdotusSchema>;

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

/** Pyytää Ilmarilta tavoite-ehdotuksen palvelimen kautta. Heittää suomenkielisen virheen, jolloin mitään ei tapahdu. */
export async function ehdotaTavoitteet(
  teksti: string,
  {
    rooli = OLETUSROOLI,
    profiili = "",
    hae = fetch,
  }: { rooli?: TavoiteRooli; profiili?: string; hae?: typeof fetch } = {},
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
        rooli,
        profiili: profiili.trim().slice(0, PROFIILI_MAX),
      }),
    });
  } catch {
    throw new Error(
      "Työaseman palvelimeen ei saada yhteyttä. Tavoitteita ei ehdotettu.",
    );
  }
  const body: unknown = await r.json().catch(() => null);
  if (r.status === 404 || r.status === 401)
    throw new Error(
      "Tavoite-ehdotus ei ole käytössä tällä palvelimella (vaatii työaseman palvelimen ja aiops-välittäjän).",
    );
  if (!r.ok)
    throw new Error(
      body && typeof body === "object" && "virhe" in body
        ? String(body.virhe)
        : `Tavoite-ehdotus epäonnistui: palvelin vastasi ${r.status}.`,
    );
  const tulos = vastausSchema.safeParse(body);
  if (!tulos.success)
    throw new Error("Palvelimen vastaus ei kelpaa. Ehdotusta ei näytetä.");
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
