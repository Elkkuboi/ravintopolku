import { test, expect, type Page } from "@playwright/test";
const password = "vain-e2e-testien-salasana";
const draft = {
  schemaVersion: 1,
  name: "Testisimulaation annos",
  lines: [
    {
      name: "Testisimulaation puuro",
      mode: "per100",
      grams: 150,
      values: { energy: 200, protein: 10, carbs: null, fat: null, fiber: null },
      source: "Kiinteä selainkoe, ei kuvan analyysi",
      state: "kypsä",
    },
  ],
  unknowns: ["Kuitu"],
  assumptions: ["Simulaatio"],
  questions: [],
  provenance: {
    provider: "Testisimulaatio",
    model: "fixture-only",
    note: "Kiinteä testitulos, ei oikea OpenAI-kutsu",
  },
};
async function profile(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Luo oma profiili" }).click();
  await page.getByRole("dialog").getByLabel("Pituus (cm)").fill("170");
  await page.getByRole("dialog").getByLabel("Lähtöpaino (kg)").fill("75");
  await page.getByRole("button", { name: "Aloita oma polku" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function settings(page: Page) {
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Asetukset", exact: true })
    .click();
}
async function connect(page: Page) {
  await page.getByLabel("AI-palvelun salasana").fill(password);
  await page
    .getByRole("button", { name: "Kirjaudu AI-palveluun", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Kirjaudu AI-palvelusta ulos" }),
  ).toBeVisible();
}
test("oikea palveluistunto ja API-luonnoksen hyväksyntä; kuva vain suostumuksella", async ({
  page,
}) => {
  await profile(page);
  await settings(page);
  await connect(page);
  // Provider response is deliberately simulated. Real cookie/login paths use the production service.
  await page.route("**/api/status", async (route) =>
    route.fulfill({
      json: {
        available: true,
        authenticated: true,
        integrationEnabled: true,
        providers: [
          {
            id: "openai",
            name: "Testisimulaatio",
            model: "fixture-only",
            capabilities: { imageInput: true, structuredOutput: true },
            destination: "Testisimulaatio",
          },
        ],
      },
    }),
  );
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/ai/draft", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: draft });
  });
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Tänään", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lisää ruoka", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/icon-192.png");
  await expect(modal.getByAltText("Aterian kuva")).toBeVisible();
  await modal.getByText("Pyydä AI-luonnos", { exact: true }).click();
  await modal
    .getByLabel("Kuvaus tekoälylle")
    .fill("Pakkauksen energia 200 kcal / 100 g, syöty 150 g");
  const button = modal.getByRole("button", {
    name: "Pyydä tarkistettava luonnos",
  });
  await expect(button).toBeDisabled();
  expect(sent).toHaveLength(0);
  await modal
    .getByRole("checkbox", {
      name: "Hyväksyn tämän syötteen lähettämisen AI-palveluun",
    })
    .check();
  await button.click();
  await expect(modal.getByLabel("Ruuan tai annoksen nimi")).toHaveValue(
    "Testisimulaation puuro",
  );
  expect(sent).toHaveLength(1);
  expect(sent[0].image).toBeNull();
  expect(sent[0].consent).toBe(true);
  expect(sent[0]).not.toHaveProperty("profile");
  expect(sent[0]).not.toHaveProperty("meals");
  await modal
    .getByRole("checkbox", { name: "Lähetä myös tämän aterian valittu kuva" })
    .check();
  page.once("dialog", (d) => d.accept());
  await button.click();
  await expect.poll(() => sent.length).toBe(2);
  expect((sent[1].image as { mime: string }).mime).toBe("image/jpeg");
  await expect(modal.getByLabel("Syöty määrä (g)")).toHaveValue("150");
  expect(await page.locator(".meal-card").count()).toBe(0);
  await modal.getByLabel("Syöty määrä (g)").fill("125");
  await modal
    .getByRole("button", { name: "Hyväksy ja tallenna ateria" })
    .click();
  await expect(page.locator(".energy-value")).toContainText("250");
  await page.reload();
  await expect(page.locator(".energy-value")).toContainText("250");
});
test("ILMARI-vastaanotto ei kirjaa automaattisesti; hyväksyntä ja idempotenssi", async ({
  page,
  request,
}) => {
  await profile(page);
  const envelope = {
    schemaVersion: 1,
    source: "ilmari-e2e",
    externalId: "e2e-" + Date.now(),
    dataClass: "private",
    draft,
  };
  const h = {
    Authorization: "Bearer vain-e2e-testien-integraatioavain-123456",
    "Content-Type": "application/json",
  };
  const result = await request.post("/api/integrations/v1/drafts", {
    headers: h,
    data: envelope,
  });
  expect(result.status()).toBe(201);
  const id = (await result.json()).id;
  const second = await request.post("/api/integrations/v1/drafts", {
    headers: h,
    data: envelope,
  });
  expect(second.status()).toBe(200);
  expect((await second.json()).id).toBe(id);
  expect(await page.locator(".meal-card").count()).toBe(0);
  await settings(page);
  await connect(page);
  await expect(
    page.getByText("Testisimulaation annos", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Avaa tarkistettavaksi" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Syöty määrä (g)")).toHaveValue("150");
  await expect(modal).toContainText("ILMARIsta vastaanotettu");
  await modal
    .getByRole("button", { name: "Hyväksy ja tallenna ateria" })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Avaa tarkistettavaksi" }),
  ).toHaveCount(0);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Tänään", exact: true })
    .click();
  await expect(page.locator(".energy-value")).toContainText("300");
  await page.reload();
  await expect(page.locator(".energy-value")).toContainText("300");
});
test("AI:n virhe jättää aterian ja kuvaajat käyttökelpoisiksi", async ({
  page,
}) => {
  await profile(page);
  await settings(page);
  await connect(page);
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: {
        available: true,
        authenticated: true,
        integrationEnabled: false,
        providers: [
          {
            id: "openai",
            name: "Testisimulaatio",
            model: "fixture-only",
            capabilities: { imageInput: false, structuredOutput: true },
            destination: "Testisimulaatio",
          },
        ],
      },
    }),
  );
  await page.route("**/api/ai/draft", (route) =>
    route.fulfill({
      status: 502,
      json: { error: "AI:n vastausrakenne ei kelpaa. Mitään ei tallennettu." },
    }),
  );
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Tänään", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lisää ruoka", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Pyydä AI-luonnos", { exact: true }).click();
  await modal.getByLabel("Kuvaus tekoälylle").fill("Ateria");
  await modal
    .getByRole("checkbox", {
      name: "Hyväksyn tämän syötteen lähettämisen AI-palveluun",
    })
    .check();
  await modal
    .getByRole("button", { name: "Pyydä tarkistettava luonnos" })
    .click();
  await expect(modal.getByRole("alert")).toContainText("Mitään ei tallennettu");
  expect(await page.locator(".meal-card").count()).toBe(0);
  await modal.getByRole("button", { name: "Annoksen kokonaisarvot" }).click();
  await modal.getByLabel("Ruuan tai annoksen nimi").fill("Käsin kirjattu");
  await modal.getByLabel("Energia (kcal)").fill("400");
  await modal
    .getByRole("button", { name: "Hyväksy ja tallenna ateria" })
    .click();
  await expect(page.locator(".energy-value")).toContainText("400");
});

