import { z } from "zod";
import { draftSchema } from "./provider";
// Luonnoslaatikko (aiops ADR-0026): työaseman palvelin antaa numerotunnisteen ja tunnistaa Tailscale-identiteetillä.
export const luonnosSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  externalId: z.string(),
  source: z.string(),
  saapunut: z.string(),
  draft: draftSchema,
});
export const luonnoksetSchema = z.object({
  luonnokset: z.array(luonnosSchema),
});
export type Luonnos = z.infer<typeof luonnosSchema>;
