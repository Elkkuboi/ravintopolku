// Kehitys: paino, energia ja proteiini valitulta jaksolta, joka päättyy aina tänään. Päivittäiset luvut taitettuna.
import { useMemo, useState } from "react";
import { type NakymaProps } from "../kuori";
import { localDay } from "../domain/dates";
import { formatNumber } from "../domain/nutrition";
import { Pylvaskuvaaja, Viivakuvaaja } from "../components/Kuvaaja";
import {
  elatiivi,
  jaksonKeskiarvo,
  jaksonPituus,
  jaksoTeksti,
  jaksot,
  macroCharts,
  macroSummary,
  paivaPylvaat,
  painoKuvaaja,
  paivaTeksti,
  tavoiteLahella,
  tavoitePaivat,
  viikkoPylvaat,
  VIIKOITTAIN_YLI,
  type Jakso,
  type MacroChart,
  type MacroPoint,
} from "../components/makrokuvaajat";
import "../tyylit/kehitys.css";

export default function Kehitys({ data }: NakymaProps) {
  const [jakso, setJakso] = useState<Jakso>(30);
  const end = localDay();
  const paivia = jaksonPituus(data, end, jakso);
  const { paino, makrot } = useMemo(
    () => ({
      paino: painoKuvaaja(data, end, paivia),
      makrot: macroCharts(data, end, paivia),
    }),
    [data, end, paivia],
  );
  const [energia, proteiini] = makrot;
  const viikoittain = paivia > VIIKOITTAIN_YLI;
  const pylvaat = viikoittain
    ? viikkoPylvaat(data, end, energia.points)
    : paivaPylvaat(energia.points);
  const alku = paivaTeksti(paino.paivat[0], end),
    loppu = paivaTeksti(end, end);
  const tavoiteKuvassa =
    paino.tavoite !== null &&
    tavoiteLahella(
      paino.pisteet.map((p) => p.kg),
      paino.tavoite,
    );
  const painoAside = [
    paino.yhteenveto,
    paino.tavoite !== null && !tavoiteKuvassa
      ? `tavoite ${formatNumber(paino.tavoite)} kg`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <section>
        <h2 className="label">
          Paino {painoAside && <span className="aside">{painoAside}</span>}
        </h2>
        <div className="range" role="group" aria-label="Jakso">
          {jaksot.map((j) => (
            <button
              key={j}
              type="button"
              aria-pressed={jakso === j}
              onClick={() => setJakso(j)}
            >
              {jaksoTeksti(j)}
            </button>
          ))}
        </div>
        {paino.pisteet.length ? (
          <Viivakuvaaja
            paivia={paivia}
            pisteet={paino.pisteet.map((p) => ({ i: p.i, v: p.kg }))}
            tavoite={tavoiteKuvassa ? paino.tavoite : null}
            tavoiteTeksti={`tavoite ${formatNumber(paino.tavoite)}`}
            alku={alku}
            loppu={loppu}
            kuvaus={`Paino ${alku}–${loppu}${paino.yhteenveto ? ": " + paino.yhteenveto : ""}`}
          />
        ) : (
          <p className="empty">Ei punnituksia tällä jaksolla.</p>
        )}
      </section>
      <section>
        <h2 className="label">
          Energia <Yhteenveto data={data} end={end} c={energia} />
        </h2>
        {energia.hasData ? (
          <Pylvaskuvaaja
            nimet={pylvaat.map((p) => p.nimi)}
            arvot={pylvaat}
            tavoite={energia.goal}
            yksikko="kcal"
            alku={alku}
            loppu={loppu}
            huomautus={viikoittain ? "viikkokeskiarvot" : undefined}
            kuvaus={macroSummary(energia)}
          />
        ) : (
          <p className="empty">Ei kirjauksia tällä jaksolla.</p>
        )}
      </section>
      <section>
        <h2 className="label">
          Proteiini <Yhteenveto data={data} end={end} c={proteiini} />
        </h2>
        {!proteiini.hasData ? (
          <p className="empty">Ei kirjauksia tällä jaksolla.</p>
        ) : (
          proteiini.goal !== null && (
            <p className="muted">
              {tavoiteLause(
                tavoitePaivat(data, end, proteiini.points, proteiini.goal),
              )}
            </p>
          )
        )}
      </section>
      <Taulukko
        end={end}
        paivat={paino.paivat}
        makrot={makrot}
        paino={new Map(paino.pisteet.map((p) => [p.i, p.kg]))}
      />
    </>
  );
}

/** Otsikon sivuteksti: keskiarvo lopullisista päivistä ja voimassa oleva tavoite. */
function Yhteenveto({
  data,
  end,
  c,
}: {
  data: NakymaProps["data"];
  end: string;
  c: MacroChart;
}) {
  const ka = jaksonKeskiarvo(data, end, c.points).value;
  const osat = [
    ka === null ? null : `keskiarvo ${formatNumber(ka, 0)} ${c.unit}`,
    c.goal === null ? null : `tavoite ${formatNumber(c.goal, 0)} ${c.unit}`,
  ].filter(Boolean);
  return osat.length ? <span className="aside">{osat.join(" · ")}</span> : null;
}

function tavoiteLause({ taytti, paivia }: { taytti: number; paivia: number }) {
  return paivia
    ? `Tavoite täyttyi ${taytti} päivänä ${elatiivi(paivia)}.`
    : "Ei vielä valmiita päiviä.";
}

/** Päivät, joilla on kirjauksia tai punnitus, uusin ensin. Osittainen summa on alaraja (≥). */
function Taulukko({
  end,
  paivat,
  makrot,
  paino,
}: {
  end: string;
  paivat: string[];
  makrot: MacroChart[];
  paino: Map<number, number>;
}) {
  const rivit = paivat
    .map((d, i) => ({
      d,
      arvot: makrot.map((c) => c.points[i]),
      kg: paino.get(i) ?? null,
    }))
    .filter((r) => r.kg !== null || r.arvot.some((p) => p.value !== null))
    .reverse();
  if (!rivit.length) return null;
  return (
    <details className="fold">
      <summary>Päivittäiset luvut</summary>
      <div className="scroll">
        <table className="luvut">
          <thead>
            <tr>
              <th>Päivä</th>
              <th>kcal</th>
              <th>
                <abbr title="proteiini, g">P</abbr>
              </th>
              <th>
                <abbr title="hiilihydraatit, g">H</abbr>
              </th>
              <th>
                <abbr title="rasva, g">R</abbr>
              </th>
              <th>kg</th>
            </tr>
          </thead>
          <tbody>
            {rivit.map((r) => (
              <tr key={r.d}>
                <td>{paivaTeksti(r.d, end)}</td>
                {r.arvot.map((p, i) => (
                  <td key={makrot[i].key}>{luku(p)}</td>
                ))}
                <td>{formatNumber(r.kg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const luku = (p: MacroPoint) =>
  (p.partial && p.value !== null ? "≥" : "") + formatNumber(p.value, 0);
