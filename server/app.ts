import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { analysisSchema, incomingSchema } from "../src/ai/contracts";
import { aiJSONSchema } from "../src/ai/provider";
import { localDay } from "../src/domain/dates";
import { type ServerConfig, ServiceError, basePath } from "./config";
import { analyze, validateImage, type Transport } from "./openai";
import { ServiceStore } from "./store";
const hash = (s: string) => createHash("sha256").update(s).digest();
const equals = (a: string, b: string) => timingSafeEqual(hash(a), hash(b));
export async function createApp(
  config: ServerConfig,
  dependencies: { transport?: Transport; store?: ServiceStore } = {},
) {
  config.base = basePath(config.base);
  if (
    config.serveStatic &&
    existsSync(resolve(config.staticDir, "manifest.webmanifest"))
  ) {
    const manifest = JSON.parse(
      readFileSync(resolve(config.staticDir, "manifest.webmanifest"), "utf8"),
    );
    if (manifest.scope !== config.base)
      throw new Error(
        "Buildin ja palvelimen peruspolut eroavat. Tarkista VITE_APP_BASE ja APP_BASE_PATH.",
      );
  }
  const app = Fastify({
    logger: false,
    bodyLimit: 3 * 1024 * 1024,
    requestTimeout: 150000,
    trustProxy: false,
  });
  const store = dependencies.store ?? new ServiceStore(config.stateDir),
    sessions = new Map<string, number>();
  let active = 0;
  const prefix = config.base + "api",
    origins = new Set([config.origin, config.devOrigin]),
    hosts = new Set(
      [...origins]
        .map((s) => new URL(s).host)
        .concat([
          `localhost:${config.port}`,
          `127.0.0.1:${config.port}`,
          `[::1]:${config.port}`,
        ]),
    );
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      error: "Liian monta pyyntöä. Odota hetki ennen uutta yritystä.",
    }),
  });
  app.addHook("onClose", () => store.close());
  const authenticated = (token: string | undefined) => {
    if (!token) return false;
    const key = hash(token).toString("hex"),
      expires = sessions.get(key);
    if (!expires || expires < Date.now()) {
      sessions.delete(key);
      return false;
    }
    return true;
  };
  app.addHook("onRequest", async (request, reply) => {
    if (!hosts.has(request.headers.host ?? ""))
      throw new ServiceError(421, "Palvelimen osoite ei kelpaa.");
    if (!request.url.startsWith(prefix + "/")) return;
    reply.header("Cache-Control", "no-store");
    const integration = request.url.startsWith(prefix + "/integrations/v1/");
    if (integration) {
      if (
        !config.integrationToken ||
        !equals(
          request.headers.authorization ?? "",
          "Bearer " + config.integrationToken,
        )
      )
        throw new ServiceError(401, "Integraation käyttöoikeus puuttuu.");
      if (request.headers.origin && !origins.has(request.headers.origin))
        throw new ServiceError(403, "Integraatiopyynnön alkuperä ei kelpaa.");
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      if (
        !origins.has(request.headers.origin ?? "") ||
        request.headers["x-ravintopolku"] !== "1"
      )
        throw new ServiceError(
          403,
          "Pyyntö sallitaan vain sovelluksen omalta sivulta.",
        );
      if (
        request.method !== "DELETE" &&
        !request.headers["content-type"]?.startsWith("application/json")
      )
        throw new ServiceError(415, "Pyyntö tarvitsee JSON-muodon.");
    }
    if (request.url === prefix + "/status" || request.url === prefix + "/login")
      return;
    if (!authenticated(request.cookies.ravintopolku_session))
      throw new ServiceError(401, "Kirjaudu AI-palveluun ensin.");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY");
    if (!request.url.startsWith(prefix + "/"))
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      );
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    const code =
      error instanceof ServiceError
        ? error.statusCode
        : error instanceof z.ZodError
          ? 422
          : ((error as { statusCode?: number }).statusCode ?? 500);
    const message =
      error instanceof ServiceError
        ? error.message
        : code === 429
          ? "Liian monta pyyntöä. Yritä hetken kuluttua."
          : code === 413
            ? "Pyyntö on liian suuri."
            : code === 422
              ? "Pyynnön rakenne tai arvot eivät kelpaa."
              : code === 400
                ? "Pyyntö ei ole kelvollista JSONia."
                : "Palvelu ei voinut käsitellä pyyntöä.";
    reply
      .code(code >= 400 && code <= 599 ? code : 500)
      .send({ error: message });
  });
  app.get(prefix + "/status", async (request) => {
    const auth = authenticated(request.cookies.ravintopolku_session);
    return {
      available: true,
      authenticated: auth,
      integrationEnabled: auth && !!config.integrationToken,
      providers:
        auth && config.apiKey && config.model
          ? [
              {
                id: "openai",
                name: "OpenAI API",
                model: config.model,
                capabilities: {
                  imageInput: config.imageInput,
                  structuredOutput: true,
                },
                destination: "OpenAI",
              },
            ]
          : [],
    };
  });
  app.post(
    prefix + "/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { password } = z
        .object({ password: z.string().max(200) })
        .strict()
        .parse(request.body);
      if (!equals(password, config.password))
        throw new ServiceError(401, "Palvelun salasana ei kelpaa.");
      for (const [key, expires] of sessions)
        if (expires < Date.now()) sessions.delete(key);
      if (sessions.size >= 8) sessions.delete(sessions.keys().next().value!);
      const token = randomBytes(32).toString("base64url");
      sessions.set(hash(token).toString("hex"), Date.now() + 8 * 3600000);
      reply.setCookie("ravintopolku_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.origin.startsWith("https:"),
        path: prefix,
        maxAge: 8 * 3600,
      });
      return { ok: true };
    },
  );
  app.post(prefix + "/logout", async (request, reply) => {
    if (request.cookies.ravintopolku_session)
      sessions.delete(
        hash(request.cookies.ravintopolku_session).toString("hex"),
      );
    reply.clearCookie("ravintopolku_session", {
      path: prefix,
      httpOnly: true,
      sameSite: "strict",
      secure: config.origin.startsWith("https:"),
    });
    return { ok: true };
  });
  app.post(
    prefix + "/ai/draft",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = analysisSchema.parse(request.body);
      if (!config.apiKey || !config.model)
        throw new ServiceError(
          503,
          "Määritä OpenAI-avain ja malli palvelimelle ensin.",
        );
      if (input.image && !config.imageInput)
        throw new ServiceError(422, "Mallin kuvasyöte ei ole käytössä.");
      validateImage(input);
      if (active >= 2)
        throw new ServiceError(
          429,
          "Kaksi AI-pyyntöä on jo käynnissä. Odota niiden valmistumista.",
        );
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), config.timeoutMs);
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });
      active++;
      try {
        store.reserve(localDay(), config.dailyLimit);
        return await analyze(
          config,
          input,
          controller.signal,
          dependencies.transport,
        );
      } finally {
        active--;
        clearTimeout(timer);
      }
    },
  );
  app.get(prefix + "/inbox", async () => store.list());
  app.delete(prefix + "/inbox/:id", async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    if (!store.dismiss(id))
      throw new ServiceError(404, "Luonnosta ei löytynyt.");
    return { ok: true };
  });
  app.get(prefix + "/integrations/v1/schema", async () => ({
    schemaVersion: 1,
    draftSchema: aiJSONSchema,
    accepts: ["public", "private"],
    automaticDiaryWrite: false,
  }));
  app.post(
    prefix + "/integrations/v1/drafts",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const envelope = incomingSchema.parse(request.body);
      if (envelope.dataClass === "restricted")
        throw new ServiceError(
          403,
          "Rajoitettua aiops-dataa ei oteta tämän integraation kautta vastaan.",
        );
      const result = store.receive(envelope);
      return reply.code(result.duplicate ? 200 : 201).send(result);
    },
  );
  if (
    config.serveStatic &&
    existsSync(resolve(config.staticDir, "index.html"))
  ) {
    await app.register(staticFiles, {
      root: resolve(config.staticDir),
      prefix: config.base,
      setHeaders: (res, file) => {
        if (file.endsWith("sw.js") || file.endsWith("index.html"))
          res.header("Cache-Control", "no-cache");
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === "GET" &&
        request.url.startsWith(config.base) &&
        !request.url.startsWith(prefix + "/") &&
        !/\.[a-z0-9]+(?:\?|$)/i.test(request.url)
      )
        return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Reittiä ei löytynyt." });
    });
  }
  return app;
}
