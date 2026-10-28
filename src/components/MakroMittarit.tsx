import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { labels, type Goal } from "../domain/model";
import { formatNumber, type Totals } from "../domain/nutrition";
import {
  meterKeys,
  meterReading,
  meterUnit,
  type MeterKey,
  type MeterReading,
} from "./makromittarit";
// Day meters for energy, protein, carbs and fat: consumed, goal and remaining.
// A partial sum is always marked; an unknown value is never shown as zero.
export function MakroMittarit({
  totals,
  goal,
}: {
  totals: Totals;
  goal: Goal | undefined;
}) {
  return (
    <section className="card meters-card" aria-labelledby="meters-heading">
      <h2 id="meters-heading">Päivän saanti</h2>
      <div className="meters">
        {meterKeys.map((k) => (
          <Meter
            key={k}
            k={k}
            r={meterReading(totals[k], goal?.nutrients[k])}
          />
        ))}
      </div>
    </section>
  );
}
function Meter({ k, r }: { k: MeterKey; r: MeterReading }) {
  const unit = meterUnit(k);
  const label = labels[k];
  const flag =
    r.consumed === null && r.missing > 0
      ? "ei tietoa"
      : r.partial
        ? "osittainen"
        : null;
  const rest =
    r.goal === null
      ? "ei tavoitetta"
      : r.consumed === null
        ? r.empty
          ? "ei kirjauksia"
          : "summa ei tiedossa"
        : r.over! > 0
          ? `yli ${formatNumber(r.over, 0)} ${unit}`
          : `jäljellä ${r.partial ? "enint. " : ""}${formatNumber(r.remaining, 0)} ${unit}`;
  const over = r.over !== null && r.over > 0;
  const valueText = [
    r.consumed === null
      ? `${label}: ei tiedossa`
      : `${label}: ${formatNumber(r.consumed, 0)} ${unit}`,
    r.goal === null
      ? "ei tavoitetta"
      : `tavoite ${formatNumber(r.goal, 0)} ${unit}`,
    r.goal !== null && r.consumed !== null ? rest : null,
    flag === "osittainen" ? "osittainen summa" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className={"meter " + k + (over ? " over" : "")}>
      <div className="meter-head">
        <span className="meter-label">
          <span className={"nutrient-dot " + k} aria-hidden="true" />
          {label}
        </span>
        {flag && (
          <span className="meter-flag">
            <AlertTriangle size={13} aria-hidden="true" /> {flag}
          </span>
        )}
      </div>
      <div className="meter-numbers">
        <strong className="meter-value">
          {r.partial && r.consumed !== null && (
            <span className="meter-approx" title="vähintään">
              ≥
            </span>
          )}
          {formatNumber(r.consumed, 0)}
          <span className="meter-goal">
            {r.goal === null
              ? ` ${unit}`
              : ` / ${formatNumber(r.goal, 0)} ${unit}`}
          </span>
        </strong>
        <span className={"meter-rest" + (over ? " over" : "")}>
          {over && <ArrowUpRight size={14} aria-hidden="true" />}
          {rest}
        </span>
      </div>
      {r.goal === null || r.consumed === null ? (
        <div className="meter-track nogoal" aria-hidden="true" />
      ) : (
        <div
          className="meter-track"
          role="meter"
          aria-label={`${label} suhteessa päivän tavoitteeseen`}
          aria-valuemin={0}
          aria-valuemax={r.goal}
          aria-valuenow={Math.min(r.consumed, r.goal)}
          aria-valuetext={valueText}
        >
          <span className="meter-fill" style={{ width: `${r.percent}%` }} />
        </div>
      )}
    </div>
  );
}
