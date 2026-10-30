// Päänavigaation välilehdet puhtaana tietona, jotta niiden rakennetta voi
// tarkistaa yksikkötestissä ilman selainta. "Tänään" on ainoa päiväkirjanäkymä:
// aiempi erillinen "Päiväkirja"-välilehti näytti täsmälleen saman sisällön.
import { Settings, Sun, TrendingUp } from "lucide-react";

export const tabs = [
  { id: "today", label: "Tänään", icon: Sun },
  { id: "progress", label: "Kehitys", icon: TrendingUp },
  { id: "settings", label: "Asetukset", icon: Settings },
] as const;

export type Tab = (typeof tabs)[number]["id"];
