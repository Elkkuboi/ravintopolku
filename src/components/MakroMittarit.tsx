import { Fragment } from "react";
import { labels, type Goal } from "../domain/model";
import { type Totals } from "../domain/nutrition";
import {
  makroKeys,
  meterReading,
  naytaMittari,
  asteikko,
  energiaLuku,
  energiaJaljella,
  energiaTavoite,
  makroOsat,
  mittariTeksti,
  type Asteikko,
  type MeterReading,
} from "./makromittarit";
// Päivän energia isona lukuna ja mittarina, makrot neljänä rivinä tavoitetta vasten. Tavoite on yksi luku; palkin
// pääty on tavoitealue (päivän hyväksytty vaihtelu, domain/nutrition.ts), ja alueelle osunut luku vihertää. Osittainen
// summa merkitään, eikä tuntematonta arvoa näytetä nollana. Reactin style-prop asettaa vain mittarin osien leveyden
// ja paikan (CSP sallii CSSOM:n).
export function MakroMittarit({
  totals,
  goal,
}: {
  totals: Totals;
  goal: Goal | undefined;
}) {
  const energia = meterReading(totals.energy, goal?.nutrients.energy);
  const alue = asteikko("energy", energia);
  const jaljella = energiaJaljella(energia, alue);
  return (
    <section aria-label="Energia ja makrot">
      <h2 className="label">
        Energia <span className="aside">{energiaTavoite(energia, alue)}</span>
      </h2>
      <div className="figure">
        <span
          className={"figure-num" + (alue?.osuma === "sisalla" ? " osui" : "")}
        >
          {energiaLuku(energia)}
        </span>
        {(energia.consumed !== null || energia.empty) && (
          <span className="figure-unit">kcal</span>
        )}
        {jaljella && (
          <span
            className={
              "figure-of" + (jaljella.luokka ? " " + jaljella.luokka : "")
            }
          >
            {jaljella.teksti}
          </span>
        )}
      </div>
      <Mittari r={energia} a={alue} nimi="Energia" yksikko="kcal" />
      <dl className="macros">
        {makroKeys.map((k) => {
          const r = meterReading(totals[k], goal?.nutrients[k]);
          const a = asteikko(k, r);
          const [syoty, loppu] = makroOsat(r);
          return (
            <Fragment key={k}>
              <dt>{labels[k]}</dt>
              <Mittari r={r} a={a} nimi={labels[k]} yksikko="g" ohut />
              <dd
                className={
                  r.consumed === null && !r.empty ? "muted" : undefined
                }
              >
                {a?.osuma === "sisalla" ? (
                  <span className="osui">{syoty}</span>
                ) : (
                  syoty
                )}
                {loppu}
              </dd>
            </Fragment>
          );
        })}
      </dl>
    </section>
  );
}

function Mittari({
  r,
  a,
  nimi,
  yksikko,
  ohut = false,
}: {
  r: MeterReading;
  a: Asteikko | null;
  nimi: string;
  yksikko: string;
  ohut?: boolean;
}) {
  if (!naytaMittari(r)) return <div className="none" aria-hidden="true" />;
  // Ilman tavoitealuetta (tavoite 0) mittari toimii kuten ennen: täysi tavoitteessa, ylitys varoittaa.
  const taytto = a ? a.taytto : r.percent;
  const yli = a ? a.varoitus : r.over !== null && r.over > 0;
  return (
    <div
      className={
        "meter" + (ohut ? " meter--thin" : "") + (yli ? " meter--over" : "")
      }
      role="meter"
      aria-label={`${nimi} tavoitteesta`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(taytto)}
      aria-valuetext={mittariTeksti(r, a, yksikko)}
    >
      {a && (
        <span className="meter-alue" style={{ width: `${100 - a.alku}%` }} />
      )}
      <span className="meter-taytto" style={{ width: `${taytto}%` }} />
      {a?.osuma === "sisalla" && a.taytto > a.alku && (
        <span
          className="meter-osuma"
          style={{ left: `${a.alku}%`, width: `${a.taytto - a.alku}%` }}
        />
      )}
      {a && a.tavoite !== null && (
        <span className="meter-tavoite" style={{ left: `${a.tavoite}%` }} />
      )}
    </div>
  );
}
