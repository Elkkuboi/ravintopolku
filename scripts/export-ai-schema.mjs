import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
try {
  const { aiJSONSchema } = await server.ssrLoadModule("/src/ai/provider.ts");
  await writeFile(
    "docs/ai-draft.schema.json",
    JSON.stringify(aiJSONSchema, null, 2) + "\n",
  );
  console.log("AI-luonnoksen version 1 skeema päivitetty.");
} finally {
  await server.close();
}
