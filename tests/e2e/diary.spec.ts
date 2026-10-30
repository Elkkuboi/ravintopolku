import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
const dialog = (page: Page) => page.getByRole("dialog");
async function profile(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Luo oma profiili" }).click();
  await dialog(page)
    .getByLabel("Nimi (vapaaehtoinen)", { exact: true })
    .fill("Aino");
  await dialog(page).getByLabel("Pituus (cm)").fill("170");
  await dialog(page).getByLabel("Lähtöpaino (kg)").fill("75,5");
  await dialog(page).getByRole("button", { name: "Aloita oma polku" }).click();
  await expect(page.getByRole("heading", { name: "Hei, Aino." })).toBeVisible();
}
async function addMeal(page: Page) {
  await page
    .getByRole("button", { name: "Lisää ruoka", exact: true })
    .first()
    .click();
}
async function portion(page: Page, name: string, energy: string) {
  await dialog(page)
    .getByRole("button", { name: "Annoksen kokonaisarvot" })
    .click();
  const item = dialog(page).locator(".line-editor").last();
  await item.getByLabel("Ruuan tai annoksen nimi").fill(name);
  await item.getByLabel("Energia (kcal)").fill(energy);
}
async function saveMeal(page: Page) {
  await dialog(page)
    .getByRole("button", { name: "Hyväksy ja tallenna ateria" })
    .click();
  await expect(dialog(page)).toHaveCount(0);
}
async function nav(page: Page, label: string) {
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: label, exact: true })
    .click();
}
test("profiili, kirjasto, moniosainen ateria, historia, vakioateria, paino, kuvaajat ja säilyminen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await profile(page);
  await addMeal(page);
  await dialog(page).getByRole("button", { name: "Luo oma ruoka" }).click();
  const food = page.getByRole("dialog", { name: "Luo oma ruoka" });
  await food.getByLabel("Ruuan nimi", { exact: true }).fill("Testipuuro");
  await food.getByLabel("Valmistustila").fill("Kypsä");
  await food.getByLabel("Energia (kcal)").fill("200");
  await food.getByLabel("Proteiini (g)").fill("10");
  await food.getByRole("checkbox", { name: "Lisää suosikkiruokiin" }).check();
  await food.getByRole("button", { name: "Tallenna ruoka" }).click();
  await dialog(page)
    .getByRole("button", { name: /Testipuuro/ })
    .click();
  await dialog(page).getByLabel("Syöty määrä (g)").fill("150");
  await portion(page, "Jogurtti", "100");
  await saveMeal(page);
  await expect(page.locator(".energy-value")).toContainText("400");
  await expect(page.locator(".missing-notice")).toContainText("kuitu");
  await expect(page.getByRole("heading", { name: "Makrot" })).toBeVisible();
  await expect(page.locator(".macro-chart")).toHaveCount(4);
  expect(
    await page.locator(".macro-chart.energy .recharts-bar-rectangle").count(),
  ).toBeGreaterThan(0);
  // Proteiinipäivä on osittainen → saman makron palkki raidoitetaan.
  await expect(
    page.locator(".macro-chart.protein .recharts-bar-rectangle path"),
  ).toHaveAttribute("fill", /^url\(#macro-partial-protein\)$/);
  await page.locator(".meal-actions summary").click();
  await page
    .locator(".action-menu")
    .getByRole("button", { name: "Muokkaa / siirrä" })
    .click();
  await dialog(page).getByLabel("Syöty määrä (g)").fill("125");
  await dialog(page)
    .getByRole("button", { name: "Tallenna muutokset" })
    .click();
  await expect(page.locator(".energy-value")).toContainText("350");
  await page.locator(".meal-actions summary").click();
  page.once("dialog", (d) => d.accept("Oma vakio"));
  await page.getByRole("button", { name: "Tallenna vakioateriaksi" }).click();
  await nav(page, "Asetukset");
  await page.getByRole("button", { name: "Muokkaa ruokaa Testipuuro" }).click();
  await dialog(page).getByLabel("Energia (kcal)").fill("900");
  await dialog(page).getByRole("button", { name: "Tallenna ruoka" }).click();
  await nav(page, "Tänään");
  await expect(page.locator(".energy-value")).toContainText("350");
  await addMeal(page);
  await dialog(page)
    .getByLabel("Käytä vakioateriaa")
    .selectOption({ label: "Oma vakio" });
  await saveMeal(page);
  await expect(page.locator(".energy-value")).toContainText("700");
  await page.getByRole("button", { name: "Kirjaa paino" }).click();
  await dialog(page).getByLabel("Paino (kg)").fill("75,2");
  await dialog(page)
    .getByRole("button", { name: "Tallenna paino", exact: true })
    .click();
  await expect(page.locator(".small-stat")).toContainText("75,2");
  await page
    .getByRole("button", { name: "Merkitse valmiiksi", exact: true })
    .click();
  await nav(page, "Kehitys");
  await expect(
    page.getByRole("heading", { name: "Painon suunta" }),
  ).toBeVisible();
  await expect(page.locator("tbody")).toContainText("75,2");
  await page.reload();
  await nav(page, "Tänään");
  await expect(page.locator(".energy-value")).toContainText("700");
  await expect(page.locator(".small-stat")).toContainText("75,2");
  await expect(page.locator(".coverage")).toContainText("valmiiksi");
  expect(errors).toEqual([]);
});
test("AI-virhe ei tallenna; muokattava tuonti vaatii hyväksynnän", async ({
  page,
}) => {
  await profile(page);
  await addMeal(page);
  await dialog(page)
    .getByText("Käsin käytettävä AI-tuonti", { exact: true })
    .click();
  await dialog(page).getByLabel("AI:n JSON-vastaus").fill("{broken");
  await dialog(page)
    .getByRole("button", { name: "Tarkista ja avaa luonnos" })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("JSON");
  expect(await page.locator(".meal-card").count()).toBe(0);
  const draft = {
    schemaVersion: 1,
    name: "Arvio",
    lines: [
      {
        name: "AI-annos",
        mode: "portion",
        grams: null,
        values: {
          energy: 300,
          protein: null,
          carbs: null,
          fat: null,
          fiber: null,
        },
        source: "Oma arvio",
        state: "",
      },
    ],
    unknowns: ["Massa"],
    assumptions: ["Arvio"],
    questions: [],
    provenance: {
      provider: "Ulkoinen",
      model: "Testimalli",
      note: "Tuotu arvio",
    },
  };
  await dialog(page)
    .getByLabel("AI:n JSON-vastaus")
    .fill(JSON.stringify(draft));
  await dialog(page)
    .getByRole("button", { name: "Tarkista ja avaa luonnos" })
    .click();
  await expect(dialog(page).getByLabel("Ruuan tai annoksen nimi")).toHaveValue(
    "AI-annos",
  );
  expect(await page.locator(".meal-card").count()).toBe(0);
  await saveMeal(page);
  await expect(page.locator(".meal-card")).toContainText("AI-annos");
  await page.locator(".meal-actions summary").click();
  await page.getByRole("button", { name: "Muokkaa / siirrä" }).click();
  await expect(dialog(page)).toContainText("Alkuperän lisätieto: Tuotu arvio");
});
test("JSON-vienti ja vahvistettu palautus sisältävät kuvan; CSV toimii", async ({
  page,
}) => {
  await profile(page);
  await addMeal(page);
  await portion(page, "Kuva-annos", "300");
  await dialog(page)
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("public/icon-192.png"));
  await expect(dialog(page).getByAltText("Aterian kuva")).toBeVisible();
  await saveMeal(page);
  await nav(page, "Asetukset");
  const fileEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Vie JSON-varmuuskopio" }).click();
  const file = await fileEvent;
  const temp = await file.path();
  expect(temp).toBeTruthy();
  await page.locator(".file-button input").setInputFiles(temp!);
  await expect(
    page.getByRole("dialog", { name: "Varmuuskopion esikatselu" }),
  ).toContainText("1 kuvaa");
  await dialog(page).getByLabel("Kirjoita KORVAA vahvistaaksesi").fill("EI");
  await dialog(page)
    .getByRole("button", { name: "Korvaa nykyiset tiedot" })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("KORVAA");
  await dialog(page)
    .getByLabel("Kirjoita KORVAA vahvistaaksesi")
    .fill("KORVAA");
  await dialog(page)
    .getByRole("button", { name: "Korvaa nykyiset tiedot" })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ateriarivit", exact: true }).click();
  expect((await csvEvent).suggestedFilename()).toContain(".csv");
  await nav(page, "Tänään");
  await expect(page.getByAltText("Lounas, aterian kuva")).toBeVisible();
  await expect(page.locator(".energy-value")).toContainText("300");
});
test("tuotantoversion offline-lataus, lisäys ja säilyminen", async ({
  page,
  context,
}) => {
  await profile(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hei, Aino." })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hei, Aino." })).toBeVisible();
  await addMeal(page);
  await portion(page, "Offline-annos", "250");
  await saveMeal(page);
  await page.reload();
  await expect(page.locator(".energy-value")).toContainText("250");
  await page.locator(".meal-actions summary").click();
  await page.getByRole("button", { name: "Muokkaa / siirrä" }).click();
  await dialog(page).getByLabel("Energia (kcal)").fill("280");
  await dialog(page)
    .getByRole("button", { name: "Tallenna muutokset" })
    .click();
  await nav(page, "Kehitys");
  await expect(page.locator("tbody")).toContainText("280");
  await context.setOffline(false);
});
test("360–430 px ja työpöytä: ei vaakavieritystä tai konsolivirheitä", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Tutustu kokeilutilassa" }).click();
  for (const width of [360, 393, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText("Kokeilutila · esimerkkidata")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const navBar =
      width > 760
        ? page.locator(".desktop-sidebar nav")
        : page.locator(".bottom-nav");
    // Päiväkirja-näkymä on poistettu: jäljellä on kolme välilehteä.
    await expect(navBar.getByRole("button")).toHaveCount(3);
    await expect(navBar.getByText("Päiväkirja")).toHaveCount(0);
    await navBar.getByRole("button", { name: "Kehitys", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Painon suunta" }),
    ).toBeVisible();
    expect(
      await page.locator('.recharts-line-dots circle[fill="#315b43"]').count(),
    ).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/kehitys-${width}.png`,
      fullPage: true,
    });
    await navBar.getByRole("button", { name: "Tänään", exact: true }).click();
    await page.screenshot({
      path: `test-results/tanaan-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("kopiointi, siirto, poisto, elintavat, painon päällekkäisyyden muokkaus ja tumma tila", async ({
  page,
}) => {
  await profile(page);
  const today = await page.locator(".day-selector input").inputValue();
  const previous = new Date(today + "T12:00:00Z");
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  await addMeal(page);
  await portion(page, "Siirrettävä annos", "300");
  await saveMeal(page);
  await page.locator(".meal-actions summary").click();
  page.once("dialog", (d) => d.accept(yesterday));
  await page.getByRole("button", { name: "Kopioi toiselle päivälle" }).click();
  await page.locator(".day-selector input").fill(yesterday);
  await expect(page.locator(".energy-value")).toContainText("300");
  await page.locator(".meal-actions summary").click();
  await page.getByRole("button", { name: "Muokkaa / siirrä" }).click();
  await dialog(page).getByLabel("Päivämäärä", { exact: true }).fill(today);
  await dialog(page)
    .getByRole("button", { name: "Tallenna muutokset" })
    .click();
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await page.locator(".day-selector input").fill(today);
  await expect(page.locator(".energy-value")).toContainText("600");
  await page.locator(".meal-actions summary").first().click();
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".action-menu")
    .first()
    .getByRole("button", { name: "Poista", exact: true })
    .click();
  await expect(page.locator(".energy-value")).toContainText("300");
  await page
    .locator(".daily-extras")
    .getByRole("button", { name: "Kirjaa", exact: true })
    .click();
  await dialog(page).getByLabel("Askeleet", { exact: true }).fill("4500");
  await dialog(page).getByLabel("Unen kesto (h)").fill("7,5");
  await dialog(page)
    .getByLabel("Nälkä (1 = vähäinen, 5 = voimakas)")
    .selectOption("3");
  await dialog(page)
    .getByRole("button", { name: "Tallenna", exact: true })
    .click();
  await expect(page.locator(".daily-extras")).toContainText("7,5");
  await page.getByRole("button", { name: "Kirjaa paino" }).click();
  await dialog(page).getByLabel("Paino (kg)").fill("75");
  await dialog(page)
    .getByRole("button", { name: "Tallenna paino", exact: true })
    .click();
  await page.locator(".day-selector input").fill(yesterday);
  await page.getByRole("button", { name: "Kirjaa paino" }).click();
  await dialog(page).getByLabel("Mittauspäivä").fill(today);
  await dialog(page).getByLabel("Paino (kg)").fill("80");
  page.once("dialog", (d) => d.accept());
  await dialog(page)
    .getByRole("button", { name: "Tallenna paino", exact: true })
    .click();
  await expect(dialog(page).getByLabel("Paino (kg)")).toHaveValue("75");
  await dialog(page).getByLabel("Paino (kg)").fill("74,8");
  await dialog(page)
    .getByRole("button", { name: "Tallenna paino", exact: true })
    .click();
  await page.locator(".day-selector input").fill(today);
  await expect(page.locator(".small-stat")).toContainText("74,8");
  await nav(page, "Asetukset");
  await page.getByLabel("Ulkoasu", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Avaa kokeilutila" }).click();
  await nav(page, "Tänään");
  await expect(page.getByText("Kokeilutila · esimerkkidata")).toBeVisible();
  await page.getByRole("button", { name: /Palaa omaan päiväkirjaan/ }).click();
  await expect(page.locator(".energy-value")).toContainText("300");
  await expect(page.locator(".small-stat")).toContainText("74,8");
});

test("virheellinen kuva näyttää virheen ja käsinkirjaus toimii edelleen", async ({
  page,
}) => {
  await profile(page);
  await addMeal(page);
  await portion(page, "Ilman kuvaa", "200");
  await dialog(page)
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "rikki.png",
      mimeType: "image/png",
      buffer: Buffer.from("tämä ei ole kuva"),
    });
  await expect(dialog(page).getByRole("alert")).toContainText(
    "Kuvaa ei voitu avata",
  );
  await saveMeal(page);
  await expect(page.locator(".energy-value")).toContainText("200");
});
test("päivän paino yhdellä kentällä: vapaa teksti, valinnaisuus ja epäselvä arvo", async ({
  page,
}) => {
  await profile(page);
  const kenttä = page.locator(".quick-paino input"),
    tallenna = page
      .locator(".quick-paino")
      .getByRole("button", { name: "Tallenna", exact: true });
  // Paino on valinnainen: näkymä ei täytä kenttää eikä tyhjää tallenneta.
  await expect(kenttä).toBeEmpty();
  await expect(tallenna).toBeDisabled();
  await kenttä.fill("paino 82,4");
  await expect(tallenna).toBeEnabled();
  await tallenna.click();
  await expect(page.locator(".small-stat")).toContainText("82,4");
  await expect(kenttä).toBeEmpty();
  // Saman päivän uusi lukema korvaa edellisen: yksi mittaus päivässä.
  await kenttä.fill("punnitsin itseni aamulla 82,9 kiloa");
  await tallenna.click();
  await expect(page.locator(".small-stat")).toContainText("82,9");
  await page.reload();
  await nav(page, "Tänään");
  await expect(page.locator(".small-stat")).toContainText("82,9");
  // Epäselvää tekstiä ei arvata: virhe kertoo ja vanha arvo jää näkyviin.
  await kenttä.fill("82,9 ja 90,1");
  await tallenna.click();
  await expect(page.locator(".quick-paino").getByRole("alert")).toContainText(
    "En löydä tekstistä painoa",
  );
  await expect(page.locator(".small-stat")).toContainText("82,9");
  // Kehitys näyttää punnitun päivän.
  await nav(page, "Kehitys");
  await expect(
    page.getByRole("heading", { name: "Painon suunta" }),
  ).toBeVisible();
  await expect(page.locator("tbody")).toContainText("82,9");
});
