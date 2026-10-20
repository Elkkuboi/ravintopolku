// Automaattinen synkronointi (aiops ADR-0016): käynnistyessä, 5 minuutin välein, verkon palatessa ja kun sovellus
// tulee näkyviin. Ilman palvelinta ajo päättyy hiljaa, ja päiväkirja toimii laitteella kuten ennenkin.
import { useEffect } from "react";
import { synkronoiNyt } from "./sync";

export function useAutoSync() {
  useEffect(() => {
    const aja = () => { void synkronoiNyt(); };
    const nakyvyys = () => { if (document.visibilityState === "visible") aja(); };
    aja();
    const ajastin = setInterval(aja, 5 * 60 * 1000);
    window.addEventListener("online", aja);
    document.addEventListener("visibilitychange", nakyvyys);
    return () => {
      clearInterval(ajastin);
      window.removeEventListener("online", aja);
      document.removeEventListener("visibilitychange", nakyvyys);
    };
  }, []);
}
