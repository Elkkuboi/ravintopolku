// Kevyet SVG-kuvaajat Hubin tyylillä: viiva (paino) ja pylväät (energia, makrot). Laskenta on tiedostossa asteikko.ts;
// värit tulevat vain CSS-muuttujista (style.css: .chart .grid .axis .line .target .bar .pt, kehitys.css: .osittainen).
import { useLayoutEffect, useRef, useState } from "react";
import { formatNumber } from "../domain/nutrition";
import {
  alue,
  asteikko,
  palkki,
  tavoiteTekstiY,
  tekstinVara,
  xPaikka,
  yPaikka,
  type Alue,
  type Asteikko,
} from "./asteikko";
import "../tyylit/kehitys.css"; // .osittainen (ontto pylväs) kulkee kuvaajan mukana myös Kehityksen ulkopuolelle

/** Kuvaajan leveys CSS-pikseleinä: viewBox seuraa sitä, joten teksti pysyy 11 px:nä joka näytöllä. */
function useLeveys() {
  const ref = useRef<SVGSVGElement>(null);
  const [leveys, setLeveys] = useState(360);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mittaa = () => {
      const l = Math.round(el.getBoundingClientRect().width);
      if (l > 0) setLeveys(l);
    };
    mittaa();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mittaa);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, leveys] as const;
}

interface Pohja {
  /** Jakson päivien x-akselin tekstit: ensimmäinen ja viimeinen näytetään. */
  alku: string;
  loppu: string;
  kuvaus: string;
}

function Ruudukko({
  a,
  al,
  korkeus,
  tekstit,
  alku,
  loppu,
  nollaton,
}: {
  a: Asteikko;
  al: Alue;
  korkeus: number;
  tekstit: string[];
  alku: string;
  loppu: string;
  /** Pylväät alkavat nollasta, joten nollaa ei kirjoiteta akselille. */
  nollaton?: boolean;
}) {
  return (
    <>
      {a.merkit.slice(1).map((m) => {
        const y = yPaikka(m, a, al);
        return (
          <line key={m} className="grid" x1={al.x0} y1={y} x2={al.x1} y2={y} />
        );
      })}
      <line className="axis" x1={al.x0} y1={al.yAla} x2={al.x1} y2={al.yAla} />
      {a.merkit.map((m, i) =>
        nollaton && m === 0 ? null : (
          <text key={m} x={0} y={yPaikka(m, a, al) + 4}>
            {tekstit[i]}
          </text>
        ),
      )}
      <text x={al.x0} y={korkeus - 6}>
        {alku}
      </text>
      {loppu !== alku && (
        <text x={al.x1} y={korkeus - 6} textAnchor="end">
          {loppu}
        </text>
      )}
    </>
  );
}

