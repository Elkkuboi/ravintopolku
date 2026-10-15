import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
const server = await createServer({
  server: { middlewareMode: true, ws: false, hmr: false },
  appType: "custom",
});
try {
  const { incomingSchema } = await server.ssrLoadModule("/src/ai/contracts.ts");
  const { z } = await import("zod");
  const body = z.toJSONSchema(incomingSchema);
  const document = {
    openapi: "3.1.0",
    info: {
      title: "Ravintopolku – ILMARI-tulosliitäntä",
      version: "1.0.0",
      description:
        "Vastaanottaa tarkistettavia aterialuonnoksia. Ei työjonoa, hyväksyntävaltaa tai automaattista päiväkirjakirjoitusta.",
    },
    servers: [{ url: "/api/integrations/v1" }],
    security: [{ integrationToken: [] }],
    components: {
      securitySchemes: {
        integrationToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque scoped token",
        },
      },
      schemas: { IncomingDraft: body },
    },
    paths: {
      "/schema": {
        get: {
          summary: "Luonnoksen skeema ja rajat",
          responses: {
            200: { description: "Skeema ja kyvykkyydet" },
            401: { description: "Integraatioavain puuttuu" },
          },
        },
      },
      "/drafts": {
        post: {
          summary: "Jätä muokattava luonnos käyttäjän tarkistettavaksi",
          description:
            "source + externalId on idempotenssiavain 7 päivän säilytysajan sisällä. restricted hylätään. Integraatioavain ei oikeuta OpenAI-kutsuihin tai päiväkirjan lukemiseen.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/IncomingDraft" },
              },
            },
          },
          responses: {
            201: { description: "state=pending_review ja id" },
            200: {
              description:
                "Sama aiemmin vastaanotettu luonnos; state=pending_review tai already_reviewed",
            },
            401: { description: "Väärä avain" },
            403: { description: "restricted ei ole sallittu" },
            409: { description: "Sama externalId, eri sisältö" },
            422: { description: "Virheellinen luonnos" },
            429: { description: "Käyttö- tai laatikkoraja" },
          },
        },
      },
    },
  };
  await writeFile(
    "docs/ilmari.openapi.json",
    JSON.stringify(document, null, 2) + "\n",
  );
  await writeFile(
    "integrations/ilmari/result.schema.json",
    JSON.stringify(body, null, 2) + "\n",
  );
  console.log("ILMARI-tuloskuori ja OpenAPI-sopimus päivitetty.");
} finally {
  await server.close();
}
