// Yläpalkin sivut puhtaana tietona, jotta rakenteen voi tarkistaa yksikkötestissä ilman selainta. Sivu on osoitteen
// risuaidassa (#kehitys, #asetukset), joten selaimen paluu toimii ja Hubista voi linkittää suoraan sivulle.
export const tabs = [
  { id: "today", label: "Tänään", hash: "" },
  { id: "progress", label: "Kehitys", hash: "kehitys" },
  { id: "settings", label: "Asetukset", hash: "asetukset" },
] as const;

export type Tab = (typeof tabs)[number]["id"];

/** Tuntematon tai tyhjä risuaita on Tänään. */
export function tabFromHash(hash: string): Tab {
  const nimi = hash.replace(/^#/, "");
  return tabs.find((t) => t.hash !== "" && t.hash === nimi)?.id ?? "today";
}
