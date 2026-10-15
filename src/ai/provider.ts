import { z } from "zod";
import { rawLineSchema, APP_VERSION } from "../domain/model";
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
export type AITask = "package" | "portion" | "suggestion";
export interface AIProvider {
  name: string;
  capabilities: { imageInput: boolean; structuredOutput: boolean };
  interpret(
    task: AITask,
    input: { text?: string; image?: Blob },
  ): Promise<AIDraft>;
}
export class DisabledProvider implements AIProvider {
  name = "Ei käytössä";
  capabilities = { imageInput: false, structuredOutput: false };
  async interpret(): Promise<AIDraft> {
    throw new Error(
      "Automaattinen analyysi ei ole käytössä. Kirjaa käsin tai tuo itse tarkistettava JSON-luonnos.",
    );
  }
}
export class MockProvider implements AIProvider {
  name = "Simulaatio";
  capabilities = { imageInput: false, structuredOutput: true };
  async interpret(): Promise<AIDraft> {
    return {
      schemaVersion: 1,
      name: "Simuloitu testiannos",
      lines: [
        {
          name: "Testiruoka",
          mode: "portion",
          grams: null,
          values: {
            energy: 300,
            protein: 15,
            carbs: null,
            fat: null,
            fiber: null,
          },
          source: "Kiinteä simulaatio, ei kuva-analyysi",
          state: "",
        },
      ],
      unknowns: ["Hiilihydraatit, rasva ja kuitu"],
      assumptions: ["Kiinteä testiesimerkki"],
      questions: ["Tarkista tiedot"],
      provenance: {
        provider: "MockProvider",
        model: null,
        note: "Simulaatio, ei kuvan analyysi",
      },
    };
  }
}
export const provider: AIProvider = new DisabledProvider();
export function parseDraft(text: string): AIDraft {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error(
      "Vastaus ei ole kelvollista JSONia. Liitä vain JSON-objekti ilman koodiaitoja.",
    );
  }
  const result = draftSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      "Luonnoksen rakenne tai arvot eivät kelpaa: " +
        result.error.issues
          .slice(0, 3)
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("; "),
    );
  return result.data;
}
export const aiJSONSchema = z.toJSONSchema(draftSchema);
export function aiPrompt() {
  return `Ravintopolku ${APP_VERSION}: laadi aterialuonnos suomeksi. Palauta vain tämän JSON-skeeman mukainen JSON-objekti. Älä anna HTML:ää tai suoritettavaa koodia. Erota pakkauksen arvot per 100 g (mode: per100, grams: syöty massa tai null, jos massa puuttuu) annoksen kokonaisarvoista (mode: portion). Jätä kaikki tuntemattomat ravintoarvot nulliksi, ei nollaksi. Älä päättele tarkkaa massaa kuvasta äläkä muunna millilitroja grammoiksi ilman tunnettua tiheyttä. Ilmoita kuiva/kypsä tila, lähde, oletukset, puuttuvat tiedot ja tarkentavat kysymykset. Älä keksi varmuusprosentteja. Älä laske ateriasummia: sovellus laskee ne. Luonnos vaatii käyttäjän tarkistuksen.\n\nJSON-skeema (versio 1):\n${JSON.stringify(aiJSONSchema, null, 2)}`;
}
