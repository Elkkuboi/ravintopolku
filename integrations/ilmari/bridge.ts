import { readFile, writeFile } from "node:fs/promises";
import { incomingSchema } from "../../src/ai/contracts";
import { aiJSONSchema } from "../../src/ai/provider";
const [action, file] = process.argv.slice(2);
try {
  if (action === "schema") {
    if (!file) throw new Error("Anna skeeman tiedostonimi.");
    await writeFile(file, JSON.stringify(aiJSONSchema, null, 2) + "\n", {
      flag: "wx",
    });
    console.log("Skeema kirjoitettu.");
  } else if (action === "submit") {
    if (!file) throw new Error("Anna tuloskuoren JSON-tiedosto.");
    const content = await readFile(file, "utf8");
    if (content.length > 500000) throw new Error("Tiedosto on liian suuri.");
    const envelope = incomingSchema.parse(JSON.parse(content));
    if (envelope.dataClass === "restricted")
      throw new Error("Rajoitettua dataa ei lähetetä tästä liitännästä.");
    const endpoint = process.env.RAVINTOPOLKU_URL,
      token = process.env.RAVINTOPOLKU_INTEGRATION_TOKEN;
    if (!endpoint || !token)
      throw new Error(
        "Määritä RAVINTOPOLKU_URL ja RAVINTOPOLKU_INTEGRATION_TOKEN palvelinprosessin ympäristöön.",
      );
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith("/")
    )
      throw new Error("Osoite on perus-URL, joka päättyy /-merkkiin.");
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("Etäyhteys tarvitsee HTTPS:n.");
    const response = await fetch(new URL("api/integrations/v1/drafts", url), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        "Vastaanotto epäonnistui (HTTP " + response.status + ").",
      );
    const result = (await response.json()) as { id?: string; state?: string };
    console.log(JSON.stringify({ id: result.id, state: result.state }));
  } else throw new Error("Käyttö: bridge.ts schema TIEDOSTO | submit TIEDOSTO");
} catch {
  console.error(
    "Liitäntä epäonnistui. Tarkista komento, validoitu tuloskuori, HTTPS-osoite ja palvelimen integraatioavain. Salaisuuksia tai tiedoston sisältöä ei tulostettu.",
  );
  process.exitCode = 1;
}
