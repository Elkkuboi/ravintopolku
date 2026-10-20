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

const ruoka = (tunniste: string, nimi: string) => ({ id: tunniste, name: nimi }) as never;
const paino = (tunniste: string, paiva: string, kg: number) => ({ id: tunniste, date: paiva, kg }) as never;

describe("tilannevertailu", () => {
  it("lisäykset, muutokset ja poistot pohjaan verrattuna; kuvat eivät synkronoidu", async () => {
    const d = kanta();
    await d.table("foods").put(ruoka("f1", "puuro"));
    await d.table("photos").put({ id: "p1", createdAt: "x", updatedAt: "x", blob: new Blob(["k"]) });
    expect(await paikallisetMuutokset(d)).toEqual([
      { taulu: "foods", id: "f1", data: { id: "f1", name: "puuro" }, poistettu: false }]);
    await d.table("synkPohja").put({ taulu: "foods", id: "f1", json: vakaa({ id: "f1", name: "puuro" }) });
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
    const m: EtaMuutos[] = [
      { seq: 1, taulu: "foods", id: "f1", data: { id: "f1", name: "puuro" }, poistettu: false },
      { seq: 2, taulu: "foods", id: "f2", data: { id: "f2", name: "leipä" }, poistettu: false },
      { seq: 3, taulu: "foods", id: "f1", data: null, poistettu: true },
    ];
    await sovellaEtamuutokset(m, 3, d);
    expect(await d.table("foods").toArray()).toEqual([{ id: "f2", name: "leipä" }]);
    expect(await paikallisetMuutokset(d)).toEqual([]);
    expect((await synkTila(d)).seq).toBe(3);
  });

  it("saman päivän paino: palvelimen järjestys voittaa ilman uniikkiusvirhettä", async () => {
    const d = kanta();
    await d.table("weights").put(paino("a1", "2026-10-20", 80));
    await sovellaEtamuutokset([{ seq: 5, taulu: "weights", id: "b1", data: { id: "b1", date: "2026-10-20", kg: 79 }, poistettu: false }], 5, d);
    expect(await d.table("weights").toArray()).toEqual([{ id: "b1", date: "2026-10-20", kg: 79 }]);
  });
});

const vastaus = (runko: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => runko }) as Response;

describe("synkronoi", () => {
  it("lähettää ensin, sitten soveltaa; toinen ajo ei lähetä mitään", async () => {
    const d = kanta();
    await d.table("foods").put(ruoka("f1", "puuro"));
    const hae = vi.fn()
      .mockResolvedValueOnce(vastaus({ kuitatut: [{ taulu: "foods", id: "f1", seq: 1 }], lisaa: false, seq: 1,
        muutokset: [{ seq: 1, taulu: "foods", id: "f1", data: { id: "f1", name: "puuro" }, poistettu: false }] }))
      .mockResolvedValueOnce(vastaus({ kuitatut: [], muutokset: [], lisaa: false, seq: 1 }));
    expect(await synkronoi(d, hae)).toEqual({ tila: "ok", lahetetty: 1, vastaanotettu: 1, seq: 1 });
    const [osoite, asetukset] = hae.mock.calls[0];
    expect(osoite).toBe("/api/synk");
    expect(asetukset.method).toBe("POST");
    expect(asetukset.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(asetukset.body)).toEqual({ jalkeen: 0, muutokset: [{ taulu: "foods", id: "f1", data: { id: "f1", name: "puuro" }, poistettu: false }] });
    expect(await synkronoi(d, hae)).toEqual({ tila: "ok", lahetetty: 0, vastaanotettu: 0, seq: 1 });
    expect(JSON.parse(hae.mock.calls[1][1].body)).toEqual({ jalkeen: 1, muutokset: [] });
  });

  it("hakee loput sivut, kun palvelin ilmoittaa lisää", async () => {
    const d = kanta();
    const hae = vi.fn()
      .mockResolvedValueOnce(vastaus({ kuitatut: [], lisaa: true, seq: 2,
        muutokset: [{ seq: 1, taulu: "foods", id: "f1", data: { id: "f1" }, poistettu: false }] }))
      .mockResolvedValueOnce(vastaus({ lisaa: false, seq: 2,
        muutokset: [{ seq: 2, taulu: "foods", id: "f2", data: { id: "f2" }, poistettu: false }] }));
    expect(await synkronoi(d, hae)).toEqual({ tila: "ok", lahetetty: 0, vastaanotettu: 2, seq: 2 });
    expect(hae.mock.calls[1][0]).toBe("/api/synk?jalkeen=1");
    expect((await d.table("foods").toArray()).map((r) => r.id).sort()).toEqual(["f1", "f2"]);
  });

  it("ilman palvelinta mitään ei muutu", async () => {
    const d = kanta();
    await d.table("foods").put(ruoka("f1", "puuro"));
    expect(await synkronoi(d, vi.fn().mockResolvedValue(vastaus({}, 404)))).toEqual({ tila: "ei-palvelinta" });
    expect(await synkronoi(d, vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).toEqual({ tila: "ei-palvelinta" });
    expect(await d.table("synkPohja").count()).toBe(0);
  });

  it("massapoisto vaatii vahvistuksen", async () => {
    const d = kanta();
    for (let i = 0; i <= POISTOJEN_RAJA; i++)
      await d.table("synkPohja").put({ taulu: "foods", id: `f${i}`, json: vakaa({ id: `f${i}` }) });
    const hae = vi.fn().mockResolvedValue(vastaus({ kuitatut: [], muutokset: [], lisaa: false, seq: 0 }));
    expect(await synkronoi(d, hae)).toEqual({ tila: "vahvista-poistot", poistoja: POISTOJEN_RAJA + 1 });
    expect(hae).not.toHaveBeenCalled();
    expect((await synkronoi(d, hae, true)).tila).toBe("ok");
  });
});
