// Ilmarin aterialuonnokset työaseman palvelimelta (aiops ADR-0026).
//
// Palvelin lukee Ilmarin pudottamat tiedostot ja tarjoilee ne samasta alkuperästä reitillä /api/luonnokset. Tunnistus on
// Tailscale-identiteetti, joten Node-palvelimen salasanaistuntoa ei tarvita. Ilman palvelinta (404) laatikko on poissa
// käytöstä ja päiväkirja toimii kuten ennenkin.
import { luonnoksetSchema, type Luonnos } from "./contracts";

export type LuonnosTulos =
  | { tila: "ok"; luonnokset: Luonnos[] }
  | { tila: "ei-palvelinta" }
  | { tila: "virhe"; viesti: string };

export async function haeLuonnokset(hae: typeof fetch = fetch): Promise<LuonnosTulos> {
  let r: Response;
  try {
    r = await hae("/api/luonnokset", { credentials: "same-origin" });
  } catch {
    return { tila: "virhe", viesti: "Työaseman palvelimeen ei saada yhteyttä." };
  }
  if (r.status === 404) return { tila: "ei-palvelinta" };
  if (!r.ok) return { tila: "virhe", viesti: `palvelin vastasi ${r.status}` };
  const tulos = luonnoksetSchema.safeParse(await r.json().catch(() => null));
  if (!tulos.success) return { tila: "virhe", viesti: "palvelimen vastaus ei kelpaa" };
  return { tila: "ok", luonnokset: tulos.data.luonnokset };
}

/** Merkitsee luonnoksen käsitellyksi palvelimella. Heittää virheen, jos kuittaus ei onnistunut. */
export async function poistaLuonnos(id: number, hae: typeof fetch = fetch): Promise<void> {
  let r: Response;
  try {
    r = await hae(`/api/luonnokset/${encodeURIComponent(String(id))}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Työaseman palvelimeen ei saada yhteyttä.");
  }
  if (r.status === 404) throw new Error("Luonnosta ei enää ole palvelimen laatikossa.");
  if (!r.ok) throw new Error(`Kuittaus epäonnistui: palvelin vastasi ${r.status}.`);
}
