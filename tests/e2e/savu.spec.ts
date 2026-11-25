// Savutesti tuotantokäännöstä vasten (playwright.config.ts): `vite preview` tuotannon CSP:llä, /api/* mockattuna
// page.routella ja järjestelmän Chrome. Tarkistaa, että sivut aukeavat neljällä värillä ilman CSP-rikkeitä ja
// konsolivirheitä, käsin kirjaus näkyy summassa, kuvakentät ovat oikein, kuvapolku vie luonnokseen ja tallennukseen,
// virhe näkyy suomeksi ilman tarjoajan tekstiä, uusi yritys lähettää saman kuvan, Peru ei tallenna mitään, luonnos
// säilyy sivun vaihdon yli, varmuuskopion palautus vaatii sanan KORVAA ja 360 px:n leveys ei vieritä vaakasuunnassa.
import { test, expect, type Page } from "@playwright/test";

const VARIT = ["paperi", "liitu", "terminaali", "fosfori"] as const;
const TEKNINEN =
  "Mallin kutsu epäonnistui. (tarjoaja vastasi HTTP 400: Unsupported parameter: 'temperature')";

const LUONNOS = {
  kind: "ateria",
  rooli: "kuva_tulkki",
  draft: {
    schemaVersion: 1,
    name: "Kanaa, riisiä ja salaattia",
    lines: [
      {
        name: "Broilerin rintafilee",
        mode: "portion",
        grams: 150,
        values: { energy: 248, protein: 34, carbs: 0, fat: 5, fiber: 0 },
        source: "Kuvasta arvioitu annos",
        state: "",
      },
      {
        name: "Keitetty riisi",
        mode: "portion",
        grams: 200,
        values: { energy: 260, protein: 5, carbs: 57, fat: 1, fiber: 1 },
        source: "Kuvasta arvioitu annos",
        state: "",
      },
    ],
    unknowns: [],
    assumptions: ["Riisiä noin kaksi desiä"],
    questions: [],
    provenance: {
      provider: "aiops-välittäjä / kuva_tulkki",
      model: "testimalli",
      note: "Kuvasta tulkittu arvio. Tarkista määrät.",
    },
  },
};

type Kuva = "ok" | "virhe" | "hidas";
/**
 * Mockattu palvelin: värireitti, synkronointi, luonnoslaatikko ja kuvan tulkinta. Muut reitit 404 (näkyy konsolissa).
 * Kuvareitin vastausta voi vaihtaa kesken testin (tila.kuva); "hidas" vastaa onnistuneesti 1,5 s:n päästä.
 */
async function palvelin(
  page: Page,
  vari: string = "paperi",
  kuva: Kuva = "ok",
  luonnokset: unknown[] = [],
) {
  const tila = { kuva };
  const pyynnot: { polku: string; runko: Buffer | null }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      polku = new URL(req.url()).pathname;
    pyynnot.push({ polku, runko: req.postDataBuffer() });
    // Sivu voi perua pyynnön (Peru) ennen vastausta: myöhästynyt vastaus ei ole testin virhe.
    const json = (status: number, body: unknown) =>
      route
        .fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        })
        .catch(() => {});
    if (polku === "/api/ulkoasu") return json(200, { vari });
    if (polku === "/api/synk")
      return json(200, { muutokset: [], lisaa: false, seq: 0 });
    if (polku === "/api/luonnokset") return json(200, { luonnokset });
    if (polku === "/api/kuva-ateria") {
      if (tila.kuva === "hidas") await new Promise((r) => setTimeout(r, 1500));
      return tila.kuva === "virhe"
        ? json(502, { virhe: TEKNINEN })
        : json(200, LUONNOS);
    }
    return json(404, { virhe: "ei rajapintaa" });
  });
  return { pyynnot, tila };
}

/** Kuvan tavut multipart-rungosta (kenttä "kuva"): latin1 pitää tavut ja merkit yksi yhteen. */
function kuvaOsa(runko: Buffer | null): Buffer {
  const s = runko?.toString("latin1") ?? "";
  const raja = s.slice(0, s.indexOf("\r\n"));
  const alku = s.indexOf("\r\n\r\n", s.indexOf('name="kuva"')) + 4;
  return runko!.subarray(alku, s.indexOf("\r\n" + raja, alku));
}

