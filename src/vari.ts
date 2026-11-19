// Väriyhdistelmä tulee Ilmari Hubista. Hubin eväste on HttpOnly, joten vain palvelin näkee sen: GET /api/ulkoasu
// palauttaa yhden neljästä arvosta. public/vari.js asettaa viimeksi tunnetun värin ennen ensimmäistä piirtoa; tämä
// moduuli päivittää sen käynnistyksessä ja aina, kun sivu palaa näkyviin. Offline tai virhe: edellinen väri jää.
export const VARIT = ["paperi", "liitu", "terminaali", "fosfori"] as const;
export type Vari = (typeof VARIT)[number];
export const VARI_AVAIN = "ravintopolku-vari";
export const TAUSTA_AVAIN = "ravintopolku-tausta";

export function normalisoiVari(arvo: unknown): Vari {
  return VARIT.find((v) => v === arvo) ?? "paperi";
}

export const tumma = (v: Vari) => v === "terminaali" || v === "fosfori";

/** Palvelimen väri tai null, jos sitä ei saatu (offline, vanha palvelin, virhe). */
export async function haeVari(hae: typeof fetch = fetch): Promise<Vari | null> {
  try {
    const r = await hae(import.meta.env.BASE_URL + "api/ulkoasu", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!r.ok) return null;
    const vastaus: unknown = await r.json();
    return normalisoiVari((vastaus as { vari?: unknown } | null)?.vari);
  } catch {
    return null;
  }
}

/** Asettaa värin sivulle ja muistaa sen seuraavaa käynnistystä varten (public/vari.js). */
export function asetaVari(v: Vari, juuri = document.documentElement): void {
  juuri.dataset.vari = v;
  const doc = juuri.ownerDocument;
  doc
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", tumma(v) ? "dark" : "light");
  // Tilarivin väri on sivun tausta; arvo luetaan tyylistä, jotta värit ovat vain style.css:n väriyhdistelmissä.
  const tausta = getComputedStyle(juuri).getPropertyValue("--paper").trim();
  if (tausta)
    doc
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", tausta);
  try {
    localStorage.setItem(VARI_AVAIN, v);
    if (tausta) localStorage.setItem(TAUSTA_AVAIN, tausta);
  } catch {
    // Tallennus estetty (yksityinen tila): väri haetaan seuraavallakin kerralla palvelimelta.
  }
}

export function kaynnistaVari(): void {
  const paivita = () =>
    void haeVari().then((v) => {
      if (v) asetaVari(v);
    });
  paivita();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") paivita();
  });
}
