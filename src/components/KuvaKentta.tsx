// Kuvanappi: <label class="btn file"> ja sen sisällä näkymätön tiedostokenttä. Kamera ja galleria ovat kaksi erillistä
// kenttää, koska uudet Android-puhelimet avaavat ilman capture-attribuuttia pelkän kuvavalitsimen ilman kameraa:
// "Ota kuva" avaa takakameran suoraan (capture="environment"), "Galleriasta" avaa valitsimen (ei capturea).
export type KuvaLahde = "kamera" | "galleria";
export const KUVATYYPIT = "image/jpeg,image/png,image/webp";

export function KuvaKentta({
  lahde,
  uusi = false,
  ensisijainen = false,
  disabled = false,
  onValittu,
}: {
  lahde: KuvaLahde;
  /** Kuvan jälkeen: "Ota uusi" tai "Valitse toinen". */
  uusi?: boolean;
  ensisijainen?: boolean;
  disabled?: boolean;
  onValittu: (file: File) => void;
}) {
  const teksti =
    lahde === "kamera"
      ? uusi
        ? "Ota uusi"
        : "Ota kuva"
      : uusi
        ? "Valitse toinen"
        : "Galleriasta";
  return (
    <label
      className={"btn file" + (ensisijainen ? " btn--primary" : "")}
      aria-disabled={disabled || undefined}
    >
      {teksti}
      <input
        type="file"
        accept={KUVATYYPIT}
        capture={lahde === "kamera" ? "environment" : undefined}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onValittu(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
