import { z } from "zod";
import { draftSchema } from "./provider";
export const taskSchema = z.enum(["package", "portion", "suggestion"]);
export const imageSchema = z
  .object({
    mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
    base64: z
      .string()
      .min(4)
      .max(2800000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((s) => s.length % 4 === 0),
  })
  .strict();
export const analysisSchema = z
  .object({
    task: taskSchema,
    text: z.string().max(12000),
    image: imageSchema.nullable(),
    consent: z.literal(true),
  })
  .strict()
  .refine(
    (r) => r.text.trim().length > 0 || r.image !== null,
    "Anna kuva tai kuvaus.",
  );
export type AnalysisRequest = z.infer<typeof analysisSchema>;
export const providerInfoSchema = z.object({
  id: z.literal("openai"),
  name: z.string(),
  model: z.string(),
  capabilities: z.object({
    imageInput: z.boolean(),
    structuredOutput: z.boolean(),
  }),
  destination: z.string(),
});
export const statusSchema = z.object({
  available: z.boolean(),
  authenticated: z.boolean(),
  providers: z.array(providerInfoSchema),
  integrationEnabled: z.boolean(),
});
export type APIStatus = z.infer<typeof statusSchema>;
export const incomingSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    externalId: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/),
    dataClass: z.enum(["public", "private", "restricted"]),
    draft: draftSchema,
  })
  .strict();
export type IncomingDraft = z.infer<typeof incomingSchema>;
export const inboxItemSchema = z.object({
  id: z.string(),
  receivedAt: z.string(),
  envelope: incomingSchema,
});
export const inboxSchema = z.array(inboxItemSchema);
export type InboxItem = z.infer<typeof inboxItemSchema>;
