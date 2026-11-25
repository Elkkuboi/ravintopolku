// Kehitys: paino, energia ja proteiini valitulta jaksolta, joka päättyy aina tänään. Treenipäivät näkyvät energian
// kuvaajassa viivana akselin alla ja taulukossa. Päivittäiset luvut taitettuna.
import { useMemo, useState } from "react";
import { type NakymaProps } from "../kuori";
import { localDay } from "../domain/dates";
import { formatNumber, tavoitealue } from "../domain/nutrition";
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
  treeniLause,
  treenipaivat,
  treeniYhteenveto,
  viikkoPylvaat,
  viikkoPylvaina,
  type Jakso,
  type MacroChart,
  type MacroPoint,
} from "../components/makrokuvaajat";
import "../tyylit/kehitys.css";

export default function Kehitys({ data }: NakymaProps) {
  const [jakso, setJakso] = useState<Jakso>(30);
  const end = localDay();
  const paivia = jaksonPituus(data, end, jakso);
  const { paino, makrot, treeni } = useMemo(
    () => ({
      paino: painoKuvaaja(data, end, paivia),
      makrot: macroCharts(data, end, paivia),
      treeni: treenipaivat(data),
    }),
    [data, end, paivia],
  );
  const [energia, proteiini] = makrot;
  const treeniJaksolla = treeniYhteenveto(data, end, energia.points);
  // Sama tavoitealue kuin Tänään-sivun mittarissa: proteiini on "vähintään", alaraja 90 % tavoitteesta.
  const proteiiniAlue = tavoitealue(proteiini.key, proteiini.goal);
  const viikoittain = viikkoPylvaina(paivia);
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
            merkit={
              viikoittain
                ? undefined
                : energia.points.map((p) => treeni.has(p.date))
            }
            kuvaus={macroSummary(energia, treeni)}
          />
        ) : (
          <p className="empty">Ei kirjauksia tällä jaksolla.</p>
        )}
        {treeniJaksolla.treeni > 0 && (
          <p className="muted">
            {energia.hasData && !viikoittain && (
              <span className="treeni-merkki" aria-hidden="true" />
            )}
            {treeniLause(treeniJaksolla)}
          </p>
        )}
      </section>
      <section>
        <h2 className="label">
          Proteiini <Yhteenveto data={data} end={end} c={proteiini} />
        </h2>
        {!proteiini.hasData ? (
          <p className="empty">Ei kirjauksia tällä jaksolla.</p>
        ) : (
          proteiiniAlue && (
            <p className="muted">
              {tavoiteLause(
                tavoitePaivat(data, end, proteiini.points, proteiiniAlue),
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
        treeni={treeni}
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
    ? `Tavoitealueella ${taytti} päivänä ${elatiivi(paivia)}.`
    : "Ei vielä valmiita päiviä.";
}

/** Päivät, joilla on kirjauksia, punnitus tai treeni, uusin ensin. Osittainen summa on alaraja (≥). */
function Taulukko({
  end,
  paivat,
  makrot,
  paino,
  treeni,
}: {
  end: string;
  paivat: string[];
  makrot: MacroChart[];
  paino: Map<number, number>;
  treeni: ReadonlySet<string>;
}) {
  const rivit = paivat
    .map((d, i) => ({
      d,
      arvot: makrot.map((c) => c.points[i]),
      kg: paino.get(i) ?? null,
      treeni: treeni.has(d),
    }))
    .filter(
      (r) => r.kg !== null || r.treeni || r.arvot.some((p) => p.value !== null),
    )
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
              <th>
                <abbr title="treenipäivä">T</abbr>
              </th>
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
                <td>{r.treeni ? "✓" : ""}</td>
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
