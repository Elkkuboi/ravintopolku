import { type AIDraft } from "./ai/provider";
import { poistaLuonnos } from "./ai/luonnokset";
import { connectionChanged } from "./ai/useAIStatus";
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useAutoSync } from "./data/useAutoSync";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  Leaf,
  Sun,
  BookOpen,
  TrendingUp,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  Scale,
  Check,
  Pencil,
  Copy,
  Trash2,
  ArrowRight,
  Utensils,
  Heart,
  Bookmark,
} from "lucide-react";
import {
  type Meal,
  type Food,
  keys,
  labels,
  stamped,
  id,
} from "./domain/model";
import { localDay, displayDay, addDays, wallTimestamp } from "./domain/dates";
import {
  dayTotals,
  mealTotals,
  formatNumber,
  goalForDay,
} from "./domain/nutrition";
import {
  readDataset,
  saveRecord,
  deleteMeal,
  saveMeal,
  storageError,
  defaultMealTime,
} from "./data/db";
import { demoDataset } from "./data/demo";
import { ProfileForm } from "./components/ProfileForm";
import { FoodForm } from "./components/FoodForm";
import { MealEditor } from "./components/MealEditor";
import { WeightForm, LifestyleForm } from "./components/DailyForms";
const Progress = lazy(() =>
  import("./components/Progress").then((m) => ({ default: m.Progress })),
);
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((m) => ({
    default: m.SettingsView,
  })),
);
import { Modal, BlobImage } from "./components/common";
type Tab = "today" | "diary" | "progress" | "settings";
type Dialog =
  | { kind: "profile" }
  | { kind: "meal"; meal?: Meal; initialDraft?: AIDraft; inboxId?: string }
  | { kind: "food"; food?: Food }
  | { kind: "weight" }
  | { kind: "lifestyle" }
  | null;
