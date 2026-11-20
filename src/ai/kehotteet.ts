// Kielimallin ohjeet työaseman palvelimelta (GET /api/kehotteet): tekstit, jotka palvelin antaa mallille, kun kuvasta
// tehdään ateria tai tavoitteista ehdotus. Vain luku. Offline tai virhe: null, ja Asetukset kertoo sen yhdellä rivillä.
import { kehotteetSchema, type Kehote } from "./contracts";

export type { Kehote };

export async function haeKehotteet(
  hae: typeof fetch = fetch,
): Promise<Kehote[] | null> {
  try {
    const r = await hae(import.meta.env.BASE_URL + "api/kehotteet", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!r.ok) return null;
    const tulos = kehotteetSchema.safeParse(await r.json());
    return tulos.success ? tulos.data.kehotteet : null;
  } catch {
    return null;
  }
}
