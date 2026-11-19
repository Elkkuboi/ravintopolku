// Kehityksen kuvaajien geometria: tasaiset asteikon merkit, päivien paikat ja pylväät sekä tavoitetekstin paikka.
import { describe, it, expect } from "vitest";
import {
  alue,
  asteikko,
  palkki,
  tavoiteTekstiY,
  tekstinVara,
  xPaikka,
  yPaikka,
} from "../src/components/asteikko";

describe("asteikko", () => {
  it("painon merkit ovat tasakiloja, kun vaihtelu on muutama kilo (malli: 76–79)", () => {
    expect(asteikko(76.2, 78.9)).toEqual({
      min: 76,
      max: 79,
      merkit: [76, 77, 78, 79],
    });
  });
  it("pieni vaihtelu saa tiheämmät merkit ilman liukulukujen roskaa", () => {
    expect(asteikko(77.1, 77.4).merkit).toEqual([77, 77.1, 77.2, 77.3, 77.4]);
    expect(asteikko(77.05, 77.45).merkit).toEqual([77, 77.2, 77.4, 77.6]);
    expect(asteikko(0.1, 0.3).merkit.every((m) => String(m).length <= 4)).toBe(
      true,
    );
  });
  it("energian asteikko alkaa nollasta ja kattaa suurimman arvon ja tavoitteen", () => {
    const a = asteikko(0, 2380, { nollasta: true });
    expect(a.merkit).toEqual([0, 1000, 2000, 3000]);
    expect(asteikko(1500, 2380, { nollasta: true }).min).toBe(0);
  });
  it("alin arvo ei jää akselin alle: tasan alimmalla merkillä oleva tavoite nostaa asteikkoa askeleella", () => {
    // malli 7 pv: tavoite 76,5 ja punnitukset 77,1–77,6
    expect(asteikko(76.5, 77.6).merkit).toEqual([76, 76.5, 77, 77.5, 78]);
    expect(asteikko(77.1, 77.4).min).toBe(77);
    // pylväät alkavat aina nollasta, akselilta
    expect(asteikko(0, 2380, { nollasta: true }).min).toBe(0);
  });
  it("alavara: tavoitteen alle jää tila tekstille, muuten asteikko alkaa askelta alempaa", () => {
    const vara = tekstinVara(170);
    expect(vara).toBeCloseTo(16 / 126);
    // malli 90 pv: tavoite 76,5, punnitukset 76,8–82,0; ilman varaa tavoite olisi vain 0,5 kg akselin yllä
    expect(asteikko(76.5, 82).min).toBe(76);
    const a = asteikko(76.5, 82, { alavara: vara });
    expect(a.min).toBe(74);
    const al = alue(360, 170, ["82"]);
    const yT = yPaikka(76.5, a, al);
    expect(tavoiteTekstiY(yT, yPaikka(76.8, a, al), al)).toBe(yT + 13);
    // kun tilaa on jo, asteikko ei muutu
    expect(asteikko(77.4, 78.9, { alavara: vara }).min).toBe(77);
  });
  it("yksi arvo keskitetään kahden yksikön kaistaan, eikä jakoa nollalla tule", () => {
    const a = asteikko(77.6, 77.6);
    expect(a.min).toBeLessThan(77.6);
    expect(a.max).toBeGreaterThan(77.6);
    expect(asteikko(0, 0, { nollasta: true }).merkit).toEqual([0, 0.5, 1]);
  });
  it("merkit kattavat aina koko alueen eivätkä ylitä sitä enempää kuin askeleen", () => {
    for (const [lo, hi] of [
      [61.3, 64.8],
      [0, 137],
      [80.1, 80.2],
      [0, 47000],
    ]) {
      const a = asteikko(lo, hi);
      const askel = a.merkit[1] - a.merkit[0];
      expect(a.min).toBeLessThanOrEqual(lo);
      expect(a.max).toBeGreaterThanOrEqual(hi);
      expect(lo - a.min).toBeLessThan(askel + 1e-9);
      expect(a.max - hi).toBeLessThan(askel + 1e-9);
      expect(a.merkit.length).toBeGreaterThanOrEqual(3);
      expect(a.merkit.length).toBeLessThanOrEqual(6);
    }
  });
});

describe("kuvaajan alue ja paikat", () => {
  const al = alue(360, 170, ["76", "77", "78", "79"]);
  it("vasen reuna jättää tilaa merkkiteksteille, pitkä teksti siirtää sitä", () => {
    expect(al).toEqual({ x0: 34, x1: 356, yYla: 20, yAla: 146 });
    expect(alue(360, 150, ["10 000"]).x0).toBeGreaterThan(34);
  });
  it("asteikon ääripäät osuvat ylä- ja alareunaan", () => {
    const a = asteikko(76.2, 78.9);
    expect(yPaikka(79, a, al)).toBe(20);
    expect(yPaikka(76, a, al)).toBe(146);
    expect(yPaikka(77.5, a, al)).toBe(83);
  });
  it("päivät jakavat leveyden tasan, pylväs on päivän kohdalla eikä ylitä reunoja", () => {
    expect(xPaikka(0, 1, al)).toBe(195);
    const n = 30;
    for (let i = 0; i < n; i++) {
      const { x, w } = palkki(i, n, al);
      expect(x).toBeGreaterThanOrEqual(al.x0);
      expect(x + w).toBeLessThanOrEqual(al.x1 + 1e-9);
      expect(x + w / 2).toBeCloseTo(xPaikka(i, n, al));
    }
  });
  it("pylväiden väli on enintään 6, ja pitkällä jaksolla välit katoavat", () => {
    const leveys = al.x1 - al.x0;
    expect(palkki(0, 14, al).w).toBeCloseTo(leveys / 14 - 6);
    expect(palkki(0, 400, al).w).toBeCloseTo(leveys / 400);
  });
});

describe("tavoiteviivan teksti", () => {
  const al = alue(360, 170, ["76"]);
  it("menee viivan alle, kun paino on tavoitteen yläpuolella, ja yläpuolelle päinvastoin", () => {
    expect(tavoiteTekstiY(120, 100, al)).toBe(133);
    expect(tavoiteTekstiY(60, 100, al)).toBe(55);
  });
  it("ei mene päivämäärien päälle eikä yläreunan yli", () => {
    // tavoite pohjalla: alle ei mahdu, joten teksti nousee viivan yläpuolelle
    expect(tavoiteTekstiY(146, 100, al)).toBe(141);
    // tavoite ylimpänä: teksti mahtuu viivan yläpuolelle kuvaajan sisään
    expect(tavoiteTekstiY(20, 100, al)).toBe(15);
    expect(tavoiteTekstiY(20, null, al)).toBe(33);
  });
});
