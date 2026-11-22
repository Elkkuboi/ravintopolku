// Synkronoinnin asiakaspuoli (aiops ADR-0016). Riippumaton totuus: käsin kirjoitetut muutoslistat ja palvelimen vastaukset.
import { describe, it, expect, afterEach, vi } from "vitest";
import { DiaryDB } from "../src/data/db";
import { id } from "../src/domain/model";
import {
  paikallisetMuutokset, sovellaEtamuutokset, synkronoi, synkTila, vakaa, POISTOJEN_RAJA, type EtaMuutos,
} from "../src/data/sync";

const kannat: DiaryDB[] = [];
const kanta = () => { const d = new DiaryDB("synk-" + id()); kannat.push(d); return d; };
afterEach(async () => { await Promise.all(kannat.splice(0).map((d) => d.delete())); });

const ruoka = (tunniste: string, nimi: string, profiiliId = "p1") =>
  ({ id: tunniste, name: nimi, profiiliId }) as never;
const paino = (tunniste: string, paiva: string, kg: number, profiiliId = "p1") =>
  ({ id: tunniste, date: paiva, kg, profiiliId }) as never;

async function asetaProfiili(d: DiaryDB, profiilit: { id: string; name: string; aktiivinen: boolean; luotu: string }[]) {
  await d.table("profiilit").bulkPut(profiilit);
}

describe("tilannevertailu", () => {
  it("lisäykset, muutokset ja poistot pohjaan verrattuna; kuvat eivät synkronoidu", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" }]);
    await d.table("foods").put(ruoka("f1", "puuro"));
    await d.table("photos").put({ id: "p1", createdAt: "x", updatedAt: "x", blob: new Blob(["k"]) });
    expect(await paikallisetMuutokset(d)).toEqual([
      { taulu: "foods", id: "f1", data: { id: "f1", name: "puuro", profiiliId: "p1" }, poistettu: false }]);
    await d.table("synkPohja").put({ taulu: "foods", id: "f1", json: vakaa({ id: "f1", name: "puuro", profiiliId: "p1" }) });
    expect(await paikallisetMuutokset(d)).toEqual([]);
    await d.table("foods").put(ruoka("f1", "kaurapuuro"));
    expect((await paikallisetMuutokset(d)).map((m) => m.data?.name)).toEqual(["kaurapuuro"]);
    await d.table("foods").delete("f1");
    expect(await paikallisetMuutokset(d)).toEqual([{ taulu: "foods", id: "f1", data: null, poistettu: true }]);
  });

  it("vakaa järjestää avaimet ja ohittaa undefined-kentät", () => {
    expect(vakaa({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe('{"a":[2,{"d":3}],"b":1}');
  });
});

describe("palvelimen muutokset", () => {
  it("luonti, päivitys ja poisto; pohja ja järjestysnumero päivittyvät", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" }]);
    const m: EtaMuutos[] = [
      { seq: 1, taulu: "foods", id: "f1", data: { id: "f1", name: "puuro", profiiliId: "p1" }, poistettu: false },
      { seq: 2, taulu: "foods", id: "f2", data: { id: "f2", name: "leipä", profiiliId: "p1" }, poistettu: false },
      { seq: 3, taulu: "foods", id: "f1", data: null, poistettu: true },
    ];
    await sovellaEtamuutokset(m, 3, d);
    expect(await d.table("foods").toArray()).toEqual([{ id: "f2", name: "leipä", profiiliId: "p1" }]);
    expect(await paikallisetMuutokset(d)).toEqual([]);
    expect((await synkTila(d)).seq).toBe(3);
  });

  it("saman päivän paino: palvelimen järjestys voittaa ilman uniikkiusvirhettä", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" }]);
    await d.table("weights").put(paino("a1", "2026-10-20", 80));
    await sovellaEtamuutokset([{ seq: 5, taulu: "weights", id: "b1", data: { id: "b1", date: "2026-10-20", kg: 79, profiiliId: "p1" }, poistettu: false }], 5, d);
    expect(await d.table("weights").toArray()).toEqual([{ id: "b1", date: "2026-10-20", kg: 79, profiiliId: "p1" }]);
  });
});

const vastaus = (runko: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => runko }) as Response;

