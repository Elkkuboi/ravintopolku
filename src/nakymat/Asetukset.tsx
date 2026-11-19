// Asetukset-sivu. Profiilin ja oman ruuan lomakkeet avataan täältä (ennen App.tsx:ssä); uusi ulkoasu tehdään tähän
// tiedostoon ja tyylit tiedostoon src/tyylit/asetukset.css.
import { useState } from "react";
import { type Food } from "../domain/model";
import { localDay } from "../domain/dates";
import { goalForDay } from "../domain/nutrition";
import { SettingsView } from "../components/SettingsView";
import { ProfileForm } from "../components/ProfileForm";
import { FoodForm } from "../components/FoodForm";
import { Modal } from "../components/common";
import { type NakymaProps } from "../kuori";
import "../tyylit/vanha-asetukset.css";
type Dialog = { kind: "profile" } | { kind: "food"; food?: Food } | null;
export default function Asetukset({ data, notify, run }: NakymaProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const saved = () => {
    setDialog(null);
    notify("Tallennettu.");
    void navigator.storage?.persist?.().catch(() => {});
  };
  return (
    <>
      <SettingsView
        data={data}
        onProfile={() => setDialog({ kind: "profile" })}
        onFood={(food) => setDialog({ kind: "food", food })}
        notify={notify}
        run={run}
      />
      {dialog && (
        <Modal
          title={
            dialog.kind === "profile"
              ? "Profiili ja tavoitteet"
              : dialog.food
                ? "Muokkaa omaa ruokaa"
                : "Luo oma ruoka"
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
              profile={data.profiles[0]}
              goal={goalForDay(data.goals, localDay())}
              onSaved={saved}
            />
          ) : (
            <FoodForm food={dialog.food} onSaved={saved} />
          )}
        </Modal>
      )}
    </>
  );
}
