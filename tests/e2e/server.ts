import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../../server/config";
import { createApp } from "../../server/app";
const directory = mkdtempSync(join(tmpdir(), "ravintopolku-e2e-"));
const config = readConfig({
  APP_PASSWORD: "vain-e2e-testien-salasana",
  APP_ORIGIN: "http://127.0.0.1:4173",
  DEV_ORIGIN: "http://127.0.0.1:5173",
  PORT: "4173",
  ILMARI_INTEGRATION_TOKEN: "vain-e2e-testien-integraatioavain-123456",
  APP_STATE_DIR: directory,
});
const app = await createApp(config);
await app.listen({ host: "127.0.0.1", port: 4173 });
process.once(
  "SIGTERM",
  () =>
    void app.close().finally(() => {
      rmSync(directory, { recursive: true, force: true });
      process.exit(0);
    }),
);
