import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { type Dataset, keys, labels } from "../domain/model";
import {
  dailySeries,
  weightSeries,
  goalWeight,
  observedMean,
} from "../domain/analytics";
import { formatNumber } from "../domain/nutrition";
import { localDay } from "../domain/dates";
export function Progress({ data }: { data: Dataset }) {
  const [range, setRange] = useState(30),
    [completeOnly, setCompleteOnly] = useState(false),
    [end, setEnd] = useState(localDay());
  const daily = dailySeries(data, end, range, completeOnly),
    weight = weightSeries(data.weights, end, range).map((w) => ({
      ...w,
      goal: goalWeight(data, w.date),
    }));
  const energyMean = observedMean(
      daily.filter((d) => !d.totals.energy.partial).map((d) => d.energy),
    ),
    proteinMean = observedMean(
      daily.filter((d) => !d.totals.protein.partial).map((d) => d.protein),
    );
  const hasWeight = weight.some((w) => w.weight !== null),
    hasMeals = daily.some((d) => d.energy !== null || d.protein !== null);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PIDEMPI NÄKÖKULMA</p>
          <h1>Kehitys</h1>
          <p className="muted">Yksittäinen päivä on osa kokonaisuutta.</p>
        </div>
      </div>
      <div className="range-controls">
        <div className="segments" aria-label="Aikaväli">
          {[7, 30, 90].map((n) => (
            <button
              key={n}
              className={range === n ? "active" : ""}
              onClick={() => setRange(n)}
              aria-pressed={range === n}
            >
              {n} päivää
            </button>
          ))}
        </div>
        <FieldDate value={end} onChange={setEnd} />
      </div>
      <section className="card chart-card">
        <div className="section-heading">
          <h2>Painon suunta</h2>
          <span className="unit">kg</span>
        </div>
        {hasWeight ? (
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={weight}
                margin={{ top: 15, right: 12, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  minTickGap={28}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(n) => formatNumber(Number(n))}
                />
                <Tooltip
                  labelFormatter={(v) => String(v)}
                  formatter={(v, name) => [
                    formatNumber(v === undefined ? null : Number(v)),
                    name,
                  ]}
                />
                <Line
                  name="Mittaus"
                  dataKey="weight"
                  stroke="#315b43"
                  strokeWidth={0}
                  dot={{
                    r: 4,
                    fill: "#315b43",
                    stroke: "#fff",
                    strokeWidth: 1,
                  }}
                  activeDot={{ r: 6, fill: "#315b43" }}
                  isAnimationActive={false}
                />
                <Line
                  name="7 päivän keskiarvo"
                  dataKey="average"
                  stroke="#6483a0"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  name="Tavoitteen suora"
                  dataKey="goal"
                  stroke="#ad8656"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty text="Kirjaa ensimmäinen painosi nähdäksesi mittauspisteet." />
        )}
        <div className="legend">
          <span>● Mittaus</span>
          <span>━ 7 päivän keskiarvo</span>
          <span>┄ Tavoitteen suora</span>
        </div>
        <p className="small muted">
          Keskiarvo käyttää kyseisen päivän ja kuuden edellisen kalenteripäivän
          olemassa olevia mittauksia. Se näkyy vähintään kolmella mittauksella.
          Tavoitesuora ei ole ennuste.
        </p>
      </section>
      <label className="check filter">
        <input
          type="checkbox"
          checked={completeOnly}
          onChange={(e) => setCompleteOnly(e.target.checked)}
        />{" "}
        Näytä ravintoarvot vain valmiiksi merkityiltä päiviltä
      </label>
      <div className="stats-grid">
        <section className="card chart-card">
          <div className="section-heading">
            <h2>Kirjattu energia</h2>
            <span className="unit">kcal</span>
          </div>
          {hasMeals ? (
            <div className="chart small-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={daily}
                  margin={{ top: 10, right: 5, left: -15, bottom: 0 }}
                >
                  <defs>
                    <pattern
                      id="partial-bars"
                      patternUnits="userSpaceOnUse"
                      width="6"
                      height="6"
                    >
                      <rect width="6" height="6" fill="#93a38e" />
                      <path d="M0 6L6 0" stroke="#315b43" />
                    </pattern>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    minTickGap={28}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(v) => String(v)}
                    formatter={(v) => [
                      formatNumber(v === undefined ? null : Number(v), 0),
                      "Kirjattu energia",
                    ]}
                  />
                  <Bar
                    dataKey="energy"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  >
                    {daily.map((d) => (
                      <Cell
                        key={d.date}
                        fill={
                          d.partial
                            ? "url(#partial-bars)"
                            : d.complete
                              ? "#315b43"
                              : "#93a38e"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text="Energiatiedot näkyvät ruokakirjausten jälkeen." />
          )}
          <div className="legend">
            <span>■ Valmis päivä</span>
            <span>□ Keskeneräinen</span>
            <span>▨ Osittaiset ravintoarvot</span>
          </div>
          <p className="small">
            Keskiarvo: <strong>{formatNumber(energyMean.value, 0)} kcal</strong>{" "}
            · {energyMean.count} kirjattua päivää / {range} päivää
          </p>
          <p className="small muted">
            Keskiarvoon otetaan vain päivät, joiden kaikissa kirjatuissa ruuissa
            on energiatieto. Päivän valmius on käyttäjän merkintä.
          </p>
        </section>
        <section className="card chart-card">
          <div className="section-heading">
            <h2>Proteiinin seuranta</h2>
            <span className="unit">g</span>
          </div>
          {hasMeals ? (
            <div className="chart small-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={daily}
                  margin={{ top: 10, right: 12, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    minTickGap={28}
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(v) => [
                      formatNumber(v === undefined ? null : Number(v)),
                      "Proteiini (g)",
                    ]}
                  />
                  <Line
                    dataKey="protein"
                    stroke="#6483a0"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text="Proteiinin seuranta alkaa ensimmäisestä kirjauksesta." />
          )}
          <p className="small">
            Keskiarvo: <strong>{formatNumber(proteinMean.value)} g</strong> ·{" "}
            {proteinMean.count} kirjattua päivää / {range} päivää
          </p>
          <p className="small muted">
            Osittaiset proteiinitiedot näkyvät taulukossa ja kuvaajassa, mutta
            jäävät keskiarvon ulkopuolelle. Puuttuvia päiviä ei lasketa nollina.
          </p>
        </section>
      </div>
      <section className="card">
        <h2>Päivittäiset havainnot</h2>
        <p className="muted small">
          * Osittainen summa. — Puuttuva havainto. Taulukko kertoo myös
          keskiarvon mittausmäärän.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Päivä</th>
                <th>Kirjaukset</th>
                {keys.map((k) => (
                  <th key={k}>
                    {labels[k]} ({k === "energy" ? "kcal" : "g"})
                  </th>
                ))}
                <th>Paino (kg)</th>
                <th>7 pv ka. (kg)</th>
                <th>Mittauksia / 7 pv</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => {
                const w = weight.find((w) => w.date === d.date)!;
                return (
                  <tr key={d.date}>
                    <th>{shortDate(d.date)}</th>
                    <td>
                      {d.complete
                        ? "Valmis"
                        : d.recorded
                          ? "Keskeneräinen"
                          : "Ei kirjauksia"}
                    </td>
                    {keys.map((k) => (
                      <td key={k}>
                        {completeOnly && !d.complete
                          ? "—"
                          : formatNumber(
                              d.totals[k].value,
                              k === "energy" ? 0 : 1,
                            )}
                        {d.totals[k].partial && (!completeOnly || d.complete)
                          ? " *"
                          : ""}
                      </td>
                    ))}
                    <td>{formatNumber(w.weight)}</td>
                    <td>{formatNumber(w.average, 2)}</td>
                    <td>{w.measurements}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function shortDate(s: string) {
  return `${Number(s.slice(8))}.${Number(s.slice(5, 7))}.`;
}
function Empty({ text }: { text: string }) {
  return <p className="chart-empty">{text}</p>;
}
function FieldDate({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <label className="date-filter">
      Jakso päättyy
      <input
        type="date"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    </label>
  );
}
