// Synkronointi työaseman Ravintopolku-palvelimen kanssa (aiops ADR-0016).
//
// Sovellus vertaa nykyistä tilaa viimeksi synkronoituun pohjaan (synkPohja) ja lähettää lisäykset, muutokset ja
// poistot. Palvelin antaa järjestyksen: viimeisin sille saapunut voittaa, myös saman päivän merkinnöissä, ja poistot
// säilyvät. Laitteen kelloa ei käytetä. Valokuvat eivät synkronoidu (ADR-0016). Ilman palvelinta sovellus toimii
// kuten ennenkin.
import { db as oletusDb, type DiaryDB } from "./db";

export const SYNKATTAVAT = [
  "profiles", "goals", "foods", "meals", "templates", "weights", "lifestyles", "days", "settings",
] as const;
export type Taulu = (typeof SYNKATTAVAT)[number];
const LUONNOLLISET: Partial<Record<Taulu, string>> = {
  goals: "effectiveDate", weights: "date", lifestyles: "date", days: "date",
};
const ERA = 500;
const SYNK_VERSIO = "single-diary-1";
export const POISTOJEN_RAJA = 25;

type Data = Record<string, unknown> & { id: string };
export interface Muutos { taulu: Taulu; id: string; data: Data | null; poistettu: boolean }
export interface EtaMuutos extends Muutos { seq: number }
export type Tulos =
  | { tila: "ok"; lahetetty: number; vastaanotettu: number; seq: number }
  | { tila: "ei-palvelinta" }
  | { tila: "vahvista-poistot"; poistoja: number }
  | { tila: "virhe"; viesti: string };