const tabs = [
  { id: "today", label: "Tänään", icon: Sun },
  { id: "diary", label: "Päiväkirja", icon: BookOpen },
  { id: "progress", label: "Kehitys", icon: TrendingUp },
  { id: "settings", label: "Asetukset", icon: Settings },
] as const;
export default function App() {
  useAutoSync();
  const real = useLiveQuery(() => readDataset(), []),
    [demo, setDemo] = useState(false),
    example = useMemo(() => demoDataset(), []),
    [tab, setTab] = useState<Tab>("today"),
    [date, setDate] = useState(localDay()),
    [dialog, setDialog] = useState<Dialog>(null),
    [nestedFood, setNestedFood] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState("");
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  const data = demo ? example : real;
  const notify = (s: string) => setToast(s);
  const run = async (f: () => Promise<void>) => {
    setError("");
    try {
      await f();
    } catch (e) {
      setError(storageError(e));
    }
  };
  const saved = () => {
    if (dialog?.kind === "meal" && dialog.inboxId)
      void poistaLuonnos(dialog.inboxId)
        .then(() => connectionChanged())
        .catch(() =>
          notify(
            "Ateria tallennettu laitteelle. Luonnos jäi palvelimen laatikkoon; merkitse se käsitellyksi myöhemmin.",
          ),
        );
    setDialog(null);
    notify("Tallennettu.");
    void navigator.storage?.persist?.().catch(() => {});
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const theme = data?.settings[0]?.theme ?? "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data?.settings]);
  if (!data)
    return (
      <div className="loading">
        <Leaf size={36} />
        <p>Avataan omaa päiväkirjaasi…</p>
      </div>
    );
  const p = data.profiles[0],
    meals = data.meals
      .filter((m) => m.date === date)
      .sort((a, b) => a.time.localeCompare(b.time)),
    totals = dayTotals(meals),
    goal = goalForDay(data.goals, date),
    weight = data.weights.find((w) => w.date === date),
    lifestyle = data.lifestyles.find((l) => l.date === date),
    status = data.days.find((d) => d.date === date),
    isToday = date === localDay();
  const open = (d: Dialog) => {
    if (demo) {
      notify(
        "Kokeilutila näyttää esimerkit. Palaa omaan päiväkirjaan kirjataksesi.",
      );
      return;
    }
    setDialog(d);
  };
  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("today");
          }}
        >
          <span className="brand-symbol">
            <Leaf size={24} />
          </span>
          Ravintopolku
        </a>
        <p className="sidebar-caption">Hyvinvointia päivä kerrallaan.</p>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={21} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Leaf size={23} />
          <p>
            Pienet kirjaukset.
            <br />
            Selkeämpi kokonaisuus.
          </p>
          <small>Sinun omaan tahtiisi.</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="brand">
            <span className="brand-symbol">
              <Leaf size={21} />
            </span>
            Ravintopolku
          </span>
          <span className="private-badge">
            <span /> Oma päiväkirja
          </span>
        </header>
        {demo && (
          <div className="demo-banner">
            <strong>Kokeilutila · esimerkkidata</strong>
            <button
              onClick={() => {
                setDemo(false);
                setTab("today");
              }}
            >
              Palaa omaan päiväkirjaan <ArrowRight size={16} />
            </button>
          </div>
        )}
        {(needRefresh || offlineReady) && (
          <div className="update-banner">
            {needRefresh ? (
              <>
                <span>
                  Uusi versio on valmis. Tallenna avoin lomake ennen päivitystä.
                </span>
                <button
                  className="secondary"
                  disabled={!!dialog || nestedFood}
                  onClick={() => void updateServiceWorker(true)}
                >
                  Päivitä nyt
                </button>
                <button className="quiet" onClick={() => setNeedRefresh(false)}>
                  Myöhemmin
                </button>
              </>
            ) : (
              <>
                <span>Sovellus on valmis offline-käyttöön.</span>
                <button
                  className="quiet"
                  onClick={() => setOfflineReady(false)}
                >
                  Selvä
                </button>
              </>
            )}
          </div>
        )}
        <main>
          <Suspense
            fallback={
              <p className="muted" role="status">
                Avataan näkymää…
              </p>
            }
          >
            {!p && !demo ? (
              <section className="welcome card">
                <span className="welcome-leaf">
                  <Leaf size={38} />
                </span>
                <p className="eyebrow">TERVETULOA RAVINTOPOLULLE</p>
                <h1>
                  Oma polku
                  <br />
                  hyvään arkeen.
                </h1>
                <p>
                  Kirjaa ruokailu, seuraa painoa ja löydä arkeesi sopiva rytmi.
                  Tiedot pysyvät tällä laitteella.
                </p>
                <div className="button-row">
                  <button
                    className="primary"
                    onClick={() => setDialog({ kind: "profile" })}
                  >
                    Luo oma profiili <ArrowRight size={18} />
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setDemo(true);
                      setTab("today");
                    }}
                  >
                    Tutustu kokeilutilassa
                  </button>
                </div>
                <p className="muted small">
                  Ei käyttäjätiliä. Ei pakollisia ravintoainetavoitteita.
                </p>
                <label className="quiet file-button">
                  Palauta aiempi varmuuskopio
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void run(async () => {
                          const { parseBackup } = await import("./data/backup");
                          if (f.size > 100 * 1024 * 1024)
                            throw new Error("Tiedosto on liian suuri.");
                          const b = parseBackup(await f.text());
                          if (
                            window.confirm(
                              `Palautetaanko ${b.data.meals.length} ateriaa ja ${b.data.photos.length} kuvaa sisältävä varmuuskopio?`,
                            )
                          ) {
                            const { restoreBackup } =
                              await import("./data/backup");
                            await restoreBackup(b);
                            notify("Varmuuskopio palautettu.");
                          }
                        });
                      e.target.value = "";
                    }}
                  />
                </label>
              </section>
            ) : tab === "progress" ? (
              <Progress data={data} />
            ) : tab === "settings" ? (
              !demo ? (
                <SettingsView
                  data={data}
                  onProfile={() => open({ kind: "profile" })}
                  onIntegrationDraft={(item) =>
                    open({
                      kind: "meal",
                      initialDraft: item.draft,
                      inboxId: String(item.id),
                    })
                  }
                  onFood={(food) => open({ kind: "food", food })}
                  onDemo={() => setDemo(true)}
                  notify={notify}
                  run={run}
                />
              ) : (
                <section className="card">
                  <h1>Kokeilutila</h1>
                  <p>Asetukset ja viennit ovat oman päiväkirjan toimintoja.</p>
                  <button className="primary" onClick={() => setDemo(false)}>
                    Palaa omaan päiväkirjaan
                  </button>
                </section>
              )
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">
                      {tab === "diary"
                        ? "PÄIVÄ KERRALLAAN"
                        : "HYVINVOINTIA OMAAN TAHTIIN"}
                    </p>
                    <h1>
                      {tab === "diary"
                        ? "Päiväkirja"
                        : isToday
                          ? `Hei${p?.name ? ", " + p.name : ""}.`
                          : "Oma päiväkirjasi."}
                    </h1>
                    <p className="muted">
                      {isToday
                        ? "Miltä sinun päiväsi näyttää?"
                        : "Palaa kirjauksiisi ja täydennä omaa polkuasi."}
                    </p>
                  </div>
                  <button
                    className="primary add-desktop"
                    hidden={demo}
                    onClick={() => open({ kind: "meal" })}
                  >
                    <Plus size={20} /> Lisää ruoka
                  </button>
                </div>
                <div className="day-selector">
                  <button
                    className="icon-button"
                    aria-label="Edellinen päivä"
                    onClick={() => setDate(addDays(date, -1))}
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <div>
                    <strong>{isToday ? "Tänään" : displayDay(date)}</strong>
                    <label>
                      <span className="sr-only">Valitse päivä</span>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) =>
                          e.target.value && setDate(e.target.value)
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Seuraava päivä"
                    onClick={() => setDate(addDays(date, 1))}
                  >
                    <ChevronRight size={22} />
                  </button>
                  {!isToday && (
                    <button
                      className="quiet"
                      onClick={() => setDate(localDay())}
                    >
                      Tänään
                    </button>
                  )}
                </div>
                <div className="dashboard-grid">
                  <section className="card energy-card">
                    <div className="section-heading">
                      <h2>Päivän energia</h2>
                      <Utensils size={21} />
                    </div>
                    <div className="energy-value">
                      {formatNumber(totals.energy.value, 0)} <span>kcal</span>
                    </div>
                    <p className="muted">
                      {totals.energy.value === null
                        ? "Ei energiatietoa"
                        : totals.energy.partial
                          ? "Kirjattu osittainen summa"
                          : "Kirjattu yhteensä"}
                      {goal?.nutrients.energy !== null &&
                      goal?.nutrients.energy !== undefined
                        ? ` · tavoite ${formatNumber(goal.nutrients.energy, 0)} kcal`
                        : ""}
                    </p>
                    {goal?.nutrients.energy !== null &&
                      goal?.nutrients.energy !== undefined &&
                      totals.energy.value !== null && (
                        <>
                          <div
                            className="progress-track"
                            aria-label="Energia suhteessa omaan tavoitteeseen"
                          >
                            <span
                              style={{
                                width: `${goal.nutrients.energy === 0 ? 100 : Math.min(100, (totals.energy.value / goal.nutrients.energy) * 100)}%`,
                              }}
                            />
                          </div>
                          <p className="small muted">
                            Oma tavoite on vertailukohta.
                          </p>
                        </>
                      )}
                    <div className="coverage">
                      <span
                        className={
                          status?.complete
                            ? "status-dot complete"
                            : "status-dot"
                        }
                      />
                      <span>
                        {status?.complete
                          ? "Päivän kirjaukset merkitty valmiiksi"
                          : meals.length
                            ? "Kirjaukset keskeneräiset"
                            : "Päivää ei ole vielä kirjattu"}
                      </span>
                    </div>
                  </section>
                  <section className="card nutrients-card">
                    <h2>Ravintoaineet</h2>
                    {keys
                      .filter((k) => k !== "energy")
                      .map((k) => (
                        <div className="nutrient-row" key={k}>
                          <div>
                            <span className={"nutrient-dot " + k} />
                            <span>{labels[k]}</span>
                            {totals[k].partial && <small>Osittainen</small>}
                          </div>
                          <strong>
                            {formatNumber(totals[k].value)} <span>g</span>
                          </strong>
                          {goal?.nutrients[k] !== null &&
                            goal?.nutrients[k] !== undefined && (
                              <small className="target">
                                Tavoite {formatNumber(goal.nutrients[k])} g
                              </small>
                            )}
                        </div>
                      ))}
                  </section>
                </div>
                {keys.some((k) => totals[k].partial) && (
                  <p className="missing-notice">
                    Puuttuvia tietoja:{" "}
                    {keys
                      .filter((k) => totals[k].partial)
                      .map((k) => labels[k].toLocaleLowerCase("fi"))
                      .join(", ")}
                    . Osittainen summa ei kerro koko saannista.
                  </p>
                )}
                <section className="meals-section">
                  <div className="section-heading">
                    <h2>
                      Päivän ateriat{" "}
                      <span className="count">{meals.length}</span>
                    </h2>
                    <button
                      className="quiet"
                      hidden={demo}
                      onClick={() => open({ kind: "meal" })}
                    >
                      <Plus size={18} /> Lisää ateria
                    </button>
                  </div>
                  {!meals.length ? (
                    <div className="card empty-state">
                      <span className="empty-icon">
                        <Utensils size={29} />
                      </span>
                      <h3>Ensimmäinen kirjaus on hyvä alku.</h3>
                      <p className="muted">
                        Lisää ruoka omasta kirjastosta tai kirjaa annoksen arvot
                        käsin.
                      </p>
                      <button
                        className="primary"
                        hidden={demo}
                        onClick={() => open({ kind: "meal" })}
                      >
                        <Plus size={18} /> Lisää ruoka
                      </button>
                    </div>
                  ) : (
                    meals.map((meal) => {
                      const total = mealTotals(meal),
                        photo = data.photos.find((p) => p.id === meal.photoId);
                      return (
                        <article className="card meal-card" key={meal.id}>
                          <div className="meal-main">
                            {photo ? (
                              <BlobImage
                                blob={photo.blob}
                                alt={`${meal.type}, aterian kuva`}
                                className="meal-thumb"
                              />
                            ) : (
                              <div className="meal-icon">
                                <Utensils size={22} />
                              </div>
                            )}
                            <div className="meal-description">
                              <p className="meal-time">
                                {meal.time} · {meal.type}
                              </p>
                              <h3>
                                {meal.lines.map((l) => l.name).join(", ")}
                              </h3>
                              <p className="small muted">
                                {meal.lines
                                  .map((l) =>
                                    l.mode === "per100"
                                      ? `${formatNumber(l.grams)} g${l.state ? " " + l.state : ""}`
                                      : "Annoksen arvot",
                                  )
                                  .join(" · ")}
                              </p>
                            </div>
                            <div className="meal-calories">
                              <strong>
                                {formatNumber(total.energy.value, 0)}
                              </strong>
                              <span>
                                kcal{total.energy.partial ? " *" : ""}
                              </span>
                            </div>
                          </div>
                          {meal.note && (
                            <p className="small meal-note">{meal.note}</p>
                          )}
                          <div className="meal-bottom">
                            <span className="small muted">
                              P {formatNumber(total.protein.value)} g · H{" "}
                              {formatNumber(total.carbs.value)} g · R{" "}
                              {formatNumber(total.fat.value)} g
                              {total.protein.partial ||
                              total.carbs.partial ||
                              total.fat.partial
                                ? " · osittainen"
                                : ""}
                            </span>
                            <details
                              className="meal-actions"
                              hidden={demo}
                              onClick={(e) => {
                                if ((e.target as HTMLElement).closest("button"))
                                  e.currentTarget.open = false;
                              }}
                            >
                              <summary>Toiminnot</summary>
                              <div className="action-menu">
                                <button
                                  hidden={demo}
                                  onClick={() => open({ kind: "meal", meal })}
                                >
                                  <Pencil size={16} /> Muokkaa / siirrä
                                </button>
                                <button
                                  onClick={() =>
                                    void run(async () => {
                                      if (demo) {
                                        notify(
                                          "Kokeilutila on vain katselua varten.",
                                        );
                                        return;
                                      }
                                      const target = window.prompt(
                                        "Kopioi päivälle (vvvv-kk-pp):",
                                        date,
                                      );
                                      if (!target) return;
                                      const photo = photoClone(
                                        data.photos.find(
                                          (p) => p.id === meal.photoId,
                                        ),
                                      );
                                      const time = defaultMealTime(target);
                                      await saveMeal(
                                        {
                                          ...meal,
                                          ...stamped(),
                                          date: target,
                                          time,
                                          timestamp: wallTimestamp(
                                            target,
                                            time,
                                          ),
                                          lines: meal.lines.map((l) => ({
                                            ...l,
                                            id: id(),
                                          })),
                                          photoId: photo?.id ?? null,
                                        },
                                        photo,
                                      );
                                      notify("Ateria kopioitu.");
                                    })
                                  }
                                >
                                  <Copy size={16} /> Kopioi toiselle päivälle
                                </button>
                                <button
                                  onClick={() =>
                                    void run(async () => {
                                      if (demo) return;
                                      const name = window.prompt(
                                        "Vakioaterian nimi:",
                                        meal.type,
                                      );
                                      if (!name) return;
                                      await saveRecord("templates", {
                                        ...stamped(),
                                        name,
                                        lines: structuredClone(meal.lines),
                                        type: meal.type,
                                      });
                                      notify(
                                        "Vakioateria tallennettu määrineen.",
                                      );
                                    })
                                  }
                                >
                                  <Bookmark size={16} /> Tallenna vakioateriaksi
                                </button>
                                <button
                                  className="danger-link"
                                  onClick={() =>
                                    void run(async () => {
                                      if (demo) return;
                                      if (
                                        window.confirm(
                                          "Poistetaanko ateria ja siihen liitetty kuva?",
                                        )
                                      ) {
                                        await deleteMeal(meal);
                                        notify("Ateria poistettu.");
                                      }
                                    })
                                  }
                                >
                                  <Trash2 size={16} /> Poista
                                </button>
                              </div>
                            </details>
                          </div>
                        </article>
                      );
                    })
                  )}
                </section>
                <div className="daily-extras">
                  <section className="card">
                    <div className="section-heading">
                      <h2>
                        <Scale size={20} /> Paino
                      </h2>
                      <button
                        className="quiet"
                        hidden={demo}
                        onClick={() => open({ kind: "weight" })}
                      >
                        {weight ? "Muokkaa" : "Kirjaa paino"} <Plus size={16} />
                      </button>
                    </div>
                    <div className="small-stat">
                      {formatNumber(weight?.kg ?? null)} <span>kg</span>
                    </div>
                    <p className="small muted">
                      {weight?.note || "Yksi mittaus päivässä riittää."}
                    </p>
                  </section>
                  <section className="card">
                    <div className="section-heading">
                      <h2>
                        <Heart size={20} /> Oma olo
                      </h2>
                      <button
                        className="quiet"
                        hidden={demo}
                        onClick={() => open({ kind: "lifestyle" })}
                      >
                        {lifestyle ? "Muokkaa" : "Kirjaa"} <Plus size={16} />
                      </button>
                    </div>
                    <p className="small muted">
                      {lifestyle
                        ? `${formatNumber(lifestyle.steps, 0)} askelta · uni ${formatNumber(lifestyle.sleep)} h · nälkä ${formatNumber(lifestyle.hunger)}/5 · vireys ${formatNumber(lifestyle.energy)}/5`
                        : "Uni, liike ja oma olo. Vain jos haluat."}
                    </p>
                    {lifestyle?.training && (
                      <p className="small">{lifestyle.training}</p>
                    )}
                  </section>
                </div>
                <section className="completion-section">
                  <div>
                    <strong>Ovatko päivän kirjaukset valmiit?</strong>
                    <p className="muted small">
                      Vain sinä tiedät, onko kaikki kirjattu. Ravintoarvojen
                      puutteet säilyvät näkyvissä.
                    </p>
                  </div>
                  <button
                    hidden={demo}
                    className={status?.complete ? "secondary" : "primary"}
                    onClick={() =>
                      void run(async () => {
                        if (demo) return;
                        await saveRecord("days", {
                          ...stamped(status),
                          date,
                          complete: !status?.complete,
                        });
                        notify(
                          status?.complete
                            ? "Päivä merkitty keskeneräiseksi."
                            : "Päivän kirjaukset merkitty valmiiksi.",
                        );
                      })
                    }
                  >
                    <Check size={18} />
                    {status?.complete
                      ? "Merkitse keskeneräiseksi"
                      : "Merkitse valmiiksi"}
                  </button>
                </section>
              </>
            )}
            {error && (
              <div className="error global-error" role="alert">
                <span>{error}</span>
                <button onClick={() => setError("")} className="quiet">
                  Sulje
                </button>
              </div>
            )}
          </Suspense>
        </main>
        {p && !demo && (tab === "today" || tab === "diary") && (
          <button
            className="floating-add primary"
            hidden={demo}
            onClick={() => open({ kind: "meal" })}
            aria-label="Lisää ruoka"
          >
            <Plus size={22} /> Lisää ruoka
          </button>
        )}
        <nav className="bottom-nav" aria-label="Päänavigaatio">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => {
                setTab(t.id);
                window.scrollTo(0, 0);
              }}
              aria-current={tab === t.id ? "page" : undefined}
            >
              <t.icon size={22} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
      {dialog && (
        <Modal
          title={
            dialog.kind === "profile"
              ? "Profiili ja tavoitteet"
              : dialog.kind === "meal"
                ? dialog.meal
                  ? "Muokkaa ateriaa"
                  : "Lisää ateria"
                : dialog.kind === "food"
                  ? dialog.food
                    ? "Muokkaa omaa ruokaa"
                    : "Luo oma ruoka"
                  : dialog.kind === "weight"
                    ? weight
                      ? "Muokkaa painomittausta"
                      : "Kirjaa paino"
                    : "Elintapakirjaus"
          }
          onClose={() => {
            if (
              window.confirm(
                "Suljetaanko lomake? Tallentamattomat muutokset häviävät.",
              )
            )
              setDialog(null);
          }}
        >
          {dialog.kind === "profile" ? (
            <ProfileForm
              profile={real?.profiles[0]}
              goal={goalForDay(real?.goals ?? [], localDay())}
              onSaved={saved}
            />
          ) : dialog.kind === "food" ? (
            <FoodForm food={dialog.food} onSaved={saved} />
          ) : dialog.kind === "meal" ? (
            <MealEditor
              data={data}
              date={date}
              meal={dialog.meal}
              initialDraft={dialog.initialDraft}
              inboxId={dialog.inboxId}
              onSaved={saved}
              onNewFood={() => setNestedFood(true)}
            />
          ) : dialog.kind === "weight" ? (
            <WeightForm date={date} weight={weight} onSaved={saved} />
          ) : (
            <LifestyleForm date={date} lifestyle={lifestyle} onSaved={saved} />
          )}
        </Modal>
      )}
      {nestedFood && (
        <Modal
          title="Luo oma ruoka"
          onClose={() => {
            if (window.confirm("Hylätäänkö tallentamattoman ruuan tiedot?"))
              setNestedFood(false);
          }}
        >
          <FoodForm
            onSaved={() => {
              setNestedFood(false);
              notify("Ruoka tallennettu. Valitse se aterian ruokahausta.");
            }}
          />
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="quiet"
            onClick={() => setToast("")}
            aria-label="Sulje ilmoitus"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
function photoClone(photo: import("./domain/model").Photo | undefined) {
  return photo ? { ...stamped(), blob: photo.blob } : null;
}
