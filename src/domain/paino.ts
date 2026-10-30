// Päivän paino kirjataan yhdellä kentällä vapaalla tekstillä: "82,4",
// "paino 82,4 kg" tai "punnitsin itseni 82,4". Ilmari täyttää numerot, joten
// käyttäjän ei tarvitse täyttää lomaketta: koodi poimii luvun ja varmistaa,
// että se on kiloina ja täsmälleen yhden desimaalin tarkkuudella.
//
// Epäselvästä tekstistä ei arvata: jos sopivia lukuja ei ole tai niitä on
// useita eri arvoja, tulos on null. Tällöin paino jää kirjaamatta ja
// tarkistusnäkymä pyytää korjaamaan tekstin. Puuttuvaa painoa ei koskaan
// tulkita nollaksi.
import { PAINO_MIN, PAINO_MAX, pyöristäPaino } from "./model";

// Numerotunniste: myös "82,4" ja "82.4". Useampi erotin ("1,2,3") hylätään alla.
const NUMERO = /\d+(?:[.,]\d+)*/g;
// Päivämäärä ei ole paino: 2026-10-30, 30.10.2026, 30.10. ja irrallinen päivä
// "30.". Sitä vastoin "82,4" ja "82.4" luetaan painoksi, joten ilman vuosiosaa
// tai jälkimmäistä pistettä oleva muoto jätetään koskematta.
const PÄIVÄMÄÄRÄ =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\.?|\b\d{1,2}\.\d{1,2}\.|\b(?:[1-9]|[12]\d|3[01])\.(?=\s|$)/g;

function numero(token: string): number | null {
  if ((token.match(/[.,]/g) ?? []).length > 1) return null;
  const n = Number(token.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Palauttaa tekstistä päivän painon kiloina (yksi desimaali) tai null. */
export function tulkitsePaino(text: string): number | null {
  const tokens = text.replace(PÄIVÄMÄÄRÄ, " ").match(NUMERO) ?? [];
  const ehdokkaat = new Set<number>();
  for (const token of tokens) {
    const kg = numero(token);
    if (kg === null || kg < PAINO_MIN || kg > PAINO_MAX) continue;
    ehdokkaat.add(pyöristäPaino(kg));
  }
  return ehdokkaat.size === 1 ? ([...ehdokkaat][0] as number) : null;
}