export function vakaa(arvo: unknown): string {
  if (Array.isArray(arvo)) return "[" + arvo.map(vakaa).join(",") + "]";
  if (arvo && typeof arvo === "object")
    return "{" + Object.keys(arvo).sort()
      .filter((k) => (arvo as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + vakaa((arvo as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(arvo ?? null);
}

function yhdellePaivakirjalle(tietue: Data): Data {
  const { profiiliId: _profileId, ...kirjaus } = tietue;
  return kirjaus;
}

export async function paikallisetMuutokset(database: DiaryDB = oletusDb): Promise<Muutos[]> {
  const pohja = new Map<string, string>();
  for (const r of await database.table("synkPohja").toArray()) {
    pohja.set(r.taulu + "\u0000" + r.id, vakaa(yhdellePaivakirjalle(JSON.parse(r.json))));
  }
  const muutokset: Muutos[] = [];
  for (const taulu of SYNKATTAVAT) {
    const nahdyt = new Set<string>();
    for (const tietue of (await database.table(taulu).toArray()) as Data[]) {
      const avain = taulu + "\u0000" + tietue.id;
      nahdyt.add(avain);
      const data = yhdellePaivakirjalle(tietue);
      if (pohja.get(avain) !== vakaa(data)) muutokset.push({ taulu, id: tietue.id, data, poistettu: false });
    }
    for (const avain of pohja.keys())
      if (avain.startsWith(taulu + "\u0000") && !nahdyt.has(avain))
        muutokset.push({ taulu, id: avain.slice(taulu.length + 1), data: null, poistettu: true });
  }
  return muutokset;
}

async function paivitaPohja(database: DiaryDB, muutokset: Muutos[]) {
  const pohja = database.table("synkPohja");
  for (const m of muutokset) {
    if (m.poistettu) await pohja.delete([m.taulu, m.id]);
    else await pohja.put({ taulu: m.taulu, id: m.id, json: vakaa(m.data) });
  }
}

export async function sovellaEtamuutokset(muutokset: EtaMuutos[], seq: number, database: DiaryDB = oletusDb) {
  const taulut = [...SYNKATTAVAT.map((t) => database.table(t)), database.table("synkPohja"), database.table("synkTila")];
  await database.transaction("rw", taulut, async () => {
    for (const m of [...muutokset].sort((a, b) => a.seq - b.seq)) {
      if (!SYNKATTAVAT.includes(m.taulu)) continue;
      const taulu = database.table(m.taulu);
      if (m.poistettu || !m.data) {
        await taulu.delete(m.id);
      } else {
        const avain = LUONNOLLISET[m.taulu];
        if (avain) {  // sama päivä toisella tunnisteella: palvelimen järjestys voittaa
          const vanhat = await taulu.where(avain).equals(m.data[avain] as string).toArray();
          for (const v of vanhat as Data[]) if (v.id !== m.id) {
            await taulu.delete(v.id);
            await database.table("synkPohja").delete([m.taulu, v.id]);
          }
        }
        await taulu.put(yhdellePaivakirjalle(m.data));
      }
    }
    await paivitaPohja(database, muutokset);
    await database.table("synkTila").put({ avain: "seq", arvo: seq });
    await database.table("synkTila").put({ avain: "viimeksi", arvo: new Date().toISOString() });
  });
}

export async function synkTila(database: DiaryDB = oletusDb): Promise<{ seq: number; viimeksi: string | null }> {
  const t = database.table("synkTila");
  return { seq: (await t.get("seq"))?.arvo ?? 0, viimeksi: (await t.get("viimeksi"))?.arvo ?? null };
}

export async function synkronoi(
  database: DiaryDB = oletusDb,
  hae: typeof fetch = fetch,
  sallipoistot = false,
): Promise<Tulos> {
  try {
    const muutokset = await paikallisetMuutokset(database);
    const pohjanKoko = await database.table("synkPohja").count();
    const poistoja = muutokset.filter((m) => m.poistettu).length;
    if (!sallipoistot && poistoja > 0 && (poistoja > POISTOJEN_RAJA || poistoja > pohjanKoko / 2))
      return { tila: "vahvista-poistot", poistoja };
    let { seq } = await synkTila(database);
    let vastaanotettu = 0;
    // Sivuilla siirretään muutoksia, mutta enintään 20 sivua kerrallaan: loput lähtevät seuraavalla synkronoinnilla.
    for (let i = 0, sivut = 0; i === 0 || (i < muutokset.length && sivut < 20); i += ERA, sivut++) {
      const era = muutokset.slice(i, i + ERA);
      const r = await hae("/api/synk", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Ravintopolku-Sync": SYNK_VERSIO },
        body: JSON.stringify({ jalkeen: seq, muutokset: era }),
      });
      if (r.status === 404) return { tila: "ei-palvelinta" };
      if (!r.ok) return { tila: "virhe", viesti: `palvelin vastasi ${r.status}` };
      const vastaus = await r.json();
      await paivitaPohja(database, era);
      await sovellaEtamuutokset(vastaus.muutokset, vastaus.lisaa ? (vastaus.muutokset.at(-1)?.seq ?? seq) : vastaus.seq, database);
      vastaanotettu += vastaus.muutokset.length;
      seq = (await synkTila(database)).seq;
      let lisaa = vastaus.lisaa;
      while (lisaa) {
        const s = await hae(`/api/synk?jalkeen=${seq}`, { credentials: "same-origin" });
        if (!s.ok) return { tila: "virhe", viesti: `palvelin vastasi ${s.status}` };
        const sivu = await s.json();
        await sovellaEtamuutokset(sivu.muutokset, sivu.lisaa ? (sivu.muutokset.at(-1)?.seq ?? seq) : sivu.seq, database);
        vastaanotettu += sivu.muutokset.length;
        seq = (await synkTila(database)).seq;
        lisaa = sivu.lisaa;
      }
    }
    return { tila: "ok", lahetetty: muutokset.length, vastaanotettu, seq };
  } catch (e) {
    if (e instanceof TypeError) return { tila: "ei-palvelinta" };  // verkko- tai yhteysvirhe
    return { tila: "virhe", viesti: e instanceof Error ? e.message : String(e) };
  }
}

// Viimeisin tulos alapalkin tallennusriville: tapahtuma kertoo uudesta tuloksesta, tila luetaan funktiolla.
export const SYNK_TAPAHTUMA = "ravintopolku-synk";
let viimeisin: Tulos | null = null;
export const viimeisinTulos = (): Tulos | null => viimeisin;
export function kirjaaTulos(tulos: Tulos): Tulos {
  viimeisin = tulos;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNK_TAPAHTUMA));
  return tulos;
}

// Yksi synkronointi kerrallaan: automaattinen ajo ja "Synkronoi nyt" eivät mene päällekkäin.
let kesken: Promise<Tulos> | null = null;
export function synkronoiNyt(sallipoistot = false): Promise<Tulos> {
  if (!kesken) kesken = synkronoi(oletusDb, fetch, sallipoistot).then(kirjaaTulos).finally(() => { kesken = null; });
  return kesken;
}
