import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const template = await readFile(".env.example", "utf8");
try {
  await writeFile(
    ".env",
    template
      .replace(
        "APP_PASSWORD=\n",
        "APP_PASSWORD=" + randomBytes(24).toString("base64url") + "\n",
      )
      .replace(
        "ILMARI_INTEGRATION_TOKEN=\n",
        "ILMARI_INTEGRATION_TOKEN=" +
          randomBytes(32).toString("base64url") +
          "\n",
      ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    ".env luotu (0600). Aseta OPENAI_API_KEY ja OPENAI_MODEL paikallisesti tiedostoon. Sovelluksen palvelusalasana on APP_PASSWORD. Olemassa olevia palveluita ei muutettu.",
  );
} catch (e) {
  if (e.code === "EEXIST")
    console.log(".env on jo olemassa; sitä ei muutettu.");
  else throw e;
}