/** Konsolivirheet ja CSP-rikkeet talteen. */
async function valvo(page: Page) {
  const virheet: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") virheet.push(m.text());
  });
  page.on("pageerror", (e) => virheet.push(e.message));
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`),
    ),
  );
  return virheet;
}

/** Kuvatiedosto piirretään selaimessa, jotta testi ei tarvitse kuvatiedostoa repoon. */
async function kuvatiedosto(page: Page) {
  const b64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(1200, 900);
    const g = c.getContext("2d")!;
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `hsl(${i * 30} 50% 50%)`;
      g.fillRect(i * 100, 0, 100, 900);
    }
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return {
    name: "ateria.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(b64, "base64"),
  };
}

/** Päivän kirjaukset (uni, liike ja olo) suoraan selaimen kannasta: [askeleet, treenipäivä] kirjausta kohden. */
const paivanKirjaukset = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<unknown[]>((valmis, virhe) => {
        const avaus = indexedDB.open("ravintopolku-v1");
        avaus.onerror = () => virhe(avaus.error);
        avaus.onsuccess = () => {
          const kanta = avaus.result;
          const haku = kanta
            .transaction("lifestyles")
            .objectStore("lifestyles")
            .getAll();
          haku.onsuccess = () => {
            kanta.close();
            valmis(haku.result.map((l) => [l.steps, l.trainingDay]));
          };
        };
      }),
  );

const kamera = (page: Page) =>
  page.locator("label.file", { hasText: "Ota kuva" }).locator("input");
const galleria = (page: Page) =>
  page.locator("label.file", { hasText: "Galleriasta" }).locator("input");

for (const vari of VARIT)
  test(`${vari}: kolme sivua ilman CSP-rikkeitä ja konsolivirheitä`, async ({
    page,
  }) => {
    const virheet = await valvo(page);
    await palvelin(page, vari);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-vari", vari);
    await expect(
      page.getByRole("region", { name: "Lisää ateria" }),
    ).toBeVisible();
    // Tilarivin väri on sivun tausta (style.css), ei kovakoodattu arvo.
    const [tila, tausta] = await page.evaluate(() => [
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
      getComputedStyle(document.documentElement)
        .getPropertyValue("--paper")
        .trim(),
    ]);
    expect(tila).toBe(tausta);
    await page.getByRole("link", { name: "Kehitys" }).click();
    await expect(page.getByRole("heading", { name: /^Paino/ })).toBeVisible();
    await page.getByRole("link", { name: "Asetukset" }).click();
    await expect(
      page.getByRole("heading", { name: "Tavoitteet" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Ulkoasu/ })).toBeVisible();
    expect(virheet).toEqual([]);
  });

test("käsin kirjaus näkyy summassa ja aukeaa muokattavaksi", async ({
  page,
}) => {
  const virheet = await valvo(page);
  await palvelin(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Kirjoita", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Uusi ateria" })).toBeVisible();
  await page.getByLabel(/^1\. /).fill("Kaurapuuro");
  await page.getByLabel("Energia (kcal)").fill("350");
  await page.getByLabel("Proteiini (g)").fill("12");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tallenna" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".figure-num")).toHaveText("350");
  const rivi = page.locator("button.meal", { hasText: "Kaurapuuro" });
  await expect(rivi).toContainText("350");
  await rivi.click();
  await expect(
    page.getByRole("dialog", { name: "Muokkaa ateriaa" }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Sulje" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(virheet).toEqual([]);
});

test("treenipäivä: napautus tallentuu heti, ei tyhjennä lomaketta ja näkyy Kehityksessä", async ({
  page,
}) => {
  const virheet = await valvo(page);
  await palvelin(page);
  await page.goto("/");
  // ateria, jotta energian kuvaaja piirtyy
  await page.getByRole("button", { name: "Kirjoita", exact: true }).click();
  await page.getByLabel(/^1\. /).fill("Kaurapuuro");
  await page.getByLabel("Energia (kcal)").fill("350");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tallenna" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const treeni = page.getByRole("checkbox", { name: "Treenipäivä" });
  const taite = page.locator("details.fold");
  await expect(treeni).not.toBeChecked();
  // kesken oleva lomake säilyy, kun treenipäivä napautetaan
  await taite.locator("summary").click();
  await taite.getByLabel("Askeleet").fill("8000");
  await treeni.click();
  await expect(treeni).toBeChecked();
  await expect(taite.getByLabel("Askeleet")).toHaveValue("8000");
  await taite.getByRole("button", { name: "Tallenna" }).click();
  // päivän kirjaus selaimen kannassa: lomakkeen askeleet ja treenipäivä samassa tietueessa
  await expect.poll(() => paivanKirjaukset(page)).toEqual([[8000, true]]);
  await page.reload();
  await expect(treeni).toBeChecked();
  await taite.locator("summary").click();
  await expect(taite.getByLabel("Askeleet")).toHaveValue("8000");

  await page.getByRole("link", { name: "Kehitys" }).click();
  await expect(page.locator(".chart .merkki rect")).toHaveCount(1);
  await expect(page.getByText("Treenattu 1 päivänä 30:stä.")).toBeVisible();
  await expect(page.locator(".treeni-merkki")).toHaveCount(1);
  await page.locator("summary", { hasText: "Päivittäiset luvut" }).click();
  await expect(page.locator(".luvut td", { hasText: "✓" })).toHaveCount(1);
  // viikkopylväissä ei päiväviivoja; määrä näkyy silti
  await page.getByRole("button", { name: "90 pv" }).click();
  await expect(page.locator(".chart .merkki")).toHaveCount(0);
  await expect(page.locator(".treeni-merkki")).toHaveCount(0);
  await expect(page.getByText("Treenattu 1 päivänä 90:stä.")).toBeVisible();

  await page.getByRole("link", { name: "Tänään" }).click();
  await treeni.click();
  await expect(treeni).not.toBeChecked();
  await expect.poll(() => paivanKirjaukset(page)).toEqual([[8000, false]]);
  await page.reload();
  await expect(treeni).not.toBeChecked();
  await page.getByRole("link", { name: "Kehitys" }).click();
  // ensin Kehitys-sivu piirtyneenä (laiska lataus), vasta sitten puuttuvan merkinnän tarkistus
  await expect(page.locator(".chart .bar rect")).toHaveCount(1);
  await expect(page.getByText(/Treenattu/)).toHaveCount(0);
  await expect(page.locator(".chart .merkki")).toHaveCount(0);
  expect(virheet).toEqual([]);
});

test("kuvakentät: kamera ja galleria erikseen, capture vain kamerassa", async ({
  page,
}) => {
  await palvelin(page);
  await page.goto("/");
  await expect(kamera(page)).toHaveAttribute("capture", "environment");
  await expect(galleria(page)).not.toHaveAttribute("capture");
  for (const kentta of [kamera(page), galleria(page)]) {
    await expect(kentta).toHaveAttribute("type", "file");
    await expect(kentta).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
  }
  // Kohdistuskehys vain näppäimistöllä: napautuksen jälkeen ei kehystä, näppäimistöllä kohdistettuna kehys.
  const kehys = (nimi: string) =>
    page
      .locator("label.file", { hasText: nimi })
      .evaluate((l) => getComputedStyle(l).outlineStyle);
  await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("label.file", { hasText: "Ota kuva" }).click(),
  ]);
  expect(await kehys("Ota kuva")).toBe("none");
  await page.getByRole("button", { name: "Kirjoita", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await kehys("Galleriasta")).toBe("solid");
});

test("kuvapolku: kuva, lisätieto, luonnos ja tallennus", async ({ page }) => {
  const virheet = await valvo(page);
  const { pyynnot } = await palvelin(page);
  await page.goto("/");
  await kamera(page).setInputFiles(await kuvatiedosto(page));
  await page.getByLabel("Lisätieto (ei pakollinen)").fill("iso annos");
  await page.getByRole("button", { name: "Tulkitse kuva" }).click();
  await expect(page.getByRole("heading", { name: /^Sisältö/ })).toBeVisible();
  const kutsu = pyynnot.find((p) => p.polku === "/api/kuva-ateria");
  expect(kutsu?.runko?.length).toBeLessThanOrEqual(700_000);
  const runko = kutsu?.runko?.toString("latin1") ?? "";
  expect(runko).toContain("kuva_tulkki");
  expect(runko).toContain("iso annos");
  await expect(page.locator(".sum")).toContainText("508 kcal");
  await page.getByRole("button", { name: "Tallenna", exact: true }).click();
  const rivi = page.locator("button.meal", {
    hasText: "Kanaa, riisiä ja salaattia",
  });
  await expect(rivi).toContainText("508");
  await expect(page.locator(".figure-num")).toHaveText("508");
  expect(virheet).toEqual([]);
});

test("virhepolku: lyhyt suomenkielinen viesti ja käsin kirjaus", async ({
  page,
}) => {
  const virheet = await valvo(page);
  await palvelin(page, "paperi", "virhe");
  await page.goto("/");
  await galleria(page).setInputFiles(await kuvatiedosto(page));
  await page.getByRole("button", { name: "Tulkitse kuva" }).click();
  const viesti = page.getByRole("alert");
  await expect(viesti).toHaveText("Kuvan tulkinta ei onnistunut.");
  await expect(viesti).not.toContainText("HTTP");
  await expect(
    page.getByRole("button", { name: "Yritä uudelleen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Kirjoita käsin" }).click();
  await expect(page.getByRole("dialog", { name: "Uusi ateria" })).toBeVisible();
  // Ainoa konsolivirhe on mockatun palvelimen 502-vastaus.
  expect(virheet.filter((v) => !v.includes("502"))).toEqual([]);
});

test("virhepolku: Yritä uudelleen lähettää saman kuvan ja vie luonnokseen", async ({
  page,
}) => {
  const virheet = await valvo(page);
  const { pyynnot, tila } = await palvelin(page, "paperi", "virhe");
  await page.goto("/");
  await galleria(page).setInputFiles(await kuvatiedosto(page));
  await page.getByRole("button", { name: "Tulkitse kuva" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Kuvan tulkinta ei onnistunut.",
  );
  tila.kuva = "ok";
  await page.getByRole("button", { name: "Yritä uudelleen" }).click();
  await expect(page.getByRole("heading", { name: /^Sisältö/ })).toBeVisible();
  const kutsut = pyynnot.filter((p) => p.polku === "/api/kuva-ateria");
  expect(kutsut).toHaveLength(2);
  const [eka, toka] = kutsut.map((k) => kuvaOsa(k.runko));
  expect(eka.length).toBeGreaterThan(1000);
  expect(toka.equals(eka)).toBe(true);
  expect(virheet.filter((v) => !v.includes("502"))).toEqual([]);
});

test("Peru keskeyttää tulkinnan: myöhästynyt vastaus ei avaa luonnosta eikä mitään tallenneta", async ({
  page,
}) => {
  const virheet = await valvo(page);
  const { pyynnot } = await palvelin(page, "paperi", "hidas");
  await page.goto("/");
  await kamera(page).setInputFiles(await kuvatiedosto(page));
  await page.getByRole("button", { name: "Tulkitse kuva" }).click();
  await expect(page.getByText("Tulkitaan", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Peru" }).click();
  await expect(page.getByRole("button", { name: "Tulkitse kuva" })).toBeVisible();
  await page.waitForTimeout(2000); // mockin 1,5 s:n vastaus on ohi
  await expect(page.getByRole("heading", { name: /^Sisältö/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tulkitse kuva" })).toBeVisible();
  await page.locator("a.back", { hasText: "Tänään" }).click();
  await expect(page.getByRole("region", { name: "Lisää ateria" })).toBeVisible();
  await expect(page.locator("button.meal")).toHaveCount(0);
  expect(pyynnot.filter((p) => p.polku === "/api/kuva-ateria")).toHaveLength(1);
  expect(virheet).toEqual([]);
});

test("luonnos säilyy sivun vaihdon yli; yläpalkin Tänään kysyy kuten Hylkää", async ({
  page,
}) => {
  const virheet = await valvo(page);
  await palvelin(page);
  await page.goto("/");
  await kamera(page).setInputFiles(await kuvatiedosto(page));
  const osio = page.getByRole("region", { name: "Ateria kuvasta" });
  await expect(osio).not.toHaveAttribute("data-keskenerainen");
  await page.getByRole("button", { name: "Tulkitse kuva" }).click();
  const nimi = page.getByLabel("Nimi", { exact: true });
  await expect(nimi).toHaveValue("Kanaa, riisiä ja salaattia");
  // Päivityspalkki tunnistaa keskeneräisen luonnoksen tästä merkinnästä (kuori.ts paivitysEste).
  await expect(osio).toHaveAttribute("data-keskenerainen", "");
  await nimi.fill("Kana-riisi");
  const yla = page.getByRole("navigation", { name: "Sivut" });
  await yla.getByRole("link", { name: "Kehitys" }).click();
  await expect(page.getByRole("heading", { name: /^Paino/ })).toBeVisible();
  await expect(osio).toBeHidden();
  await yla.getByRole("link", { name: "Tänään" }).click();
  await expect(nimi).toHaveValue("Kana-riisi");
  // Tänään-sivulla Tänään-linkki: peruttu kysymys jättää luonnoksen, hyväksytty hylkää sen.
  page.once("dialog", (d) => void d.dismiss());
  await yla.getByRole("link", { name: "Tänään" }).click();
  await expect(nimi).toHaveValue("Kana-riisi");
  page.once("dialog", (d) => void d.accept());
  await yla.getByRole("link", { name: "Tänään" }).click();
  await expect(page.getByRole("region", { name: "Lisää ateria" })).toBeVisible();
  await expect(page.locator("button.meal")).toHaveCount(0);
  expect(virheet).toEqual([]);
});

test("Ilmarin luonnosten napit kertovat, mitä luonnosta ne koskevat", async ({
  page,
}) => {
  const luonnos = (id: number, name: string) => ({
    id,
    externalId: `ilmari-${id}`,
    source: "ilmari",
    saapunut: "2026-11-19T10:00:00Z",
    draft: { ...LUONNOS.draft, name },
  });
  await palvelin(page, "paperi", "ok", [
    luonnos(1, "Puuro"),
    luonnos(2, "Keitto"),
  ]);
  await page.goto("/");
  for (const nimi of ["Puuro", "Keitto"]) {
    await expect(
      page.getByRole("button", { name: `Tarkista: ${nimi}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Hylkää: ${nimi}` }),
    ).toBeVisible();
  }
});

test("varmuuskopion palautus vaatii sanan KORVAA", async ({ page }) => {
  const virheet = await valvo(page);
  await palvelin(page);
  await page.goto("/#asetukset");
  const [lataus] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Varmuuskopio", exact: true }).click(),
  ]);
  await page
    .locator("label.file", { hasText: "Tuo varmuuskopio" })
    .locator("input")
    .setInputFiles(await lataus.path());
  const ikkuna = page.getByRole("dialog", { name: "Tuo varmuuskopio" });
  const korvaa = ikkuna.getByRole("button", { name: "Korvaa tiedot" });
  const vahvistus = ikkuna.getByLabel("Kirjoita KORVAA vahvistaaksesi");
  await expect(korvaa).toBeDisabled();
  await vahvistus.fill("korva");
  await expect(korvaa).toBeDisabled();
  await vahvistus.fill("KORVAA");
  await expect(korvaa).toBeEnabled();
  await korvaa.click();
  await expect(ikkuna).toHaveCount(0);
  await expect(page.getByText("Varmuuskopio tuotu.")).toBeVisible();
  expect(virheet).toEqual([]);
});

test("360 px: ei vaakavieritystä millään sivulla", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await palvelin(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Kirjoita", exact: true }).click();
  await page
    .getByLabel(/^1\. /)
    .fill("Pitkänimisen aterian koko nimi, jossa on paljon sanoja");
  await page.getByLabel("Energia (kcal)").fill("1890");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tallenna" })
    .click();
  await expect(page.locator("button.meal")).toHaveCount(1);
  for (const sivu of ["", "#kehitys", "#asetukset"]) {
    await page.goto("/" + sivu);
    await expect(page.locator("main .wrap > *").first()).toBeVisible();
    const yli = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(yli, sivu || "Tänään").toBeLessThanOrEqual(0);
  }
});
