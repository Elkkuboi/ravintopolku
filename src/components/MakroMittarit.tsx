import { Fragment } from "react";
import { labels, type Goal } from "../domain/model";
import { formatNumber, type Totals } from "../domain/nutrition";
import {
  makroKeys,
  meterReading,
  naytaMittari,
  energiaLuku,
  energiaJaljella,
  makroTeksti,
  type MeterReading,
} from "./makromittarit";
// Päivän energia isona lukuna ja mittarina, makrot neljänä rivinä tavoitetta vasten. Osittainen summa merkitään, eikä
// tuntematonta arvoa näytetä nollana. Reactin style-prop asettaa vain mittarin leveyden (CSP sallii CSSOM:n).
export function MakroMittarit({
  totals,
  goal,
}: {
  totals: Totals;
  goal: Goal | undefined;
}) {
  const energia = meterReading(totals.energy, goal?.nutrients.energy);
  const jaljella = energiaJaljella(energia);
  return (
    <section aria-label="Energia ja makrot">
      <h2 className="label">
        Energia{" "}
        <span className="aside">
          {energia.goal === null
            ? "ei tavoitetta"
            : `tavoite ${formatNumber(energia.goal, 0)} kcal`}
        </span>
      </h2>
      <div className="figure">
        <span className="figure-num">{energiaLuku(energia)}</span>
        {(energia.consumed !== null || energia.empty) && (
          <span className="figure-unit">kcal</span>
        )}
        {jaljella && (
          <span className={"figure-of" + (jaljella.yli ? " yli" : "")}>
            {jaljella.teksti}
          </span>
        )}
      </div>
      <Mittari r={energia} nimi="Energia" />
      <dl className="macros">
        {makroKeys.map((k) => {
          const r = meterReading(totals[k], goal?.nutrients[k]);
          return (
            <Fragment key={k}>
              <dt>{labels[k]}</dt>
              <Mittari r={r} nimi={labels[k]} ohut />
              <dd
                className={
                  r.consumed === null && !r.empty ? "muted" : undefined
                }
              >
                {makroTeksti(r)}
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
  nimi,
  ohut = false,
}: {
  r: MeterReading;
  nimi: string;
  ohut?: boolean;
}) {
  if (!naytaMittari(r)) return <div className="none" aria-hidden="true" />;
  const yli = r.over !== null && r.over > 0;
  return (
    <div
      className={
        "meter" + (ohut ? " meter--thin" : "") + (yli ? " meter--over" : "")
      }
      role="meter"
      aria-label={`${nimi} tavoitteesta`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(r.percent)}
    >
      <span style={{ width: `${r.percent}%` }} />
    </div>
  );
}
