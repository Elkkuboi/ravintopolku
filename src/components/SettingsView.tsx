import { AIConnection } from "./AIConnection";
import { SyncPanel } from "./SyncPanel";
import { IntegrationInbox } from "./IntegrationInbox";
import { useAIStatus } from "../ai/useAIStatus";
import { type Luonnos } from "../ai/contracts";
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
import { KUVA_ROOLIT, ROOLIN_NIMI, OLETUSROOLI } from "../ai/kuva-ateria";
import {
  VALMIIT_TAVOITTEET,
  TEKSTI_MAX,
  ehdotaTavoitteet,
  hyvaksyTavoite,
  profiiliKuvaus,
  tarkistaRajat,
  vertaaMakroja,
  ROOLIN_NIMI as EHDOTUKSEN_ROOLI,
  type TavoiteEhdotus,
} from "../ai/tavoitteet";
import {
  blankNutrientStrings,
  nutrientStrings,
  parseNutrients,
  type NutrientStrings,
} from "./form-values";
import {
  eraseAll,
  saveGoal,
  saveRecord,
  removeFood,
  removeTemplate,
} from "../data/db";
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
import { Field, Modal, Form, NutrientFields } from "./common";
import { useFormAction } from "./useFormAction";
/** Keskeneräinenkin syöte kelpaa vertailuun: kelvoton teksti on tyhjä arvo, ei virhe. */
function numerot(arvot: NutrientStrings) {
  const arvo = (s: string) => {
    const siistitty = s.trim(),
      n = Number(siistitty.replace(",", "."));
    return siistitty && Number.isFinite(n) ? n : null;
  };
  return {
    energy: arvo(arvot.energy),
    protein: arvo(arvot.protein),
    carbs: arvo(arvot.carbs),
    fat: arvo(arvot.fat),
  };
}
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
  onIntegrationDraft: (item: Luonnos) => void;
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
    [search, setSearch] = useState(""),
    [tavoiteKuvaus, setTavoiteKuvaus] = useState(""),
    [ehdotus, setEhdotus] = useState<TavoiteEhdotus | null>(null),
    [ehdotusArvot, setEhdotusArvot] = useState<NutrientStrings>(
      blankNutrientStrings(),
    );
  const { error, busy, execute } = useFormAction(),
    tavoite = useFormAction();
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersistent);
  }, []);
  const p = data.profiles[0],
    g = goalForDay(data.goals, localDay()),
    uusinPaino =
      [...data.weights].sort((a, b) => b.date.localeCompare(a.date))[0]?.kg ??
      null,
    makroVaroitus = ehdotus ? vertaaMakroja(numerot(ehdotusArvot)) : null;
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
                  ...data.settings[0],
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
        <Field
          label="Kuvantulkinta"
          hint="Kuvaa ateria -toiminnon malli: Hub päättää roolin takana olevan mallin, tai pakota pilvi tai paikallinen malli. Sama valinta on Ilmari Hubissa."
        >
          <select
            value={data.settings[0]?.kuvantulkinta ?? OLETUSROOLI}
            onChange={(e) =>
              void run(async () => {
                await saveRecord("settings", {
                  ...data.settings[0],
                  ...stamped(data.settings[0]),
                  theme: data.settings[0]?.theme ?? "system",
                  kuvantulkinta: e.target.value as (typeof KUVA_ROOLIT)[number],
                });
                notify("Kuvantulkinnan rooli tallennettu.");
              })
            }
          >
            {KUVA_ROOLIT.map((r) => (
              <option key={r} value={r}>
                {ROOLIN_NIMI[r]}
              </option>
            ))}
          </select>
        </Field>
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>Tavoitteet omin sanoin</h2>
        </div>
        <p className="muted small">
          Kirjoita tavoite vapaina sanoin tai valitse valmis kuvaus. Ilmari
          ehdottaa päivän energia- ja makrotavoitteet sekä lyhyen perustelun, ja
          sinä tarkistat luvut ennen tallentamista.
        </p>
        <Field
          label="Tavoite sanoin"
          hint="Esim. painon lievä pudotus tai rasvan muuttaminen lihakseksi — kirjota vapaasti."
        >
          <textarea
            rows={2}
            value={tavoiteKuvaus}
            maxLength={TEKSTI_MAX}
            placeholder="Kirjoita tavoite omin sanoin"
            onChange={(e) => setTavoiteKuvaus(e.target.value)}
          />
        </Field>
        <div className="button-row">
          {VALMIIT_TAVOITTEET.map((kuvaus) => (
            <button
              key={kuvaus}
              className="secondary"
              type="button"
              onClick={() => setTavoiteKuvaus(kuvaus)}
            >
              {kuvaus}
            </button>
          ))}
          <button
            className="primary"
            type="button"
            disabled={tavoite.busy}
            onClick={() =>
              void tavoite.execute(async () => {
                const tulos = await ehdotaTavoitteet(tavoiteKuvaus, {
                  profiili: profiiliKuvaus(p, {
                    weight: uusinPaino,
                    goalEnergy: g?.nutrients.energy ?? null,
                  }),
                });
                setEhdotus(tulos);
                setEhdotusArvot(
                  nutrientStrings({
                    ...tulos.ehdotus,
                    fiber: g?.nutrients.fiber ?? null,
                  }),
                );
              })
            }
          >
            {tavoite.busy ? "Ilmari ehdottaa…" : "Ehdota tavoitteet"}
          </button>
        </div>
        {tavoite.error && (
          <p className="error" role="alert">
            {tavoite.error}
          </p>
        )}
        {ehdotus && (
          <>
            <div className="notice">
              <p>
                <strong>Ilmari ehdottaa</strong>{" "}
                {ehdotus.perustelu || "perustelua ei saanut"}
              </p>
              <p className="small">
                {EHDOTUKSEN_ROOLI[ehdotus.rooli]}
                {ehdotus.malli ? ` · malli ${ehdotus.malli}` : ""} · voimaan{" "}
                {localDay()}
              </p>
              {ehdotus.oletukset.length > 0 && (
                <p className="small">{ehdotus.oletukset.join(" ")}</p>
              )}
              {makroVaroitus && <p>{makroVaroitus}</p>}
            </div>
            <NutrientFields value={ehdotusArvot} onChange={setEhdotusArvot} />
            <div className="button-row">
              <button
                className="primary"
                type="button"
                disabled={tavoite.busy}
                onClick={() =>
                  void tavoite.execute(async () => {
                    const arvot = parseNutrients(ehdotusArvot);
                    tarkistaRajat(arvot);
                    await saveGoal(hyvaksyTavoite(arvot, localDay(), g));
                    setEhdotus(null);
                    setTavoiteKuvaus("");
                    notify(
                      "Tavoitteet tallennettu. Korjaa lukuja tarvittaessa kohdassa Profiili ja tavoitteet.",
                    );
                  })
                }
              >
                Hyväksy ja tallenna
              </button>
              <button
                className="quiet"
                type="button"
                onClick={() => setEhdotus(null)}
              >
                Hylkää
              </button>
            </div>
            <p className="small muted">
              Hyväksyminen korvaa tämän päivän tavoitteen. Kuitu ja painotavoite
              säilyvät ennallaan.
            </p>
          </>
        )}
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
        <IntegrationInbox data={data} onOpen={onIntegrationDraft} />
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
