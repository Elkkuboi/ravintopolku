# Ravintopolku

Eliaksen ruokapäiväkirja puhelimelle: ateriat kuvasta tai käsin, paino, energia ja makrot tavoitetta vasten. Sovellus
on PWA. Päiväkirja on puhelimen selaimessa (IndexedDB), toimii ilman verkkoa ja synkronoituu työaseman palvelimelle
(`palvelin/`, Python). Ulkoasu on Ilmari Hubin tyyli, ja värit tulevat Hubista.

## Mitä siinä on

- **Tänään**: päivän energia ja makrot, **Ota kuva** (kamera), **Galleriasta** ja **Kirjoita** (käsin), ateriat, paino
  ja taitettu "Uni, liike ja olo". Ilmarin odottavat luonnokset näkyvät vain, kun niitä on.
- **Kuvasta ateria**: kuva pienennetään puhelimessa enintään 700 kt:n JPEGiksi ja tulkitaan työaseman palvelimen ja
  aiops-välittäjän kautta (rooli `kuva_tulkki`, Hub päättää mallin). Tulos on tallentamaton luonnos, jonka käyttäjä
  tarkistaa ja tallentaa tai hylkää.
- **Kehitys**: paino, energia ja proteiini 7, 30 tai 90 päivältä tai koko ajalta; päivittäiset luvut taitettuna.
- **Asetukset**: tavoitteet (myös ehdotus omin sanoin), omat ruuat, synkronoinnin tila, varmuuskopio ja CSV sekä
  Promptit: kielimallin ohjeet sellaisinaan, vain luettavina.

Tallennettu data säilyy laitteella ja palvelimella. Palvelin ottaa päivittäisen varmuuskopion (30 päivää). Kuvat
pysyvät laitteella eivätkä synkronoidu. Yli 25 poistoa kerralla vaatii vahvistuksen Asetuksissa.

## Rakenne

- `src/`: React, TypeScript, Vite, Dexie (IndexedDB) ja Zod. Kuori on `App.tsx`, sivut `src/nakymat/`, tyyli
  `src/style.css` (Hubin tyyli ja neljä väriyhdistelmää) ja sivujen lisäykset `src/tyylit/`.
- `palvelin/`: Python (Starlette, uv). Tarjoilee käännöksen ja reitit `/api/synk`, `/api/luonnokset`,
  `/api/kuva-ateria`, `/api/tavoitteet`, `/api/ulkoasu` ja `/api/kehotteet`. Tunnistus on Tailscale-identiteetti, ja CSP kieltää
  inline-skriptit ja -tyylit.
- `scripts/asenna-tyoasema.sh`: käännös ja asennus työasemalle.

## Kehitys ja tarkistukset

Node 24 (asennus kääntää versiolla 24.19.0), npm ja uv.

```bash
npm ci --ignore-scripts
npm run check                  # typecheck, lint, vitest ja käännös
npm run test:e2e               # savutesti järjestelmän Chromella (tests/e2e/savu.spec.ts)
(cd palvelin && uv run --frozen pytest -q)
```

`npm run dev` käynnistää pelkän käyttöliittymän ilman rajapintaa: synkronointi ja kuvan tulkinta eivät silloin toimi.
Tarkemmin: [docs/testing.md](docs/testing.md).

## Asennus työasemalle

Käyttöönotto tehdään aiops-repon kääreellä, kun commit on GitHubin mainissa:

```bash
sudo ravintopolku-kayttoonotto TÄYSI_COMMIT
```

Kääre ajaa `scripts/asenna-tyoasema.sh`:n. Se kääntää commitoidun koodin kertakäyttöisissä konteissa (`npm ci`
verkon kanssa, `npm test` ja `npm run build` ilman verkkoa), asentaa `dist/`:n hakemistoon `/opt/ravintopolku/dist` ja
palvelimen hakemistoon `/opt/ravintopolku/palvelin`. Jos asennus tai terveystarkistus pettää, edellinen versio
asennetaan takaisin. Palvelimen asetukset ovat tiedostossa `/etc/ravintopolku/palvelin.toml` (malli
`config/palvelin.toml.esimerkki`). Sovellus on osoitteessa `https://tyoasema.<tailnet>.ts.net:8443`.

Puhelimessa uusi versio tulee käyttöön, kun yläreunassa napauttaa **Päivitä**.

## Dokumentit

[Arkkitehtuuri](docs/architecture.md), [ILMARI ja aiops](docs/ilmari-integration.md), [testaus](docs/testing.md),
[kirjastot](docs/dependencies.md) ja [analytiikan jatkotyö](docs/analytics-roadmap.md).
