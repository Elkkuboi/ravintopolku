// Neljä makrokuvaajaa (energia, proteiini, hiilihydraatit, rasva) katsotulta päivältä ja kuudelta edeltävältä.
// VÄLIAIKAINEN: Tänään-sivu käyttää tätä vielä; uusi Tänään ei käytä, joten kokoaja poistaa tiedoston yhdistämisen
// jälkeen. Piirto on sama kevyt SVG kuin Kehityksessä, ei rechartsia eikä vanhoja luokkia.
import { type Dataset } from "../domain/model";
import { formatNumber } from "../domain/nutrition";
import { Pylvaskuvaaja } from "./Kuvaaja";
import {
  macroCharts,
  macroDigits,
  macroSummary,
  shortDate,
} from "./makrokuvaajat";

export function MakroKuvaajat({ data, end }: { data: Dataset; end: string }) {
  const charts = macroCharts(data, end);
  const alku = shortDate(charts[0].points[0].date),
    loppu = shortDate(end);
  return (
    <section className="stack">
      {charts.map((c) => (
        <div key={c.key}>
          <h2 className="label">
            {c.label}{" "}
            <span className="aside">
              {c.mean.value === null
                ? "ei tietoa"
                : `keskiarvo ${formatNumber(c.mean.value, macroDigits(c.key))} ${c.unit}`}
            </span>
          </h2>
          {c.hasData ? (
            <Pylvaskuvaaja
              nimet={c.points.map((p) => shortDate(p.date))}
              arvot={c.points}
              tavoite={c.goal}
              yksikko={c.unit}
              desimaalit={macroDigits(c.key)}
              korkeus={120}
              alku={alku}
              loppu={loppu}
              kuvaus={macroSummary(c)}
            />
          ) : (
            <p className="empty">Ei kirjauksia.</p>
          )}
        </div>
      ))}
    </section>
  );
}
