import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { createApp } from "../server/app";
import { readConfig } from "../server/config";
const directory = mkdtempSync(join(tmpdir(), "ravintopolku-subpath-"));
const staticDir = join(directory, "dist");
const port = 4184;
const origin = `http://127.0.0.1:${port}`;
const base = "/ravintopolku/";
const token = "vain-subpath-testin-rajattu-integraatioavain";
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  execFileSync("npm", ["exec", "vite", "build", "--", "--outDir", staticDir], {
    env: { ...process.env, VITE_APP_BASE: base },
    stdio: "pipe",
  });
  const config = readConfig({
    PORT: String(port),
    APP_PASSWORD: "vain-subpath-testin-salasana",
    APP_ORIGIN: origin,
    APP_BASE_PATH: base,
    APP_DIST_DIR: staticDir,
    APP_STATE_DIR: join(directory, "state"),
    ILMARI_INTEGRATION_TOKEN: token,
  });
  app = await createApp(config);
  await app.listen({ host: "127.0.0.1", port });
  assert.equal((await fetch(origin + "/api/status")).status, 404);
  assert.equal((await fetch(origin + base + "api/status")).status, 200);
  const manifest = (await (
    await fetch(origin + base + "manifest.webmanifest")
  ).json()) as { scope: string; start_url: string; icons: { src: string }[] };
  assert.equal(manifest.scope, base);
  assert.equal(manifest.start_url, base);
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith(base)));
  const schema = join(directory, "draft.schema.json");
  execFileSync(
    "node",
    ["--import", "tsx", "integrations/ilmari/bridge.ts", "schema", schema],
    { stdio: "pipe" },
  );
  const { stdout: result } = await promisify(execFile)(
    "node",
    [
      "--import",
      "tsx",
      "integrations/ilmari/bridge.ts",
      "submit",
      "integrations/ilmari/example-result.json",
    ],
    {
      env: {
        ...process.env,
        RAVINTOPOLKU_URL: origin + base,
        RAVINTOPOLKU_INTEGRATION_TOKEN: token,
      },
      encoding: "utf8",
    },
  );
  assert.equal(JSON.parse(result).state, "pending_review");
  const login = await app.inject({
    method: "POST",
    url: base + "api/login",
    headers: {
      host: `127.0.0.1:${port}`,
      origin,
      "x-ravintopolku": "1",
      "content-type": "application/json",
    },
    payload: { password: config.password },
  });
  const inbox = await app.inject({
    url: base + "api/inbox",
    headers: { host: `127.0.0.1:${port}` },
    cookies: { ravintopolku_session: login.cookies[0].value },
  });
  assert.equal(inbox.json().length, 1);
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    locale: "fi-FI",
    timezoneId: "Europe/Helsinki",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + base);
  await page.getByRole("button", { name: "Luo oma profiili" }).waitFor();
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.active,
  );
  const scopes = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope),
  );
  assert.deepEqual(scopes, [origin + base]);
  await page.reload();
  await page.getByRole("button", { name: "Luo oma profiili" }).waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Luo oma profiili" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Alihakemiston tuotantokäännös, reitit, manifest/SW-scope, offline-käynnistys ja ILMARI CLI: OK",
  );
} finally {
  await browser?.close();
  await app?.close();
  rmSync(directory, { recursive: true, force: true });
}
