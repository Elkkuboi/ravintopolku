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
// Kielimallin ohjeet näytettäväksi (Asetukset → Promptit): palvelin antaa tekstit sellaisinaan, vain luku.
export const kehoteSchema = z.object({
  tunniste: z.string().min(1).max(40),
  otsikko: z.string().min(1).max(80),
  kuvaus: z.string().max(400),
  teksti: z.string().min(1).max(20000),
});
export const kehotteetSchema = z.object({
  kehotteet: z.array(kehoteSchema).max(20),
});
export type Kehote = z.infer<typeof kehoteSchema>;
