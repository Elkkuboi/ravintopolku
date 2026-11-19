// Ateria kuvasta: pikkukuva ja valinnainen lisätieto -> Tulkitse kuva -> odotus (Peru) -> tallentamaton luonnos
// (nimi, kello, rivit ruoka / g / kcal, yhteensä) -> Tallenna tai Hylkää. Virheessä "Yritä uudelleen" lähettää saman
// kuvan uudelleen ja "Kirjoita käsin" avaa käsin kirjauksen kuva liitettynä. Mitään ei tallenneta ennen Tallenna-napin
// painamista; sovelluksen sulkeminen kesken hylkää luonnoksen.
import { Fragment, useEffect, useRef, useState } from "react";
import { type Meal, type Photo } from "../domain/model";
import { formatNumber } from "../domain/nutrition";
import { defaultMealTime, saveMeal } from "../data/db";
import {
  tulkitseKuva,
  ateriaKuvasta,
  luonnosRivit,
  uusiRivi,
  rivinKcal,
  luonnosSumma,
  luonnosAteriaksi,
  KUVA_VIRHE,
  LISATIEDOT_MAX,
  type LuonnosRivi,
} from "../ai/kuva-ateria";
import { BlobImage, Field } from "./common";
import { KuvaKentta, type KuvaLahde } from "./KuvaKentta";
import { useFormAction } from "./useFormAction";

type Vaihe = "valittu" | "tulkitaan" | "virhe" | "luonnos";
interface Luonnos {
  pohja: Meal;
  nimi: string;
  kello: string;
  rivit: LuonnosRivi[];
}

