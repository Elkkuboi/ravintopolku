// Tänään-sivu: päivän nimi, ateriarivit, edellinen paino, aterian kopio ja käsin muokkauksen piilokentät.
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  paivanNimi,
  kelloksi,
  aterianOtsikko,
  aterianKcal,
  aterianAlarivi,
  edellinenPaino,
  aterianKopio,
} from "../src/nakymat/paiva";
import {
  editLine,
  freshLine,
  parseLines,
  epatavallinen,
  rakennaAteria,
  tallennettavaKuva,
} from "../src/components/ateriamuokkaus";
import { IntegrationInbox } from "../src/components/IntegrationInbox";
import { MealEditor } from "../src/components/MealEditor";
import {
  mealSchema,
  stamped,
  id,
  emptyDataset,
  type Meal,
  type Weight,
} from "../src/domain/model";
import { DiaryDB, saveMeal, readDataset } from "../src/data/db";
import { line, meal } from "./fixtures";

const databases: DiaryDB[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});
const paino = (date: string, kg: number): Weight => ({
  ...stamped(),
  date,
  kg,
  note: "",
});
const kuvaAteria = (): Meal => ({
  ...meal("2026-11-19"),
  time: "18:00",
  timestamp: "2026-11-19T16:00:00.000Z",
  note: "Kanaa, riisiä ja salaattia",
  origin: "Kuvasta (rooli kuva_tulkki): ruoka-annos",
  assumptions: ["Lisätiedot: iso annos", "Kysymys: Oliko kastiketta?"],
  photoId: "kuva-1",
  lines: [
    {
      ...line(),
      name: "Broileri",
      mode: "portion",
      grams: 150,
      values: { energy: 248, protein: 36, carbs: 0, fat: 10, fiber: null },
      source: "Kuvasta arvioitu annos",
      state: "paistettu",
      foodId: "ruoka-7",
    },
  ],
});

describe("päivä ja ateriarivit", () => {
  it("päivän nimi viikonpäivänä ja päivämääränä", () => {
    expect(paivanNimi("2026-11-19")).toBe("torstai 19.11.");
    expect(paivanNimi("2026-01-05")).toBe("maanantai 5.1.");
    expect(kelloksi("08:00")).toBe("08.00");
  });
  it("kuvasta tulkitun aterian nimi on sen muistiinpano, muun rivien nimet", () => {
    expect(aterianOtsikko(kuvaAteria())).toBe("Kanaa, riisiä ja salaattia");
    const kasin = { ...meal(), note: "Söin kiireessä" };
    kasin.lines = [
      { ...line(), name: "Puuro" },
      { ...line(), name: "Marjat" },
    ];
    expect(aterianOtsikko(kasin)).toBe("Puuro, Marjat");
    expect(aterianOtsikko({ ...kuvaAteria(), note: " " })).toBe("Broileri");
  });
  it("alarivi P · H · R, kuvasta tulkitulla merkintä; osittainen kcal ≥", () => {
    expect(aterianAlarivi(kuvaAteria())).toBe("P 36 · H 0 · R 10 · kuvasta");
    const m = meal(); // per100 150 g: energia 300, proteiini 15, hiilihydraatit ja rasva tuntemattomia
    expect(aterianAlarivi(m)).toBe("P 15 · H — · R —");
    expect(aterianKcal(m)).toBe("300");
    m.lines.push({ ...line(), values: { ...line().values, energy: null } });
    expect(aterianKcal(m)).toBe("≥300");
  });
  it("painon lisätieto: eilen tai päivämäärä; saman päivän ja tulevat ohitetaan", () => {
    const w = [
      paino("2026-11-15", 78.4),
      paino("2026-11-18", 77.9),
      paino("2026-11-19", 77.6),
      paino("2026-11-20", 70),
    ];
    expect(edellinenPaino(w, "2026-11-19")).toBe("eilen 77,9");
    expect(edellinenPaino(w, "2026-11-17")).toBe("15.11. 78,4");
    expect(edellinenPaino(w, "2026-11-15")).toBe("");
    expect(edellinenPaino([], "2026-11-19")).toBe("");
  });
});

describe("aterian kopio toiselle päivälle", () => {
  it("samat rivit ja kellonaika, uudet tunnisteet ja oma kuva; alkuperäinen ennallaan", async () => {
    const alkuperainen = kuvaAteria();
    const kuva = { ...stamped(), blob: new Blob(["k"]) };
    const { meal: kopio, photo } = aterianKopio(
      alkuperainen,
      "2026-11-20",
      kuva,
    );
    expect(() => mealSchema.parse(kopio)).not.toThrow();
    expect(kopio.id).not.toBe(alkuperainen.id);
    expect(kopio.date).toBe("2026-11-20");
    expect(kopio.time).toBe("18:00");
    expect(kopio.timestamp).toBe("2026-11-20T16:00:00.000Z");
    expect(kopio.lines[0].id).not.toBe(alkuperainen.lines[0].id);
    expect(kopio.lines[0]).toMatchObject({
      name: "Broileri",
      source: "Kuvasta arvioitu annos",
    });
    expect(photo?.id).toBe(kopio.photoId);
    expect(photo?.id).not.toBe(kuva.id);
    expect(alkuperainen.date).toBe("2026-11-19");
    expect(
      aterianKopio(alkuperainen, "2026-11-20", undefined).meal.photoId,
    ).toBeNull();
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    await saveMeal(kopio, photo, false, db);
    expect((await readDataset(db)).photos).toHaveLength(1);
  });
});

