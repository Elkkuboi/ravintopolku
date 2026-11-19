// Savutesti tuotantokäännöstä vasten (playwright.config.ts): `vite preview` tuotannon CSP:llä, /api/* mockattuna
// page.routella ja järjestelmän Chrome. Tarkistaa, että sivut aukeavat neljällä värillä ilman CSP-rikkeitä ja
// konsolivirheitä, käsin kirjaus näkyy summassa, kuvakentät ovat oikein, kuvapolku vie luonnokseen ja tallennukseen,
// virhe näkyy suomeksi ilman tarjoajan tekstiä ja 360 px:n leveys ei vieritä vaakasuunnassa.
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

type Kuva = "ok" | "virhe";
/** Mockattu palvelin: värireitti, synkronointi, luonnoslaatikko ja kuvan tulkinta. Muut reitit 404 (näkyy konsolissa). */
async function palvelin(
  page: Page,
  vari: string = "paperi",
  kuva: Kuva = "ok",
) {
  const pyynnot: { polku: string; runko: Buffer | null }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      polku = new URL(req.url()).pathname;
    pyynnot.push({ polku, runko: req.postDataBuffer() });
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (polku === "/api/ulkoasu") return json(200, { vari });
    if (polku === "/api/synk")
      return json(200, { muutokset: [], lisaa: false, seq: 0 });
    if (polku === "/api/luonnokset") return json(200, { luonnokset: [] });
    if (polku === "/api/kuva-ateria")
      return kuva === "ok"
        ? json(200, LUONNOS)
        : json(502, { virhe: TEKNINEN });
    return json(404, { virhe: "ei rajapintaa" });
  });
  return pyynnot;
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
});

test("kuvapolku: kuva, lisätieto, luonnos ja tallennus", async ({ page }) => {
  const virheet = await valvo(page);
  const pyynnot = await palvelin(page);
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

test("virhepolku: lyhyt suomenkielinen viesti, uusi yritys ja käsin kirjaus", async ({
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
