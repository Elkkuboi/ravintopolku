import {
  draftSchema,
  type AIDraft,
  type AIProvider,
  type AITask,
} from "./provider";
import { statusSchema, type APIStatus } from "./contracts";
export const apiURL = (path: string) =>
  import.meta.env.BASE_URL + "api/" + path;
export async function apiRequest(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(apiURL(path), {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        "X-Ravintopolku": "1",
        ...options.headers,
      },
    });
  } catch (e) {
    if (options.signal?.aborted)
      throw new Error("Pyyntö keskeytetty. Voit jatkaa käsin.");
    throw e instanceof Error
      ? new Error(
          "AI-palveluun ei saada yhteyttä. Paikallinen päiväkirja toimii edelleen.",
        )
      : e;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "AI-palvelu ei ole käytettävissä tässä osoitteessa. Käynnistä palvelin tai jatka käsin.",
    );
  }
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : "Palvelupyyntö epäonnistui.";
    throw new Error(error);
  }
  return body;
}
export async function getStatus(): Promise<APIStatus> {
  return statusSchema.parse(await apiRequest("status"));
}
export const login = async (password: string) => {
  await apiRequest("login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  return getStatus();
};
export const logout = () =>
  apiRequest("logout", { method: "POST", body: "{}" });
async function encodeImage(blob: Blob) {
  if (blob.size > 2 * 1024 * 1024)
    throw new Error("Kuva on liian suuri (2 Mt).");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { mime: blob.type, base64: btoa(s) };
}
export class HttpProvider implements AIProvider {
  name = "OpenAI API";
  capabilities: { imageInput: boolean; structuredOutput: boolean };
  private signal?: AbortSignal;
  constructor(
    capabilities = { imageInput: true, structuredOutput: true },
    signal?: AbortSignal,
  ) {
    this.capabilities = capabilities;
    this.signal = signal;
  }
  async interpret(
    task: AITask,
    input: { text?: string; image?: Blob },
  ): Promise<AIDraft> {
    if (input.image && !this.capabilities.imageInput)
      throw new Error("Mallin kuvasyöte ei ole käytössä.");
    const body = await apiRequest("ai/draft", {
      method: "POST",
      body: JSON.stringify({
        task,
        text: input.text ?? "",
        image: input.image ? await encodeImage(input.image) : null,
        consent: true,
      }),
      signal: this.signal,
    });
    return draftSchema.parse(body);
  }
}
