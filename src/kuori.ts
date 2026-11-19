// Kuoren (App.tsx) ja näkymien (src/nakymat/*) yhteinen sopimus sekä alapalkin puhtaat apufunktiot.
import { type Dataset, TIMEZONE } from "./domain/model";
import { localDay } from "./domain/dates";
import { type Tulos } from "./data/sync";

export type IlmoitusToiminto = { label: string; run: () => void };
export type Ilmoitus = { text: string; action?: IlmoitusToiminto };

/** Jokainen näkymä saa kuorelta täsmälleen nämä propit. */
export interface NakymaProps {
  /** Koko päiväkirja IndexedDB:stä; päivittyy itsestään jokaisen tallennuksen ja synkronoinnin jälkeen. */
  data: Dataset;
  /** Lyhyt ilmoitus alareunaan (6 s, toiminnon kanssa 12 s). */
  notify: (text: string, action?: IlmoitusToiminto) => void;
  /** Ajaa tallennuksen; virhe näkyy kuoren virherivillä suomeksi (storageError). */
  run: (f: () => Promise<void>) => Promise<void>;
}

/**
 * Yläpalkin Tänään-linkkiä napautettiin Tänään-sivulla. Kuvapolku (KuvaLuonnos) kuuntelee tätä ja palaa sivun alkuun
 * samaa reittiä kuin oma "Tänään"-linkkinsä, eli kysyy ennen kuin hylkää tarkistamattoman luonnoksen.
 */
export const TANAAN_ALKUUN = "ravintopolku:tanaan-alkuun";

/**
 * Päivitys lataa sivun uudelleen. Kesken oleva kuvan tulkinta tai luonnos ([data-keskenerainen], myös piilossa
 * toisen sivun alla) ja avoin lomake-ikkuna (.modal) hävisivät, joten niistä kerrotaan eikä päivitetä.
 */
export function paivitysEste(
  juuri: Pick<ParentNode, "querySelector">,
): string | null {
  if (juuri.querySelector("[data-keskenerainen]"))
    return "Kuvan luonnos on kesken. Tallenna tai hylkää se ennen päivitystä.";
  if (juuri.querySelector(".modal"))
    return "Tallenna tai sulje avoin lomake ennen päivitystä.";
  return null;
}

/** Ilmari Hub on saman isännän portissa 443, joten osoitteessa ei ole porttia. */
export function hubOsoite(isanta: string): string {
  return `https://${isanta}/hub`;
}

const kello = new Intl.DateTimeFormat("fi-FI", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const paiva = new Intl.DateTimeFormat("fi-FI", {
  timeZone: TIMEZONE,
  day: "numeric",
  month: "numeric",
});

/** Alapalkin yksi rivi: tallennus on aina laitteella, synkronointi kertoo ajan tai syyn. */
export function tallennusRivi(
  tulos: Tulos | null,
  viimeksi: string | null,
  nyt = new Date(),
): string {
  switch (tulos?.tila) {
    case "ei-palvelinta":
      return "Tallennettu laitteelle · palvelimeen ei yhteyttä";
    case "vahvista-poistot":
      return `Tallennettu laitteelle · ${tulos.poistoja} poistoa odottaa vahvistusta Asetuksissa`;
    case "virhe":
      return "Tallennettu laitteelle · synkronointi epäonnistui";
  }
  const aika = viimeksi ? new Date(viimeksi) : null;
  if (!aika || Number.isNaN(aika.getTime())) return "Tallennettu laitteelle";
  const pvm = localDay(aika) === localDay(nyt) ? "" : paiva.format(aika) + " ";
  return `Tallennettu · synkronoitu ${pvm}klo ${kello.format(aika)}`;
}
