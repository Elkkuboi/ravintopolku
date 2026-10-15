import { createApp } from "./app";
import { readConfig } from "./config";
process.umask(0o077);
try {
  const config = readConfig();
  const app = await createApp(config);
  await app.listen({ host: config.host, port: config.port });
  console.log(
    `Ravintopolun palvelu käynnissä: ${config.origin}${config.base}. OpenAI: ${config.apiKey && config.model ? "määritetty" : "ei määritetty"}.`,
  );
  let stopping = false;
  const close = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
} catch {
  console.error(
    "Palvelu ei käynnistynyt. Tarkista .env: APP_PASSWORD (vähintään 16 merkkiä), APP_ORIGIN, APP_BASE_PATH/VITE_APP_BASE, portti ja tallennushakemiston oikeudet.",
  );
  process.exitCode = 1;
}
