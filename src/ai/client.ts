// Rajapinnan osoite: sovellus ja palvelin ovat samassa alkuperässä (Python-palvelin tarjoilee molemmat).
export const apiURL = (path: string) =>
  import.meta.env.BASE_URL + "api/" + path;
