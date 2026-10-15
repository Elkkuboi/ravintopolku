import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { readConfig, type ServerConfig } from "../server/config";
import { ServiceStore } from "../server/store";
import { analyze, type Transport } from "../server/openai";
import { MockProvider } from "../src/ai/provider";
import { type AnalysisRequest } from "../src/ai/contracts";
import { localDay } from "../src/domain/dates";
const directories: string[] = [],
  apps: Awaited<ReturnType<typeof createApp>>[] = [];
const config = (extra: Partial<ServerConfig> = {}): ServerConfig => {
  const directory = mkdtempSync(join(tmpdir(), "ravintopolku-api-"));
  directories.push(directory);
  return {
    ...readConfig({
      APP_PASSWORD: "testi-salasana-123456789",
      APP_ORIGIN: "http://localhost:3001",
      OPENAI_API_KEY: "sk-palvelimen-testisalaisuus",
      OPENAI_MODEL: "testi-model",
      ILMARI_INTEGRATION_TOKEN: "testi-integraatio-token-123456789012345",
      APP_STATE_DIR: directory,
    }),
    serveStatic: false,
    ...extra,
  };
};
const input: AnalysisRequest = {
  task: "portion",
  text: "150 g puuroa",
  image: null,
  consent: true,
};
const success: Transport = async () =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(await new MockProvider().interpret()),
            },
          ],
        },
      ],
    }),
  );
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
async function application(c = config(), transport: Transport = success) {
  const app = await createApp(c, { transport });
  apps.push(app);
  await app.ready();
  return app;
}
const headers = {
  host: "localhost:3001",
  origin: "http://localhost:3001",
  "x-ravintopolku": "1",
  "content-type": "application/json",
};
async function session(app: Awaited<ReturnType<typeof createApp>>) {
  const r = await app.inject({
    method: "POST",
    url: "/api/login",
    headers,
    payload: { password: "testi-salasana-123456789" },
  });
  expect(r.statusCode).toBe(200);
  return r.cookies[0].value;
}
describe("AI-palvelun käyttöoikeudet", () => {
  it("avaimia tai malleja ei paljasteta ilman istuntoa; cookie HttpOnly ja SameSite", async () => {
    const app = await application();
    const status = await app.inject({
      url: "/api/status",
      headers: { host: "localhost:3001" },
    });
    expect(status.json().providers).toEqual([]);
    expect(status.body).not.toContain("sk-");
    const token = await session(app);
    expect(token.length).toBeGreaterThan(30);
    const r = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password: "testi-salasana-123456789" },
    });
    expect(r.headers["set-cookie"]).toContain("HttpOnly");
    expect(r.headers["set-cookie"]).toContain("SameSite=Strict");
  });
  it("väärä salasana, CSRF, väärä Host ja integraatioavain eivät anna AI-oikeutta", async () => {
    const app = await application();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password: "väärä" },
        })
      ).statusCode,
    ).toBe(401);
    const token = await session(app);
    for (const h of [
      { ...headers, origin: "https://evil.invalid" },
      { ...headers, "x-ravintopolku": "" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/ai/draft",
            headers: h,
            cookies: { ravintopolku_session: token },
            payload: input,
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/status",
          headers: { host: "evil.invalid" },
        })
      ).statusCode,
    ).toBe(421);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/ai/draft",
          headers: {
            ...headers,
            authorization: "Bearer testi-integraatio-token-123456789012345",
          },
          payload: input,
        })
      ).statusCode,
    ).toBe(401);
  });
  it("HTTPS-istunto on Secure ja uloskirjautuminen mitätöi istunnon", async () => {
    const app = await application(
      config({ origin: "https://ravintopolku.example" }),
    );
    const h = { ...headers, origin: "https://ravintopolku.example" };
    const r = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: h,
      payload: { password: "testi-salasana-123456789" },
    });
    expect(r.headers["set-cookie"]).toContain("Secure");
    const token = r.cookies[0].value;
    await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: h,
      cookies: { ravintopolku_session: token },
      payload: {},
    });
    expect(
      (
        await app.inject({
          url: "/api/inbox",
          headers,
          cookies: { ravintopolku_session: token },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("suostumus ja kelvolliset arvot vaaditaan ennen provider-kutsua", async () => {
    let calls = 0;
    const app = await application(config(), async (...args) => {
      calls++;
      return success(...args);
    });
    const token = await session(app);
    for (const payload of [
      { ...input, consent: false },
      { ...input, text: "", image: null },
      { ...input, task: "execute-command" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/ai/draft",
            headers,
            cookies: { ravintopolku_session: token },
            payload,
          })
        ).statusCode,
      ).toBe(422);
    expect(calls).toBe(0);
  });
});
describe("OpenAI Responses -sopimus", () => {
  it("käyttää oikeaa endpointia ja schema-outputia, ei päiväkirjaa; alkuperä tulee palvelimelta", async () => {
    let sent: RequestInit | undefined;
    const c = config();
    const draft = await analyze(
      c,
      input,
      new AbortController().signal,
      async (url, options) => {
        expect(url).toBe("https://api.openai.com/v1/responses");
        sent = options;
        return success(url, options);
      },
    );
    const body = JSON.parse(String(sent!.body));
    expect(body.store).toBe(false);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
    expect(body.input[0].content[0].text).toContain("150 g");
    expect(String(sent!.body)).not.toContain(c.apiKey);
    expect(draft.provenance).toMatchObject({
      provider: "OpenAI API",
      model: "testi-model",
    });
    expect(JSON.stringify(draft)).not.toContain(c.apiKey);
  });
  it("kuva on rajattu data-URL; virheellinen kuva tai kuvakyvyttömyys estää kutsun", async () => {
    const png = readFileSync("public/icon-192.png").toString("base64");
    const c = config();
    await analyze(
      c,
      { ...input, image: { mime: "image/png", base64: png } },
      new AbortController().signal,
      async (_url, options) => {
        const body = JSON.parse(String(options.body));
        expect(body.input[0].content[1].image_url).toBe(
          "data:image/png;base64," + png,
        );
        return success("", {});
      },
    );
    await expect(
      analyze(
        { ...c, imageInput: false },
        { ...input, image: { mime: "image/png", base64: png } },
        new AbortController().signal,
        success,
      ),
    ).rejects.toThrow("kuvasyöte");
    await expect(
      analyze(
        c,
        {
          ...input,
          image: {
            mime: "image/png",
            base64: Buffer.from("ei oikea kuvadata").toString("base64"),
          },
        },
        new AbortController().signal,
        success,
      ),
    ).rejects.toThrow("ei kelpaa");
  });
  it("rikkinäinen JSON, negatiiviset arvot, refusal ja keskeneräinen output eivät avaudu luonnokseksi", async () => {
    const c = config();
    const d = await new MockProvider().interpret();
    d.lines[0].values.energy = -1;
    for (const body of [
      { output: [{ content: [{ type: "output_text", text: "{broken" }] }] },
      {
        output: [
          { content: [{ type: "output_text", text: JSON.stringify(d) }] },
        ],
      },
      { output: [{ content: [{ type: "refusal" }] }] },
      { status: "incomplete", output: [] },
    ])
      await expect(
        analyze(
          c,
          input,
          new AbortController().signal,
          async () => new Response(JSON.stringify(body)),
        ),
      ).rejects.toThrow();
  });
  it("providerin 401/429 ja verkkovirhe eivät vuoda avainta tai virheen raakatekstiä", async () => {
    const c = config();
    for (const status of [401, 429, 500]) {
      await expect(
        analyze(
          c,
          input,
          new AbortController().signal,
          async () =>
            new Response("salainen upstream response " + c.apiKey, { status }),
        ),
      ).rejects.not.toThrow(c.apiKey);
    }
    await expect(
      analyze(c, input, new AbortController().signal, async () => {
        throw new Error(c.apiKey);
      }),
    ).rejects.toThrow("yhteys");
  });
  it("aikaraja peruu upstream-kutsun ja palauttaa ymmärrettävän virheen", async () => {
    let aborted = false;
    const app = await application(
      config({ timeoutMs: 25 }),
      async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    );
    const token = await session(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/draft",
      headers,
      cookies: { ravintopolku_session: token },
      payload: input,
    });
    expect(response.statusCode).toBe(504);
    expect(aborted).toBe(true);
    expect(response.json().error).toContain("aikaraja");
  });
  it("pyyntökatto säilyy palvelun uudelleenkäynnistyksen yli", () => {
    const c = config({ dailyLimit: 1 });
    const store = new ServiceStore(c.stateDir);
    store.reserve(localDay(), 1);
    store.close();
    const again = new ServiceStore(c.stateDir);
    expect(() => again.reserve(localDay(), 1)).toThrow("katto");
    again.close();
  });
});
describe("ILMARI-tulosrajapinta", () => {
  it("idempotentti vastaanotto, ristiriita 409 ja rajattu integraatioavain", async () => {
    const c = config(),
      app = await application(c),
      draft = await new MockProvider().interpret();
    const h = {
      host: "localhost:3001",
      authorization: "Bearer " + c.integrationToken,
      "content-type": "application/json",
    };
    const payload = {
      schemaVersion: 1,
      source: "ilmari",
      externalId: "job-20",
      dataClass: "private",
      draft,
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/integrations/v1/drafts",
      headers: h,
      payload,
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/integrations/v1/drafts",
      headers: h,
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/integrations/v1/drafts",
          headers: h,
          payload: { ...payload, draft: { ...draft, name: "Muutettu" } },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ url: "/api/inbox", headers: h })).statusCode,
    ).toBe(401);
    const token = await session(app);
    const inbox = await app.inject({
      url: "/api/inbox",
      headers,
      cookies: { ravintopolku_session: token },
    });
    expect(inbox.json()).toHaveLength(1);
    expect(inbox.json()[0].envelope.draft.name).toBe(draft.name);
    const dismissed = await app.inject({
      method: "DELETE",
      url: "/api/inbox/" + first.json().id,
      headers: {
        host: headers.host,
        origin: headers.origin,
        "x-ravintopolku": "1",
      },
      cookies: { ravintopolku_session: token },
    });
    expect(dismissed.statusCode).toBe(200);
    const reviewed = await app.inject({
      method: "POST",
      url: "/api/integrations/v1/drafts",
      headers: h,
      payload,
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().state).toBe("already_reviewed");
  });
  it("käsitellyn luonnoksen sisältö poistuu; uudelleenlähetys ei palauta sitä", async () => {
    const c = config();
    const store = new ServiceStore(c.stateDir);
    const envelope = {
      schemaVersion: 1 as const,
      source: "ilmari",
      externalId: "testi-42",
      dataClass: "private" as const,
      draft: await new MockProvider().interpret(),
    };
    const first = store.receive(envelope);
    expect(store.dismiss(first.id)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(
      store.database
        .prepare("SELECT envelope FROM drafts WHERE id=?")
        .get(first.id)!.envelope,
    ).toBe("{}");
    expect(store.receive(envelope)).toEqual({
      id: first.id,
      duplicate: true,
      state: "already_reviewed",
    });
    store.close();
  });
  it("restricted, rikkinäinen luonnos ja väärä tunnus eivät kirjoita laatikkoon", async () => {
    const c = config(),
      app = await application(c),
      draft = await new MockProvider().interpret();
    const payload = {
      schemaVersion: 1,
      source: "ilmari",
      externalId: "job-21",
      dataClass: "restricted",
      draft,
    };
    const h = {
      host: "localhost:3001",
      authorization: "Bearer " + c.integrationToken,
      "content-type": "application/json",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/integrations/v1/drafts",
          headers: h,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/integrations/v1/drafts",
          headers: h,
          payload: { ...payload, dataClass: "public", draft: { bad: true } },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/integrations/v1/drafts",
          headers: { ...h, authorization: "Bearer väärä" },
          payload: { ...payload, dataClass: "public" },
        })
      ).statusCode,
    ).toBe(401);
    const token = await session(app);
    expect(
      (
        await app.inject({
          url: "/api/inbox",
          headers,
          cookies: { ravintopolku_session: token },
        })
      ).json(),
    ).toEqual([]);
  });
  it("alihakemiston API toimii vain omassa prefiksissään", async () => {
    const app = await application(config({ base: "/ravintopolku/" }));
    expect(
      (await app.inject({ url: "/ravintopolku/api/status", headers }))
        .statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/api/status", headers })).statusCode).toBe(
      404,
    );
  });
});
