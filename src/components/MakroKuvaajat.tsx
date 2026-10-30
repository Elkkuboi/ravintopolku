import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { type Dataset } from "../domain/model";
import { formatNumber } from "../domain/nutrition";
import {
  chartDays,
  macroCharts,
  macroDigits,
  macroSummary,
  shortDate,
  type MacroChart,
} from "./makrokuvaajat";
import { type MeterKey } from "./makromittarit";
// Same hues as the day meters and the nutrient dots; energy follows the
// theme's green. A hatched bar is a partial sum, an absent bar has no data.
const colors: Record<MeterKey, string> = {
  energy: "var(--green)",
  protein: "#8da1b3",
  carbs: "#c2ac74",
  fat: "#b49c99",
};
const emptyText: Record<MeterKey, string> = {
  energy: "Ei energiatietoja.",
  protein: "Ei proteiinitietoja.",
  carbs: "Ei hiilihydraattitietoja.",
  fat: "Ei rasvatietoja.",
};
// Four macro trend charts on the home screen: energy, protein, carbs and fat
// over the viewed day and the six days before it. Numbers are computed in
// makrokuvaajat.ts; this only draws them.
export function MakroKuvaajat({ data, end }: { data: Dataset; end: string }) {
  const charts = macroCharts(data, end);
  return (
    <section className="card macros-card" aria-labelledby="macros-heading">
      <div className="section-heading">
        <h2 id="macros-heading">Makrot</h2>
        <span className="unit">
          {charts[0].points.length} päivää · kcal ja g
        </span>
      </div>
      <div className="macro-charts">
        {charts.map((c) => (
          <MacroBars key={c.key} c={c} />
        ))}
      </div>
      <p className="small muted macro-note">
        Kirjaukset valitulle päivälle ja sitä kuudelle edeltävälle päivälle.
        Tyhjä kohta ei ole nolla vaan puuttuva havainto, raidoitettu palkki on
        osittainen summa ja jää keskiarvon ulkopuolelle. Katkoviiva on valitun
        päivän ravintoainetavoite.
      </p>
    </section>
  );
}
function MacroBars({ c }: { c: MacroChart }) {
  const color = colors[c.key];
  const pattern = `macro-partial-${c.key}`;
  const digits = macroDigits(c.key);
  return (
    <div className={"macro-chart " + c.key}>
      <div className="macro-chart-head">
        <span className="macro-chart-label">
          <span className={"nutrient-dot " + c.key} aria-hidden="true" />
          {c.label}
        </span>
        <span className="unit">{c.unit}</span>
      </div>
      {c.hasData ? (
        <div
          className="chart macro-mini"
          role="img"
          aria-label={macroSummary(c)}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={c.points}
              margin={{ top: 8, right: 6, left: -18, bottom: 0 }}
            >
              <defs>
                <pattern
                  id={pattern}
                  patternUnits="userSpaceOnUse"
                  width="6"
                  height="6"
                >
                  <rect width="6" height="6" fill={color} fillOpacity={0.22} />
                  <path
                    d="M0 6L6 0"
                    stroke={color}
                    strokeWidth="1.3"
                    fill="none"
                  />
                </pattern>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                interval={1}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                width={46}
                tickCount={3}
                tickFormatter={(n) => formatNumber(Number(n), 0)}
                domain={[
                  0,
                  (dataMax: number) => Math.max(dataMax, c.goal ?? 0),
                ]}
              />
              <Tooltip
                labelFormatter={(v) => shortDate(String(v))}
                formatter={(v) => [
                  formatNumber(v === undefined ? null : Number(v), digits),
                  c.label,
                ]}
              />
              {c.goal !== null && (
                <ReferenceLine
                  y={c.goal}
                  stroke="var(--gold)"
                  strokeDasharray="5 4"
                  strokeWidth={1.4}
                />
              )}
              <Bar
                dataKey="value"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              >
                {c.points.map((p) => (
                  <Cell
                    key={p.date}
                    fill={p.partial ? `url(#${pattern})` : color}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="chart-empty macro-empty">{emptyText[c.key]}</p>
      )}
      <p className="small macro-mean">
        {chartDays} pv keskiarvo{" "}
        <strong>
          {formatNumber(c.mean.value, digits)} {c.unit}
        </strong>{" "}
        · {c.mean.count} päivää / {c.points.length}
      </p>
    </div>
  );
}
