// Käsin kirjauksen ja muokkauksen (MealEditor) puhdas osa: lomakkeen rivit tekstinä ja tallennettava ateria.
// Piilotetut kentät kulkevat läpi muuttumattomina: rivin id, foodId, mode, source ja state sekä aterian origin,
// assumptions, id ja createdAt. Tyhjennetty lähde saa arvon "Oma arvio", koska skeema vaatii lähteen.
import {
  type Meal,
  type MealLine,
  stamped,
  id,
  emptyNutrients,
  numberInput,
  TIMEZONE,
} from "../domain/model";
import { wallTimestamp } from "../domain/dates";
import { mealSnapshot } from "../domain/nutrition";
import {
  nutrientStrings,
  parseNutrients,
  type NutrientStrings,
} from "./form-values";

export interface EditableLine {
  line: MealLine;
  grams: string;
  values: NutrientStrings;
}
export const editLine = (line: MealLine): EditableLine => ({
  line,
  grams: line.grams === null ? "" : String(line.grams).replace(".", ","),
  values: nutrientStrings(line.values),
});
export const freshLine = (mode: "per100" | "portion"): MealLine => ({
  id: id(),
  name: "",
  foodId: null,
  mode,
  grams: mode === "per100" ? 100 : null,
  values: emptyNutrients(),
  source: "Oma arvio",
  state: "",
});

/** Lomakkeen rivit tallennettaviksi riveiksi. Heittää suomenkielisen virheen, jos luku ei kelpaa. */
export function parseLines(lines: EditableLine[]): MealLine[] {
  const parsed = lines.map((l) => ({
    ...l.line,
    name: l.line.name.trim(),
    source: l.line.source.trim() ? l.line.source : "Oma arvio",
    grams:
      l.line.mode === "per100"
        ? numberInput(l.grams)
        : numberInput(l.grams, true),
    values: parseNutrients(l.values),
  }));
  if (parsed.length === 0) throw new Error("Lisää vähintään yksi rivi.");
  return parsed;
}

/** Poikkeuksellisen suuri määrä tai arvo: käyttäjältä varmistetaan ennen tallennusta. */
export const epatavallinen = (lines: MealLine[]) =>
  lines.some(
    (l) =>
      (l.grams ?? 0) > 5000 ||
      Object.values(l.values).some((v) => v !== null && v > 3000),
  );

/**
 * Tallennettava kuvaviittaus. Kuvat eivät synkronoidu, joten toisella laitteella otetun aterian kuvaa ei ole tällä
 * laitteella: viittaus säilyy, ellei käyttäjä poistanut kuvaa. Muuten se tyhjentyisi ja synkronointi irrottaisi kuvan
 * myös kuvan ottaneelta laitteelta.
 */
export const tallennettavaKuva = (
  meal: Meal | undefined,
  kuva: { id: string } | null,
  poistettu: boolean,
): string | null => kuva?.id ?? (poistettu ? null : (meal?.photoId ?? null));

export function rakennaAteria(
  meal: Meal | undefined,
  kentat: {
    date: string;
    time: string;
    type: Meal["type"];
    note: string;
    origin: string;
    assumptions: string[];
    photoId: string | null;
  },
  lines: MealLine[],
): Meal {
  return {
    ...stamped(meal),
    date: kentat.date,
    time: kentat.time,
    timestamp: wallTimestamp(kentat.date, kentat.time),
    timezone: TIMEZONE,
    type: kentat.type,
    lines,
    snapshot: mealSnapshot(lines),
    note: kentat.note,
    origin: kentat.origin,
    assumptions: kentat.assumptions,
    photoId: kentat.photoId,
  };
}
