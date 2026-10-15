import { z } from "zod";
export function basePath(value = "/") {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value))
    throw new Error("APP_BASE_PATH tarvitsee muodon / tai /ravintopolku/.");
  return value;
}
export const configSchema = z.object({
  port: z.coerce.number().int().min(1024).max(65535).default(3001),
  host: z.enum(["127.0.0.1", "::1"]).default("127.0.0.1"),
  origin: z.url().default("http://localhost:3001"),
  devOrigin: z.url().default("http://localhost:5173"),
  base: z.string().default("/"),
  password: z.string().min(16).max(200),
  apiKey: z.string().default(""),
  model: z.string().max(200).default(""),
  imageInput: z.boolean().default(true),
  timeoutMs: z.coerce.number().int().min(1000).max(120000).default(60000),
  maxOutputTokens: z.coerce.number().int().min(512).max(8192).default(4096),
  dailyLimit: z.coerce.number().int().min(1).max(1000).default(30),
  integrationToken: z
    .string()
    .refine(
      (s) => !s || s.length >= 32,
      "Integraatioavain: vähintään 32 merkkiä.",
    )
    .default(""),
  stateDir: z.string().default("./server-state"),
  serveStatic: z.boolean().default(true),
  staticDir: z.string().default("./dist"),
});
export type ServerConfig = z.infer<typeof configSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const c = configSchema.parse({
    port: env.PORT,
    host: env.HOST,
    origin: env.APP_ORIGIN,
    devOrigin: env.DEV_ORIGIN,
    base: env.APP_BASE_PATH,
    password: env.APP_PASSWORD,
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    imageInput: env.OPENAI_IMAGE_INPUT !== "false",
    timeoutMs: env.AI_TIMEOUT_MS,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    dailyLimit: env.AI_DAILY_REQUEST_LIMIT,
    integrationToken: env.ILMARI_INTEGRATION_TOKEN,
    stateDir: env.APP_STATE_DIR,
    staticDir: env.APP_DIST_DIR,
  });
  c.base = basePath(c.base);
  for (const value of [c.origin, c.devOrigin]) {
    const u = new URL(value);
    if (u.origin !== value || u.username || u.password)
      throw new Error(
        "APP_ORIGIN ja DEV_ORIGIN ovat pelkkiä origineja ilman polkua.",
      );
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      )
    )
      throw new Error("Etäkäyttö vaatii HTTPS-originin.");
  }
  return c;
}
export class ServiceError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