describe("synkronoi", () => {
  it("lähettää ensin, sitten soveltaa; toinen ajo ei lähetä mitään", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" }]);
    await d.table("foods").put(ruoka("f1", "puuro"));
    const muutos = { taulu: "foods", id: "f1", data: { id: "f1", name: "puuro", profiiliId: "p1" }, poistettu: false };
    const hae = vi.fn()
      .mockResolvedValueOnce(vastaus({ kuitatut: [{ taulu: "foods", id: "f1", seq: 1 }], lisaa: false, seq: 1,
        muutokset: [{ seq: 1, taulu: "foods", id: "f1", data: { id: "f1", name: "puuro", profiiliId: "p1" }, poistettu: false }] }))
      .mockResolvedValueOnce(vastaus({ kuitatut: [], muutokset: [], lisaa: false, seq: 1 }));
    expect(await synkronoi(d, hae)).toEqual({ tila: "ok", lahetetty: 1, vastaanotettu: 1, seq: 1 });
    const [osoite, asetukset] = hae.mock.calls[0];
    expect(osoite).toBe("/api/synk");
    expect(asetukset.method).toBe("POST");
    // X-Profiili ja Authorization puuttuvat, jos profiili ei ole serverId ja API-avain ei ole asetettu.
    expect(asetukset.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(asetukset.body)).toEqual({ jalkeen: 0, muutokset: [muutos] });
    expect(await synkronoi(d, hae)).toEqual({ tila: "ok", lahetetty: 0, vastaanotettu: 0, seq: 1 });
    expect(JSON.parse(hae.mock.calls[1][1].body)).toEqual({ jalkeen: 1, muutokset: [] });
  });

  it("lisää X-Profiili- ja Authorization-otsakkeet, jos profiili ja avain on asetettu", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z", serverId: "srv-1" }]);
    await d.table("foods").put(ruoka("f1", "puuro"));
    const hae = vi.fn()
      .mockResolvedValueOnce(vastaus({ kuitatut: [], muutokset: [], lisaa: false, seq: 1 }));
    await synkronoi(d, hae);
    const [, asetukset] = hae.mock.calls[0];
    // Profiili serverId="srv-1", joten X-Profiili-otsake lähetetään.
    expect(asetukset.headers["X-Profiili"]).toBe("srv-1");
    // API-avain ei ole asetettu, joten Authorization puuttuu.
    expect(asetukset.headers["Authorization"]).toBeUndefined();
  });

  it("synkronoi vain aktiivisen profiilin tietueita; toisen profiilin ateriat eivät lähde", async () => {
    const d = kanta();
    await asetaProfiili(d, [
      { id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" },
      { id: "p2", name: "p2", aktiivinen: false, luotu: "2026-01-02T00:00:00.000Z" },
    ]);
    // Ateria p1:lle ja p2:lle.
    await d.table("meals").put({ id: "m1", date: "2026-10-01", time: "12:00", type: "Lounas", lines: [], note: "", origin: "Käsin", photoId: null, profiiliId: "p1", snapshot: null, assumptions: [] } as never);
    await d.table("meals").put({ id: "m2", date: "2026-10-01", time: "12:00", type: "Lounas", lines: [], note: "", origin: "Käsin", photoId: null, profiiliId: "p2", snapshot: null, assumptions: [] } as never);
    const hae = vi.fn()
      .mockResolvedValueOnce(vastaus({ kuitatut: [], muutokset: [], lisaa: false, seq: 1 }));
    await synkronoi(d, hae);
    const body = JSON.parse(hae.mock.calls[0][1].body);
    expect(body.muutokset.map((m: { id: string }) => m.id)).toEqual(["m1"]);
  });

  it("hakee loput sivut, kun palvelin ilmoittaa lisää", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" }]);
    const hae = vi.fn()
      .mockResolvedValueOnce(vastaus({ kuitatut: [], lisaa: true, seq: 2,
        muutokset: [{ seq: 1, taulu: "foods", id: "f1", data: { id: "f1", profiiliId: "p1" }, poistettu: false }] }))
      .mockResolvedValueOnce(vastaus({ lisaa: false, seq: 2,
        muutokset: [{ seq: 2, taulu: "foods", id: "f2", data: { id: "f2", profiiliId: "p1" }, poistettu: false }] }));
    expect(await synkronoi(d, hae)).toEqual({ tila: "ok", lahetetty: 0, vastaanotettu: 2, seq: 2 });
    expect(hae.mock.calls[1][0]).toBe("/api/synk?jalkeen=1");
    expect((await d.table("foods").toArray()).map((r) => r.id).sort()).toEqual(["f1", "f2"]);
  });

  it("lähentää enintään 20 sivua kerrallaan, loput lähtevät seuraavalla synkronoinnilla", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" }]);
    await d.table("foods").bulkPut(Array.from({ length: 10100 }, (_, i) => ruoka(`f${i}`, `ruoka ${i}`)));
    const hae = vi.fn().mockResolvedValue(
      vastaus({ kuitatut: [], muutokset: [], lisaa: false, seq: 1 }));
    expect(await synkronoi(d, hae)).toEqual({ tila: "ok", lahetetty: 10100, vastaanotettu: 0, seq: 1 });
    expect(hae).toHaveBeenCalledTimes(20);
    // 20 sivua lähetettiin, loput jäävät: toisella synkronoinnilla lähtee vain jäännös
    expect(await synkronoi(d, hae)).toEqual({ tila: "ok", lahetetty: 100, vastaanotettu: 0, seq: 1 });
    expect(hae).toHaveBeenCalledTimes(21);
  }, 30000);

  it("ilman palvelinta mitään ei muutu", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" }]);
    await d.table("foods").put(ruoka("f1", "puuro"));
    expect(await synkronoi(d, vi.fn().mockResolvedValue(vastaus({}, 404)))).toEqual({ tila: "ei-palvelinta" });
    expect(await synkronoi(d, vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).toEqual({ tila: "ei-palvelinta" });
    expect(await d.table("synkPohja").count()).toBe(0);
  });

  it("massapoisto vaatii vahvistuksen", async () => {
    const d = kanta();
    await asetaProfiili(d, [{ id: "p1", name: "p1", aktiivinen: true, luotu: "2026-01-01T00:00:00.000Z" }]);
    for (let i = 0; i <= POISTOJEN_RAJA; i++)
      await d.table("synkPohja").put({ taulu: "foods", id: `f${i}`, json: vakaa({ id: `f${i}` }) });
    const hae = vi.fn().mockResolvedValue(vastaus({ kuitatut: [], muutokset: [], lisaa: false, seq: 0 }));
    expect(await synkronoi(d, hae)).toEqual({ tila: "vahvista-poistot", poistoja: POISTOJEN_RAJA + 1 });
    expect(hae).not.toHaveBeenCalled();
    expect((await synkronoi(d, hae, true)).tila).toBe("ok");
  });
});
