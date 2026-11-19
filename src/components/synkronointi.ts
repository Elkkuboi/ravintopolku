// Synkronoinnin tila Asetusten Tiedot-osiossa (aiops ADR-0016): otsikon sivurivi ja viimeisin tulos. Komponentti on
// tiedostossa SyncPanel.tsx.
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { TIMEZONE } from "../domain/model";
import { localDay } from "../domain/dates";
import {
  SYNK_TAPAHTUMA,
  synkTila,
  viimeisinTulos,
  type Tulos,
} from "../data/sync";

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

/** Tiedot-otsikon sivurivi: viimeisin synkronointi tai syy, miksi se ei onnistunut. */
export function synkRivi(
  tulos: Tulos | null,
  viimeksi: string | null,
  nyt = new Date(),
): string {
  switch (tulos?.tila) {
    case "ei-palvelinta":
      return "palvelimeen ei yhteyttä";
    case "vahvista-poistot":
      return "synkronointi odottaa";
    case "virhe":
      return "synkronointi epäonnistui";
  }
  const aika = viimeksi ? new Date(viimeksi) : null;
  if (!aika || Number.isNaN(aika.getTime())) return "ei synkronoitu";
  const pvm = localDay(aika) === localDay(nyt) ? "" : paiva.format(aika) + " ";
  return `synkronoitu ${pvm}klo ${kello.format(aika)}`;
}

/** Viimeisin tulos (myös automaattisesta ajosta) ja viimeisimmän onnistuneen synkronoinnin aika. */
export function useSynk(): { tulos: Tulos | null; viimeksi: string | null } {
  const viimeksi = useLiveQuery(
    async () => (await synkTila()).viimeksi,
    [],
    null,
  );
  const [tulos, setTulos] = useState(viimeisinTulos);
  useEffect(() => {
    const kuuntelija = () => setTulos(viimeisinTulos());
    window.addEventListener(SYNK_TAPAHTUMA, kuuntelija);
    return () => window.removeEventListener(SYNK_TAPAHTUMA, kuuntelija);
  }, []);
  return { tulos, viimeksi };
}