export function KuvaLuonnos({
  photo,
  lahde,
  date,
  onUusi,
  onPeru,
  onTallennettu,
  onKasin,
}: {
  photo: Photo;
  lahde: KuvaLahde;
  date: string;
  onUusi: (file: File) => void;
  onPeru: () => void;
  onTallennettu: () => void;
  onKasin: (photo: Photo, lisatieto: string) => void;
}) {
  const [vaihe, setVaihe] = useState<Vaihe>("valittu"),
    [lisatieto, setLisatieto] = useState(""),
    [virhe, setVirhe] = useState(""),
    [luonnos, setLuonnos] = useState<Luonnos | null>(null),
    ohjain = useRef<AbortController | null>(null),
    { error, busy, execute } = useFormAction();
  useEffect(() => () => ohjain.current?.abort(), []);

  const tulkitse = async () => {
    const oma = new AbortController();
    ohjain.current = oma;
    setVaihe("tulkitaan");
    try {
      const tulos = await tulkitseKuva(
        photo.blob,
        date,
        lisatieto,
        undefined,
        oma.signal,
      );
      if (oma.signal.aborted) return;
      const pohja = ateriaKuvasta(
        tulos,
        date,
        defaultMealTime(date),
        photo,
        lisatieto,
      );
      setLuonnos({
        pohja,
        nimi: pohja.note,
        kello: pohja.time,
        rivit: luonnosRivit(pohja),
      });
      setVaihe("luonnos");
    } catch (e) {
      if (oma.signal.aborted) return;
      setVirhe(e instanceof Error ? e.message : KUVA_VIRHE.muu);
      setVaihe("virhe");
    }
  };
  const peru = () => {
    ohjain.current?.abort();
    setVaihe("valittu");
  };
  const hylkaa = () => {
    if (
      vaihe !== "luonnos" ||
      window.confirm("Hylätäänkö luonnos? Ateriaa ei tallenneta.")
    )
      onPeru();
  };
  const muuta = (i: number, muutos: Partial<LuonnosRivi>) =>
    luonnos &&
    setLuonnos({
      ...luonnos,
      rivit: luonnos.rivit.map((r, j) => (j === i ? { ...r, ...muutos } : r)),
    });
  const summa = luonnos && luonnosSumma(luonnos.rivit);

  return (
    <>
      <a
        className="back"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          hylkaa();
        }}
      >
        Tänään
      </a>
      <section aria-label="Ateria kuvasta">
        <h2 className="label">
          Ateria kuvasta{" "}
          {vaihe === "luonnos" && (
            <span className="aside">tarkista ennen tallennusta</span>
          )}
        </h2>
        <div className="draft-head">
          <BlobImage blob={photo.blob} alt="Aterian kuva" className="thumb" />
          <div>
            {luonnos && vaihe === "luonnos" ? (
              <>
                <Field label="Nimi">
                  <input
                    value={luonnos.nimi}
                    onChange={(e) =>
                      setLuonnos({ ...luonnos, nimi: e.target.value })
                    }
                    maxLength={5000}
                  />
                </Field>
                <Field label="Kello">
                  <input
                    type="time"
                    className="kello"
                    required
                    value={luonnos.kello}
                    onChange={(e) =>
                      setLuonnos({ ...luonnos, kello: e.target.value })
                    }
                  />
                </Field>
              </>
            ) : (
              <Field label="Lisätieto (ei pakollinen)">
                <input
                  value={lisatieto}
                  onChange={(e) => setLisatieto(e.target.value)}
                  maxLength={LISATIEDOT_MAX}
                  disabled={vaihe === "tulkitaan"}
                  placeholder="esim. iso annos, kaurajuoma"
                  autoComplete="off"
                />
              </Field>
            )}
          </div>
        </div>
        {vaihe === "valittu" && (
          <div className="actions">
            <button
              className="btn btn--primary"
              onClick={() => void tulkitse()}
            >
              Tulkitse kuva
            </button>
            <KuvaKentta lahde={lahde} uusi onValittu={onUusi} />
          </div>
        )}
      </section>

      {vaihe === "tulkitaan" && (
        <section className="state" role="status">
          <div className="state-word">
            <span className="dot dot--live" aria-hidden="true" />
            Tulkitaan
          </div>
          <p className="state-text">
            Kuvan tulkinta kestää yleensä 10–30 sekuntia.
          </p>
          <div className="actions">
            <button className="btn" onClick={peru}>
              Peru
            </button>
          </div>
        </section>
      )}

      {vaihe === "virhe" && (
        <section>
          <p className="note note--stop" role="alert">
            {virhe}
          </p>
          <div className="actions">
            <button
              className="btn btn--primary"
              onClick={() => void tulkitse()}
            >
              Yritä uudelleen
            </button>
            <button className="btn" onClick={() => onKasin(photo, lisatieto)}>
              Kirjoita käsin
            </button>
          </div>
        </section>
      )}

      {vaihe === "luonnos" && luonnos && (
        <>
          <section aria-label="Sisältö">
            <h2 className="label">
              Sisältö <span className="aside">arvio kuvasta</span>
            </h2>
            <div className="items">
              <span className="h">Ruoka</span>
              <span className="h n">g</span>
              <span className="h n">kcal</span>
              {luonnos.rivit.map((r, i) => (
                <Fragment key={r.pohja.id}>
                  <input
                    className="name"
                    value={r.nimi}
                    onChange={(e) => muuta(i, { nimi: e.target.value })}
                    maxLength={200}
                    aria-label={`Ruoka ${i + 1}`}
                  />
                  <input
                    value={r.g}
                    onChange={(e) => muuta(i, { g: e.target.value })}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`Grammat ${i + 1}`}
                  />
                  <input
                    value={rivinKcal(r)}
                    onChange={(e) => muuta(i, { kcal: e.target.value })}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`kcal ${i + 1}`}
                  />
                </Fragment>
              ))}
            </div>
            <div className="actions">
              <button
                className="btn--quiet"
                onClick={() =>
                  setLuonnos({
                    ...luonnos,
                    rivit: [...luonnos.rivit, uusiRivi()],
                  })
                }
              >
                + rivi
              </button>
            </div>
            <div className="sum">
              <span>Yhteensä</span>
              <span>
                {summa
                  ? `${formatNumber(summa.energy.value, 0)} kcal · P ${formatNumber(summa.protein.value, 0)} · H ${formatNumber(summa.carbs.value, 0)} · R ${formatNumber(summa.fat.value, 0)}`
                  : "tarkista luvut"}
              </span>
            </div>
          </section>
          <section className="actions">
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                void execute(async () => {
                  await saveMeal(
                    luonnosAteriaksi(
                      luonnos.pohja,
                      luonnos.nimi,
                      luonnos.kello,
                      luonnos.rivit,
                    ),
                    photo,
                  );
                  onTallennettu();
                })
              }
            >
              {busy ? "Tallennetaan…" : "Tallenna"}
            </button>
            <button className="btn" onClick={hylkaa}>
              Hylkää
            </button>
          </section>
          {error && (
            <p className="note note--stop" role="alert">
              {error}
            </p>
          )}
          <p className="note">
            Arvio on tehty kuvasta. Korjaa grammat, jos annos oli isompi tai
            pienempi. Tyhjä nimi poistaa rivin.
          </p>
          <Huomiot oletukset={luonnos.pohja.assumptions} />
        </>
      )}
    </>
  );
}

/** Mallin oletukset, puuttuvat tiedot ja kysymykset taitettuna; lisätieto on jo näkyvissä kentässä. */
function Huomiot({ oletukset }: { oletukset: string[] }) {
  const huomiot = oletukset.filter((o) => !o.startsWith("Lisätiedot:"));
  if (!huomiot.length) return null;
  return (
    <details className="fold">
      <summary>Tulkinnan huomiot ({huomiot.length})</summary>
      <ul className="oletukset small">
        {huomiot.map((h, i) => (
          <li key={i}>{h}</li>
        ))}
      </ul>
    </details>
  );
}
