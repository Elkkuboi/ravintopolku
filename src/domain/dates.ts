import { TIMEZONE, daySchema } from "./model";
export function localDay(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function localTime(date = new Date()): string {
  return new Intl.DateTimeFormat("fi-FI", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(".", ":");
}
export function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dayDistance = (a: string, b: string) =>
  (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000;
export function dayRange(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));
}
export function displayDay(day: string): string {
  return new Intl.DateTimeFormat("fi-FI", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(day + "T12:00:00Z"));
}
// Search UTC candidates for a Helsinki wall time. DST gaps are rejected; overlaps use the first occurrence.
export function wallTimestamp(day: string, time: string): string {
  daySchema.parse(day);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Tarkista kellonaika.");
  const center = Date.parse(day + "T" + time + ":00Z");
  for (const offset of [3, 2]) {
    const d = new Date(center - offset * 3600000);
    if (localDay(d) === day && localTime(d) === time) return d.toISOString();
  }
  throw new Error(
    "Tätä kellonaikaa ei ole Helsingissä kesäaikaan siirtymisen vuoksi. Valitse toinen aika.",
  );
}
