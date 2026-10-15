import { type AIDraft } from "./provider";
export const draftOrigin = (d: AIDraft, kind: "manual" | "api" | "ilmari") =>
  `${kind === "api" ? "Käyttäjän pyytämä AI-arvio" : kind === "ilmari" ? "ILMARIsta vastaanotettu tarkistettava arvio" : "Ulkoisesta AI:sta käyttäjän tuoma arvio"} (${d.provenance.provider}${d.provenance.model ? " / " + d.provenance.model : ""})`;
export const draftNotes = (d: AIDraft, inboxId?: string) => [
  ...(inboxId ? ["ILMARI-luonnos: " + inboxId] : []),
  ...(d.provenance.note ? ["Alkuperän lisätieto: " + d.provenance.note] : []),
  ...d.assumptions,
  ...d.unknowns.map((s) => "Tuntematon: " + s),
  ...d.questions.map((s) => "Kysymys: " + s),
];