test("viivästynyt AI-vastaus ei korvaa odotuksen aikana syötettyä ateriaa ilman vahvistusta", async ({
  page,
}) => {
  await profile(page);
  await settings(page);
  await connect(page);
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: {
        available: true,
        authenticated: true,
        integrationEnabled: false,
        providers: [
          {
            id: "openai",
            name: "Testisimulaatio",
            model: "fixture-only",
            capabilities: { imageInput: false, structuredOutput: true },
            destination: "Testisimulaatio",
          },
        ],
      },
    }),
  );
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ai/draft", async (route) => {
    await gate;
    await route.fulfill({ json: draft });
  });
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Tänään", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lisää ruoka", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Pyydä AI-luonnos", { exact: true }).click();
  await modal.getByLabel("Kuvaus tekoälylle").fill("Ateria");
  await modal
    .getByRole("checkbox", {
      name: "Hyväksyn tämän syötteen lähettämisen AI-palveluun",
    })
    .check();
  await modal
    .getByRole("button", { name: "Pyydä tarkistettava luonnos" })
    .click();
  await expect(
    modal.getByRole("button", { name: "Keskeytä pyyntö" }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Annoksen kokonaisarvot" }).click();
  await modal
    .getByLabel("Ruuan tai annoksen nimi")
    .fill("Odotuksen aikana kirjattu");
  await modal.getByLabel("Energia (kcal)").fill("350");
  let confirmations = 0;
  page.once("dialog", async (d) => {
    confirmations++;
    await d.dismiss();
  });
  release();
  await expect.poll(() => confirmations).toBe(1);
  await expect(modal.getByLabel("Ruuan tai annoksen nimi")).toHaveValue(
    "Odotuksen aikana kirjattu",
  );
  await modal
    .getByRole("button", { name: "Hyväksy ja tallenna ateria" })
    .click();
  await expect(page.locator(".energy-value")).toContainText("350");
});
