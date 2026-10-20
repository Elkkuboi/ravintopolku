import { AIConnection } from "./AIConnection";
import { SyncPanel } from "./SyncPanel";
import { IntegrationInbox } from "./IntegrationInbox";
import { useAIStatus } from "../ai/useAIStatus";
import { type InboxItem } from "../ai/contracts";
import { useState, useEffect } from "react";
import {
  Download,
  Upload,
  ShieldCheck,
  Star,
  Pencil,
  Trash2,
  Plus,
} from "lucide-react";
import { type Dataset, type Food, stamped } from "../domain/model";
import { eraseAll, saveRecord, removeFood, removeTemplate } from "../data/db";
import {
  exportBackup,
  parseBackup,
  restoreBackup,
  download,
  type Backup,
} from "../data/backup";
import { csvExports } from "../data/csv";
import { localDay } from "../domain/dates";
import { formatNumber, goalForDay } from "../domain/nutrition";
import { Field, Modal, Form } from "./common";
import { useFormAction } from "./useFormAction";
export function SettingsView({
  data,
  onProfile,
  onFood,
  onDemo,
  notify,
  run,
  onIntegrationDraft,
}: {
  data: Dataset;
  onProfile: () => void;
  onFood: (f?: Food) => void;
  onDemo: () => void;
  notify: (s: string) => void;
  run: (f: () => Promise<void>) => Promise<void>;
  onIntegrationDraft: (item: InboxItem) => void;
}) {
  const {
    status: aiStatus,
    error: aiError,
    refresh: refreshAI,
  } = useAIStatus();
  const [backup, setBackup] = useState<Backup | null>(null),
    [restoreConfirmation, setRestoreConfirmation] = useState(""),
    [deleteConfirmation, setDeleteConfirmation] = useState(""),
    [showDelete, setShowDelete] = useState(false),
    [persistent, setPersistent] = useState<boolean | null>(null),
    [search, setSearch] = useState("");
  const { error, busy, execute } = useFormAction();
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersistent);
  }, []);
  const p = data.profiles[0],
    g = goalForDay(data.goals, localDay());
  async function exportNow() {
    const b = await exportBackup();
    download(JSON.stringify(b, null, 2), `ravintopolku-${localDay()}.json`);
    notify("Varmuuskopio ladattu. Säilytä tiedosto turvallisessa paikassa.");
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OMA POLKUSI</p>
          <h1>Asetukset</h1>
          <p className="muted">Tavoitteet, omat ruuat ja tietojen säilytys.</p>
        </div>
      </div>
      <section className="card">
        <div className="section-heading">
          <h2>Profiili ja tavoitteet</h2>
          <button className="secondary" onClick={onProfile}>
            <Pencil size={16} /> Muokkaa
          </button>
        </div>
        <p>
          {p?.name || "Oma profiili"} · {formatNumber(p?.height ?? null)} cm ·
          lähtöpaino {formatNumber(p?.startWeight ?? null)} kg
        </p>
        <p className="muted small">
          {g
            ? {
                track: "Ruokailutottumusten seuranta",
                maintain: "Painon ylläpito",
                lose: "Painon pudottaminen",
                gain: "Painon nostaminen",
              }[g.kind]
            : "Ei tavoitteita"}
        </p>
        <details>
          <summary>Tavoitehistoria ({data.goals.length})</summary>
          {[...data.goals]
            .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
            .map((goal) => (
              <p className="small" key={goal.id}>
                Alkaen {goal.effectiveDate}: energia{" "}
                {formatNumber(goal.nutrients.energy, 0)} kcal, proteiini{" "}
                {formatNumber(goal.nutrients.protein)} g, kuitu{" "}
                {formatNumber(goal.nutrients.fiber)} g
                {goal.targetWeight !== null
                  ? ` · painotavoite ${formatNumber(goal.targetWeight)} kg (${goal.targetDate})`
                  : ""}
              </p>
            ))}
        </details>
        <Field label="Ulkoasu">
          <select
            value={data.settings[0]?.theme ?? "system"}
            onChange={(e) =>
              void run(async () => {
                await saveRecord("settings", {
                  ...stamped(data.settings[0]),
                  theme: e.target.value as "light" | "dark" | "system",
                });
                notify("Ulkoasu tallennettu.");
              })
            }
          >
            <option value="system">Laitteen asetus</option>
            <option value="light">Vaalea</option>
            <option value="dark">Tumma</option>
          </select>
        </Field>
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>Omat ruuat</h2>
          <button className="secondary" onClick={() => onFood()}>
            <Plus size={16} /> Uusi ruoka
          </button>
        </div>
        <Field label="Hae ruokakirjastosta">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ruuan nimi"
          />
        </Field>
        {!data.foods.length && (
          <p className="muted">
            Tallenna usein käyttämäsi ruuat. Niiden arvot annetaan per 100 g.
          </p>
        )}
        {data.foods
          .filter((f) =>
            f.name
              .toLocaleLowerCase("fi")
              .includes(search.toLocaleLowerCase("fi")),
          )
          .map((f) => (
            <div className="library-row" key={f.id}>
              <div>
                <strong>{f.name}</strong>
                <small>
                  {f.state || "Valmistustila ei määritelty"} · {f.source}
                </small>
              </div>
              <button
                className="icon-button"
                aria-label={`${f.favorite ? "Poista suosikeista" : "Lisää suosikiksi"} ${f.name}`}
                onClick={() =>
                  void run(async () => {
                    await saveRecord("foods", {
                      ...f,
                      favorite: !f.favorite,
                      updatedAt: new Date().toISOString(),
                    });
                  })
                }
              >
                <Star size={19} fill={f.favorite ? "currentColor" : "none"} />
              </button>
              <button
                className="icon-button"
                aria-label={`Muokkaa ruokaa ${f.name}`}
                onClick={() => onFood(f)}
              >
                <Pencil size={18} />
              </button>
              <button
                className="icon-button"
                aria-label={`Poista ruoka ${f.name}`}
                onClick={() =>
                  void run(async () => {
                    if (
                      window.confirm(
                        `Poistetaanko ${f.name} kirjastosta? Aiemmat ateriat säilyvät.`,
                      )
                    )
                      await removeFood(f.id);
                  })
                }
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
      </section>
      <section className="card">
        <h2>Vakioateriat</h2>
        <p className="muted small">
          Vakioateria sisältää ruuat ja määrät. Voit tallentaa sen aterian
          valikosta.
        </p>
        {data.templates.map((t) => (
          <div className="library-row" key={t.id}>
            <div>
              <strong>{t.name}</strong>
              <small>{t.lines.length} ruokalajia</small>
            </div>
            <button
              className="icon-button"
              aria-label={`Poista vakioateria ${t.name}`}
              onClick={() =>
                void run(async () => {
                  if (window.confirm("Poistetaanko vakioateria?"))
                    await removeTemplate(t.id);
                })
              }
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>Varmuuskopio ja vienti</h2>
          <ShieldCheck size={23} />
        </div>
        <p>
          Tiedot ovat tämän selaimen tallennuksessa tällä laitteella. Vie
          varmuuskopio säännöllisesti ja ennen selaintietojen poistamista.
        </p>
        <p className="small muted">
          Varmuuskopio sisältää myös kuvat. Selain ei takaa tietojen säilymistä
          eikä sovellus synkronoi laitteiden välillä.
        </p>
        <div className="button-row">
          <button className="primary" onClick={() => void run(exportNow)}>
            <Download size={18} /> Vie JSON-varmuuskopio
          </button>
          <label className="secondary file-button">
            <Upload size={18} /> Palauta varmuuskopio
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void run(async () => {
                    if (f.size > 100 * 1024 * 1024)
                      throw new Error(
                        "Varmuuskopio on liian suuri (enintään 100 Mt).",
                      );
                    setBackup(parseBackup(await f.text()));
                    setRestoreConfirmation("");
                  });
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <h3>CSV analyysiä varten</h3>
        <div className="button-row">
          {(["meals", "weights", "days"] as const).map((key, i) => (
            <button
              className="secondary"
              key={key}
              onClick={() => {
                download(
                  csvExports(data)[key],
                  `ravintopolku-${key}-${localDay()}.csv`,
                  "text/csv;charset=utf-8",
                );
                notify("CSV-tiedosto ladattu.");
              }}
            >
              {["Ateriarivit", "Painot", "Päiväyhteenvedot"][i]}
            </button>
          ))}
        </div>
      </section>
      <SyncPanel />
      <section className="card">
        <h2>Tallennuksen tila</h2>
        <p className="muted small">
          {persistent === true
            ? "Selain on myöntänyt pysyvän tallennuksen. Varmuuskopio on silti tarpeen."
            : "Pysyvä tallennus ei ole myönnetty tai selain ei tue sitä."}
        </p>
        <button
          className="secondary"
          onClick={() =>
            void run(async () => {
              if (!navigator.storage?.persist) {
                notify("Selain ei tue pysyvän tallennuksen pyyntöä.");
                return;
              }
              const result = await navigator.storage.persist();
              setPersistent(result);
              notify(
                result
                  ? "Pysyvä tallennus myönnetty."
                  : "Selain ei myöntänyt pysyvää tallennusta. Vie varmuuskopio säännöllisesti.",
              );
            })
          }
        >
          Pyydä pysyvää tallennusta
        </button>
        <p className="small muted">
          Kuvat pysyvät laitteella, ellet erikseen lähetä valittua kuvaa
          AI-analyysiin.
        </p>
      </section>
      <section className="card">
        <h2>AI-palvelu ja ILMARI</h2>
        <AIConnection status={aiStatus} error={aiError} onRefresh={refreshAI} />
        <IntegrationInbox
          status={aiStatus}
          data={data}
          onOpen={onIntegrationDraft}
        />
      </section>
      <section className="card">
        <h2>Tutustu kokeilutilassa</h2>
        <p className="muted small">
          Eristetty esimerkkipäiväkirja näyttää kuvaajat. Omat kirjaukset
          säilyvät; esimerkkejä ei viedä varmuuskopioon.
        </p>
        <button className="secondary" onClick={onDemo}>
          Avaa kokeilutila
        </button>
      </section>
      <button className="danger-link" onClick={() => setShowDelete(true)}>
        Poista kaikki omat tiedot
      </button>
      {backup && (
        <Modal title="Varmuuskopion esikatselu" onClose={() => setBackup(null)}>
          <Form
            error={error}
            busy={busy}
            submit="Korvaa nykyiset tiedot"
            onSubmit={(e) => {
              e.preventDefault();
              void execute(async () => {
                if (restoreConfirmation !== "KORVAA")
                  throw new Error(
                    "Kirjoita KORVAA vahvistaaksesi palautuksen.",
                  );
                await restoreBackup(backup);
                setBackup(null);
                notify("Varmuuskopio palautettu kuvineen.");
              });
            }}
          >
            <p className="notice">
              Palautus korvaa kaikki nykyiset tiedot. Vie nykyisestä
              päiväkirjasta varmuuskopio ensin.
            </p>
            <p>
              Viety {backup.exportedAt.slice(0, 10)} ·{" "}
              {backup.data.meals.length} ateriaa · {backup.data.foods.length}{" "}
              ruokaa · {backup.data.weights.length} painomittausta ·{" "}
              {backup.data.photos.length} kuvaa
            </p>
            <button
              className="secondary"
              type="button"
              onClick={() => void run(exportNow)}
            >
              Vie nykyinen data ensin
            </button>
            <Field label="Kirjoita KORVAA vahvistaaksesi">
              <input
                required
                value={restoreConfirmation}
                onChange={(e) => setRestoreConfirmation(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </Form>
        </Modal>
      )}
      {showDelete && (
        <Modal
          title="Poista kaikki tiedot"
          onClose={() => setShowDelete(false)}
        >
          <Form
            error={error}
            busy={busy}
            submit="Poista lopullisesti"
            onSubmit={(e) => {
              e.preventDefault();
              void execute(async () => {
                if (deleteConfirmation !== "POISTA")
                  throw new Error("Kirjoita POISTA vahvistaaksesi.");
                await eraseAll();
                setShowDelete(false);
                notify("Omat tiedot poistettu.");
              });
            }}
          >
            <p>
              Kaikki profiilin tiedot, kirjaukset ja kuvat poistetaan. Vienti on
              ainoa tapa palauttaa ne.
            </p>
            <button
              className="secondary"
              type="button"
              onClick={() => void run(exportNow)}
            >
              Vie varmuuskopio ensin
            </button>
            <Field label="Kirjoita POISTA vahvistaaksesi">
              <input
                required
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