describe("käsin muokkaus säilyttää piilotetut kentät", () => {
  it("lähde, valmistustila, ruoka, alkuperä, oletukset ja kuva kulkevat muokkauksen läpi", () => {
    const vanha = kuvaAteria();
    const rivit = vanha.lines.map(editLine);
    rivit[0] = { ...rivit[0], grams: "200" }; // käyttäjä muuttaa vain grammoja
    const uusi = rakennaAteria(
      vanha,
      {
        date: vanha.date,
        time: "18:30",
        type: vanha.type,
        note: vanha.note,
        origin: vanha.origin,
        assumptions: vanha.assumptions,
        photoId: vanha.photoId,
      },
      parseLines(rivit),
    );
    expect(() => mealSchema.parse(uusi)).not.toThrow();
    expect(uusi.id).toBe(vanha.id);
    expect(uusi.createdAt).toBe(vanha.createdAt);
    expect(uusi.origin).toBe("Kuvasta (rooli kuva_tulkki): ruoka-annos");
    expect(uusi.assumptions).toEqual(vanha.assumptions);
    expect(uusi.photoId).toBe("kuva-1");
    expect(uusi.lines[0]).toEqual({ ...vanha.lines[0], grams: 200 });
    expect(uusi.timestamp).toBe("2026-11-19T16:30:00.000Z");
  });
  it("tyhjennetty lähde saa arvon Oma arvio; per 100 g ilman grammoja ja tyhjä ateria hylätään", () => {
    const r = editLine({ ...line(), source: "Pakkaus" });
    expect(
      parseLines([{ ...r, line: { ...r.line, source: "  " } }])[0].source,
    ).toBe("Oma arvio");
    expect(parseLines([r])[0].source).toBe("Pakkaus");
    expect(() =>
      parseLines([{ ...editLine(freshLine("per100")), grams: "" }]),
    ).toThrow("Anna positiivinen numero");
    expect(
      parseLines([{ ...editLine(freshLine("portion")), grams: "" }])[0].grams,
    ).toBeNull();
    expect(() => parseLines([])).toThrow("vähintään yksi");
  });
  it("kuva toisella laitteella: viittaus säilyy tallennuksessa, vain Poista kuva tyhjentää sen", async () => {
    const vanha = kuvaAteria(); // photoId "kuva-1", kuvaa ei ole tämän laitteen data.photos-listassa
    expect(tallennettavaKuva(vanha, null, false)).toBe("kuva-1");
    expect(tallennettavaKuva(vanha, null, true)).toBeNull();
    expect(tallennettavaKuva(vanha, { id: "kuva-1" }, false)).toBe("kuva-1");
    expect(tallennettavaKuva(undefined, { id: "uusi" }, false)).toBe("uusi");
    expect(tallennettavaKuva(undefined, null, false)).toBeNull();
    // Tallennus ilman muutoksia: kanta säilyttää viittauksen, vaikka kuvaa ei ole tällä laitteella.
    const db = new DiaryDB("test-" + id());
    databases.push(db);
    await saveMeal(vanha, null, false, db);
    const kentat = {
      date: vanha.date,
      time: vanha.time,
      type: vanha.type,
      note: vanha.note,
      origin: vanha.origin,
      assumptions: vanha.assumptions,
    };
    await saveMeal(
      rakennaAteria(
        vanha,
        { ...kentat, photoId: tallennettavaKuva(vanha, null, false) },
        vanha.lines,
      ),
      null,
      false,
      db,
    );
    expect((await readDataset(db)).meals[0].photoId).toBe("kuva-1");
    await saveMeal(
      rakennaAteria(
        vanha,
        { ...kentat, photoId: tallennettavaKuva(vanha, null, true) },
        vanha.lines,
      ),
      null,
      true,
      db,
    );
    expect((await readDataset(db)).meals[0].photoId).toBeNull();
  });
  it("kuvasta tulkitun aterian nimi on muokkauksessa kentässä Nimi, muun muistiinpano kentässä Muistiinpano", () => {
    const piirra = (m: Meal) =>
      renderToStaticMarkup(
        createElement(MealEditor, {
          data: emptyDataset(),
          date: m.date,
          meal: m,
          onSaved: () => {},
          onDone: () => {},
        }),
      );
    const kuvasta = piirra(kuvaAteria());
    expect(kuvasta).toMatch(/<label[^>]*>Nimi<\/label><textarea[^>]*>Kanaa, riisiä/);
    expect(kuvasta).not.toContain(">Muistiinpano<");
    const kasin = piirra({ ...meal(), note: "Söin kiireessä" });
    expect(kasin).toMatch(/<label[^>]*>Muistiinpano<\/label><textarea[^>]*>Söin kiireessä/);
    expect(kasin).not.toContain(">Nimi<");
  });
  it("poikkeuksellisen suuret luvut varmistetaan", () => {
    expect(epatavallinen([line()])).toBe(false);
    expect(epatavallinen([{ ...line(), grams: 5001 }])).toBe(true);
    expect(
      epatavallinen([
        { ...line(), values: { ...line().values, energy: 3001 } },
      ]),
    ).toBe(true);
  });
});

describe("Ilmarin luonnokset", () => {
  it("osio ei piirry, kun luonnoksia ei ole (myös ilman palvelinta)", () => {
    expect(
      renderToStaticMarkup(
        createElement(IntegrationInbox, {
          data: emptyDataset(),
          paivitys: 0,
          onOpen: () => {},
        }),
      ),
    ).toBe("");
  });
});
