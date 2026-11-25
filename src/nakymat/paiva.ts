// Tänään-sivun puhtaat apufunktiot: päivän nimi, ateriarivi, edellinen paino ja aterian kopio. Testattavissa ilman
// selainta.
import {
  type Lifestyle,
  type Meal,
  type Photo,
  type Weight,
  stamped,
  id,
} from "../domain/model";
import { addDays, wallTimestamp } from "../domain/dates";
import { formatNumber, mealTotals } from "../domain/nutrition";

const viikonpaiva = new Intl.DateTimeFormat("fi-FI", {
  weekday: "long",
  timeZone: "UTC",
});

/** "torstai 19.11." (isot kirjaimet tulevat tyylistä). */
export function paivanNimi(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${viikonpaiva.format(new Date(day + "T12:00:00Z"))} ${d}.${m}.`;
}

/** Kellonaika suomalaisittain: 08:00 -> 08.00. */
export const kelloksi = (time: string) => time.replace(":", ".");

/** Kuvasta tulkitun aterian muistiinpano on sen nimi (rivillä ja muokkauksen kentässä "Nimi"). */
export const kuvastaTulkittu = (origin: string) => origin.startsWith("Kuvasta");

/** Kuvasta tulkitun aterian nimi on sen muistiinpano; muuten rivien nimet. */
export function aterianOtsikko(meal: Meal): string {
  if (kuvastaTulkittu(meal.origin) && meal.note.trim())
    return meal.note.trim();
  return meal.lines.map((l) => l.name).join(", ");
}

/** Aterian energia riville; osittainen summa merkitään ≥-merkillä. */
export function aterianKcal(meal: Meal): string {
  const e = mealTotals(meal).energy;
  return (e.partial && e.value !== null ? "≥" : "") + formatNumber(e.value, 0);
}

/** Alarivi: "P 20 · H 55 · R 14", kuvasta tulkitulla lisäksi "kuvasta". */
export function aterianAlarivi(meal: Meal): string {
  const t = mealTotals(meal);
  const osat = [
    `P ${formatNumber(t.protein.value, 0)}`,
    `H ${formatNumber(t.carbs.value, 0)}`,
    `R ${formatNumber(t.fat.value, 0)}`,
  ];
  if (meal.origin.startsWith("Kuvasta")) osat.push("kuvasta");
  return osat.join(" · ");
}

/** Painon otsikon lisätieto: viimeisin aiempi mittaus, "eilen 77,9" tai "18.11. 77,9". */
export function edellinenPaino(weights: Weight[], date: string): string {
  const aiempi = weights
    .filter((w) => w.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!aiempi) return "";
  const [, m, d] = aiempi.date.split("-").map(Number);
  const milloin = aiempi.date === addDays(date, -1) ? "eilen" : `${d}.${m}.`;
  return `${milloin} ${formatNumber(aiempi.kg)}`;
}

/** Aterian kopio toiselle päivälle: samat rivit ja kellonaika, uudet tunnisteet; kuvasta oma kopio. */
export function aterianKopio(
  meal: Meal,
  date: string,
  photo: Photo | undefined,
): { meal: Meal; photo: Photo | null } {
  const kuva = photo ? { ...stamped(), blob: photo.blob } : null;
  return {
    meal: {
      ...meal,
      ...stamped(),
      date,
      timestamp: wallTimestamp(date, meal.time),
      lines: meal.lines.map((l) => ({ ...l, id: id() })),
      photoId: kuva?.id ?? null,
    },
    photo: kuva,
  };
}

/**
 * "Uni, liike ja olo" -lomakkeen avain: lomake alkaa alusta vain, kun päivä tai sen kentät muuttuvat muualla
 * (synkronointi). Treenipäivän napautus ei tyhjennä kesken olevaa lomaketta, ja puuttuva kirjaus on sama kuin tyhjä.
 */
export const lomakkeenAvain = (date: string, l?: Lifestyle) =>
  JSON.stringify([
    date,
    l?.steps ?? null,
    l?.sleep ?? null,
    l?.training ?? "",
    l?.hunger ?? null,
    l?.energy ?? null,
  ]);