/** Viiva päivittäisistä mittauksista ja vaakasuora tavoiteviiva. Viimeinen mittaus on rengas. */
export function Viivakuvaaja({
  paivia,
  pisteet,
  tavoite,
  tavoiteTeksti,
  desimaalit = 1,
  alku,
  loppu,
  kuvaus,
}: Pohja & {
  paivia: number;
  pisteet: { i: number; v: number }[];
  /** Piirrettävä tavoite tai null. */
  tavoite: number | null;
  tavoiteTeksti: string;
  desimaalit?: number;
}) {
  const [ref, leveys] = useLeveys();
  const korkeus = 170;
  const arvot = pisteet.map((p) => p.v);
  if (tavoite !== null) arvot.push(tavoite);
  const a = arvot.length
    ? asteikko(Math.min(...arvot), Math.max(...arvot), {
        alavara: tekstinVara(korkeus),
      })
    : asteikko(0, 1);
  const tekstit = a.merkit.map((m) => formatNumber(m, desimaalit));
  const al = alue(leveys, korkeus, tekstit);
  const xy = pisteet.map(
    (p) => [xPaikka(p.i, paivia, al), yPaikka(p.v, a, al)] as const,
  );
  const viimeinen = xy.at(-1);
  const yTavoite = tavoite === null ? null : yPaikka(tavoite, a, al);
  return (
    <svg
      ref={ref}
      className="chart"
      viewBox={`0 0 ${leveys} ${korkeus}`}
      role="img"
      aria-label={kuvaus}
    >
      <Ruudukko
        a={a}
        al={al}
        korkeus={korkeus}
        tekstit={tekstit}
        alku={alku}
        loppu={loppu}
      />
      {yTavoite !== null && (
        <>
          <line
            className="target"
            x1={al.x0}
            y1={yTavoite}
            x2={al.x1}
            y2={yTavoite}
          />
          <text
            x={al.x1}
            y={tavoiteTekstiY(yTavoite, viimeinen?.[1] ?? null, al)}
            textAnchor="end"
          >
            {tavoiteTeksti}
          </text>
        </>
      )}
      {xy.length > 1 && (
        <polyline
          className="line"
          points={xy.map(([x, y]) => `${r(x)},${r(y)}`).join(" ")}
        />
      )}
      {viimeinen && (
        <circle className="pt" cx={viimeinen[0]} cy={viimeinen[1]} r={3.5} />
      )}
    </svg>
  );
}

/** Pylväs päivää (tai viikkoa) kohden nollasta alkaen. Puuttuva arvo on rako; osittainen summa on ontto pylväs. */
export function Pylvaskuvaaja({
  nimet,
  arvot,
  tavoite,
  yksikko,
  desimaalit = 0,
  alku,
  loppu,
  kuvaus,
  huomautus,
  korkeus = 150,
}: Pohja & {
  /** Pylvään nimi vihjetekstiin, esim. "18.11." tai "3.11.–9.11. keskiarvo". */
  nimet: string[];
  arvot: { value: number | null; partial: boolean }[];
  /** Lyhyt teksti kuvaajan vasempaan yläkulmaan, esim. "viikkokeskiarvot". */
  huomautus?: string;
  tavoite: number | null;
  yksikko: string;
  desimaalit?: number;
  korkeus?: number;
}) {
  const [ref, leveys] = useLeveys();
  const tunnetut = arvot.flatMap((p) => (p.value === null ? [] : [p.value]));
  const a = asteikko(0, Math.max(0, tavoite ?? 0, ...tunnetut), {
    nollasta: true,
  });
  const tekstit = a.merkit.map((m) => formatNumber(m, desimaalit));
  const al = alue(leveys, korkeus, tekstit);
  const n = arvot.length;
  return (
    <svg
      ref={ref}
      className="chart"
      viewBox={`0 0 ${leveys} ${korkeus}`}
      role="img"
      aria-label={kuvaus}
    >
      <Ruudukko
        a={a}
        al={al}
        korkeus={korkeus}
        tekstit={tekstit}
        alku={alku}
        loppu={loppu}
        nollaton
      />
      {huomautus && (
        <text x={al.x0} y={10}>
          {huomautus}
        </text>
      )}
      {tavoite !== null && (
        <line
          className="target"
          x1={al.x0}
          y1={yPaikka(tavoite, a, al)}
          x2={al.x1}
          y2={yPaikka(tavoite, a, al)}
        />
      )}
      <g className="bar">
        {arvot.map((p, i) => {
          if (p.value === null) return null;
          const { x, w } = palkki(i, n, al);
          const y = yPaikka(p.value, a, al);
          return (
            <rect
              key={i}
              className={p.partial ? "osittainen" : undefined}
              x={r(x)}
              y={r(y)}
              width={r(w)}
              height={r(al.yAla - y)}
            >
              <title>
                {`${nimet[i]} ${p.partial ? "vähintään " : ""}${formatNumber(p.value, desimaalit)} ${yksikko}`}
              </title>
            </rect>
          );
        })}
      </g>
    </svg>
  );
}

const r = (n: number) => Math.round(n * 10) / 10;
