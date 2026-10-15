import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { type IncomingDraft, type InboxItem } from "../src/ai/contracts";
import { ServiceError } from "./config";
export class ServiceStore {
  readonly database: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const file = resolve(directory, "service.sqlite");
    this.database = new DatabaseSync(file);
    chmodSync(file, 0o600);
    const version = Number(
      this.database.prepare("PRAGMA user_version").get()!.user_version,
    );
    if (version > 1) {
      this.database.close();
      throw new Error("Tuntematon palvelukannan versio.");
    }
    this.database.exec(
      `PRAGMA journal_mode=WAL; PRAGMA user_version=1; CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, source TEXT NOT NULL,external_id TEXT NOT NULL,digest TEXT NOT NULL,received_at TEXT NOT NULL,envelope TEXT NOT NULL,dismissed INTEGER NOT NULL DEFAULT 0,UNIQUE(source,external_id)); CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY,requests INTEGER NOT NULL);`,
    );
  }
  reserve(day: string, limit: number) {
    this.database
      .prepare("INSERT OR IGNORE INTO usage(day,requests) VALUES(?,0)")
      .run(day);
    const r = this.database
      .prepare(
        "UPDATE usage SET requests=requests+1 WHERE day=? AND requests<?",
      )
      .run(day, limit);
    if (!r.changes)
      throw new ServiceError(
        429,
        "Päivän AI-pyyntökatto on täynnä. Voit edelleen kirjata käsin.",
      );
    this.database
      .prepare("DELETE FROM usage WHERE day<?")
      .run(new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10));
  }
  receive(envelope: IncomingDraft) {
    this.prune();
    const digest = createHash("sha256")
      .update(JSON.stringify(envelope))
      .digest("hex");
    const previous = this.database
      .prepare(
        "SELECT id,digest,dismissed FROM drafts WHERE source=? AND external_id=?",
      )
      .get(envelope.source, envelope.externalId);
    if (previous) {
      if (previous.digest !== digest)
        throw new ServiceError(
          409,
          "Samaa ulkoista tunnistetta ei voi käyttää eri luonnokselle.",
        );
      return {
        id: String(previous.id),
        duplicate: true,
        state: previous.dismissed ? "already_reviewed" : "pending_review",
      };
    }
    const count = this.database
      .prepare("SELECT COUNT(*) AS count FROM drafts WHERE dismissed=0")
      .get()!;
    if (Number(count.count) >= 100)
      throw new ServiceError(
        429,
        "Luonnoslaatikko on täynnä. Käsittele aiemmat luonnokset ensin.",
      );
    const id = randomUUID();
    this.database
      .prepare(
        "INSERT INTO drafts(id,source,external_id,digest,received_at,envelope) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        envelope.source,
        envelope.externalId,
        digest,
        new Date().toISOString(),
        JSON.stringify(envelope),
      );
    return { id, duplicate: false, state: "pending_review" };
  }
  prune() {
    this.database
      .prepare("DELETE FROM drafts WHERE received_at<?")
      .run(new Date(Date.now() - 7 * 86400000).toISOString());
  }
  list(): InboxItem[] {
    this.prune();
    return this.database
      .prepare(
        "SELECT id,received_at,envelope FROM drafts WHERE dismissed=0 ORDER BY received_at DESC",
      )
      .all()
      .map((r) => ({
        id: String(r.id),
        receivedAt: String(r.received_at),
        envelope: JSON.parse(String(r.envelope)) as IncomingDraft,
      }));
  }
  dismiss(id: string) {
    return (
      this.database
        .prepare("UPDATE drafts SET dismissed=1,envelope='{}' WHERE id=?")
        .run(id).changes > 0
    );
  }
  close() {
    this.database.close();
  }
}
