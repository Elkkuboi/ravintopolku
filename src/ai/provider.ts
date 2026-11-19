// Aterialuonnoksen rakenne (versio 1): kuvan tulkinnan vastaus (/api/kuva-ateria) ja Ilmarin odottavat luonnokset
// (/api/luonnokset) tarkistetaan tällä. JSON-muoto: docs/ai-draft.schema.json (npm run schema).
import { z } from "zod";
import { rawLineSchema } from "../domain/model";
export const draftSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(200),
    lines: z
      .array(rawLineSchema.omit({ id: true, foodId: true }))
      .min(1)
      .max(100),
    unknowns: z.array(z.string().max(2000)).max(100),
    assumptions: z.array(z.string().max(2000)).max(100),
    questions: z.array(z.string().max(2000)).max(100),
    provenance: z
      .object({
        provider: z.string().min(1).max(200),
        model: z.string().max(200).nullable(),
        note: z.string().max(2000),
      })
      .strict(),
  })
  .strict();
export type AIDraft = z.infer<typeof draftSchema>;
export const aiJSONSchema = z.toJSONSchema(draftSchema);
