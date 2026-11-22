// Profiilit (yritys 167): profiilien luonti, valinta, profiilikenttätarkistus ja API-avain.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DiaryDB, luoProfiili, setAktiivinenProfiili, listProfiilit, aktiivinenProfiiliId,
  getAPIAvain, setAPIAvain, saveRecord,
} from "../src/data/db";
import { paikallisetMuutokset, synkronoi } from "../src/data/sync";

const kannat: DiaryDB[] = [];
const kanta = () => { const d = new DiaryDB("prof-" + Math.random().toString(36).slice(2)); kannat.push(d); return d; };
afterEach(async () => { await Promise.all(kannat.splice(0).map((d) => d.delete())); });

const vastaus = (runko: unknown) =>
  ({ ok: true, status: 200, json: async () => runko }) as Response;

describe("profiilien luonti ja valinta", () => {
  it("ensimmäinen profiili on aktiivinen", async () => {
    const d = kanta();
    const p = await luoProfiili("Testi", d);
    expect(p.aktiivinen).toBe(true);
    expect(await aktiivinenProfiiliId(d)).toBe(p.id);
  });
  it("toinen profiili ei ole aktiivinen; valinta vaihtaa aktiivisen", async () => {
    const d = kanta();
    await luoProfiili("Ensimmäinen", d);
    const p2 = await luoProfiili("Toinen", d);
    expect(p2.aktiivinen).toBe(false);
    expect(await aktiivinenProfiiliId(d)).not.toBe(p2.id);
    await setAktiivinenProfiili(p2.id, d);
    expect(await aktiivinenProfiiliId(d)).toBe(p2.id);
    const lista = await listProfiilit(d);
    expect(lista.filter((p) => p.aktiivinen).map((p) => p.id)).toEqual([p2.id]);
  });
  it("listProfiilit palauttaa aktiivisen ensimmäisenä", async () => {
    const d = kanta();
    await luoProfiili("A", d);
    const p2 = await luoProfiili("B", d);
    await setAktiivinenProfiili(p2.id, d);
    const lista = await listProfiilit(d);
    expect(lista[0].id).toBe(p2.id);
  });
});

describe("profiilikenttä tietueissa", () => {
  it("saveRecord asettaa profiiliId aktiiviselle profiilille, jos ei ole annettu", async () => {
    const d = kanta();
    await luoProfiili("Testi", d);
    const pid = await aktiivinenProfiiliId(d);
    const { stamped, emptyNutrients } = await import("../src/domain/model");
    await saveRecord("foods", { ...stamped(), id: "r1", name: "puuro", favorite: false, state: "kypsä", source: "Pakkaus", per100: emptyNutrients() } as never, d);
    const rivit = await d.table("foods").toArray();
    expect((rivit[0] as { profiiliId?: string }).profiiliId).toBe(pid);
  });
  it("paikallisetMuutokset ei lähetä toisen profiilin tietueita", async () => {
    const d = kanta();
    const p1 = await luoProfiili("P1", d);
    const p2 = await luoProfiili("P2", d);
    await d.table("foods").put({ id: "f1", name: "a", profiiliId: p1.id } as never);
    await d.table("foods").put({ id: "f2", name: "b", profiiliId: p2.id } as never);
    const muutokset = await paikallisetMuutokset(d);
    expect(muutokset.map((m) => m.id)).toEqual(["f1"]);
  });
  it("profiiliId puuttuvaa tietuetta ei lähetetä profiilikohtaisella taululla", async () => {
    const d = kanta();
    await luoProfiili("P1", d);
    await d.table("foods").put({ id: "f3", name: "ei profiilia" } as never);
    expect(await paikallisetMuutokset(d)).toEqual([]);
  });
});

describe("API-avain", () => {
  it("getAPIAvain palauttaa tyhjän merkkijonon ilman localStorageia", () => {
    expect(getAPIAvain()).toBe("");
  });
  it("setAPIAvain ei heitä ilman localStorageia", () => {
    expect(() => setAPIAvain("Bearer abc")).not.toThrow();
  });
});

describe("synkronointi profiilin kanssa", () => {
  it("lähetää vain aktiivisen profiilin muutokset ja X-Profiili-otsakkeen", async () => {
    const d = kanta();
    const p1 = await luoProfiili("P1", d);
    const p2 = await luoProfiili("P2", d);
    await d.table("profiilit").put({ ...p1, serverId: "srv-1" } as never);
    await d.table("foods").put({ id: "f1", name: "a", profiiliId: p1.id } as never);
    await d.table("foods").put({ id: "f2", name: "b", profiiliId: p2.id } as never);
    const hae = vi.fn().mockResolvedValue(
      vastaus({ kuitatut: [], muutokset: [], lisaa: false, seq: 1 }),
    );
    await synkronoi(d, hae);
    const [, asetukset] = hae.mock.calls[0];
    expect(asetukset.headers["X-Profiili"]).toBe("srv-1");
    const body = JSON.parse(asetukset.body);
    expect(body.muutokset.map((m: { id: string }) => m.id)).toEqual(["f1"]);
  });
});
