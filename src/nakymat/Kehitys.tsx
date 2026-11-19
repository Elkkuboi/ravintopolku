// Kehitys-sivu (ladataan laiskasti kuvaajien kanssa). Uusi ulkoasu tehdään tähän tiedostoon ja tyylit tiedostoon
// src/tyylit/kehitys.css.
import { Progress } from "../components/Progress";
import { type NakymaProps } from "../kuori";
import "../tyylit/vanha-kehitys.css";
export default function Kehitys({ data }: NakymaProps) {
  return <Progress data={data} />;
}
