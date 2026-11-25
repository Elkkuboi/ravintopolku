# Ravintopolku

Eliaksen ruokapäiväkirja puhelimelle: ateriat kuvasta tai käsin, paino, energia ja makrot tavoitetta vasten. Sovellus
on PWA. Päiväkirja on puhelimen selaimessa (IndexedDB), toimii ilman verkkoa ja synkronoituu Louhin palvelimelle
(`palvelin/`, Python). Ulkoasu on Ilmari Hubin tyyli, ja värit tulevat Hubista.

## Mitä siinä on

- **Tänään**: päivän energia ja makrot, **Ota kuva** (kamera), **Galleriasta** ja **Kirjoita** (käsin), ateriat, paino,
  **Treenipäivä** (yksi napautus) ja taitettu "Uni, liike ja olo". Ilmarin odottavat luonnokset näkyvät vain, kun
  niitä on.
- **Tavoitealue**: tavoite on yksi luku, ja mittarin pääty näyttää päivän hyväksytyn vaihtelun sen ympärillä:
  energia ±10 %, hiilihydraatit ja rasva ±20 %, proteiini ja kuitu vähintään 90 % ilman ylärajaa
  (`src/domain/nutrition.ts`). Alueelle osunut luku vihertää, ja vain energian ylitys varoittaa. Kehityksen
  "Tavoite täyttyi" käyttää samaa sääntöä.
- **Kuvasta ateria**: kuva pienennetään puhelimessa enintään 700 kt:n JPEGiksi ja tulkitaan Louhin palvelimen ja
  aiops-välittäjän kautta (rooli `kuva_tulkki`, Hub päättää mallin). Tulos on tallentamaton luonnos, jonka käyttäjä
  tarkistaa ja tallentaa tai hylkää.
- **Kehitys**: paino, energia ja proteiini 7, 30 tai 90 päivältä tai koko ajalta; päivittäiset luvut taitettuna.
  Treenipäivät näkyvät viivana energian kuvaajan alla ja sarakkeena T, ja kuvaajan alla on energian keskiarvo
  treenipäivinä ja muina päivinä.
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
- `scripts/asenna-tyoasema.sh`: käännös ja asennus (nimi on historiaa: palvelu pyörii Louhilla).

## Kehitys ja tarkistukset

Node 24 (asennus kääntää versiolla 24.19.0), npm ja uv. Palvelin on Python 3.14 (`palvelin/.python-version`; uv hakee
sen kehityskoneelle itse).

```bash
npm ci --ignore-scripts
npm run check                  # typecheck, lint, vitest ja käännös
npm run test:e2e               # savutesti järjestelmän Chromella (tests/e2e/savu.spec.ts)
(cd palvelin && uv run --frozen pytest -q)
```

`npm run dev` käynnistää pelkän käyttöliittymän ilman rajapintaa: synkronointi ja kuvan tulkinta eivät silloin toimi.
Tarkemmin: [docs/testing.md](docs/testing.md).

## Asennus

Palvelu pyörii Louhilla (24.11.2026 alkaen). Asennus tehdään Louhilla repon kopiosta, kun commit on GitHubin mainissa:

```bash
sudo scripts/asenna-tyoasema.sh /opt/louhi-ravintopolku-runtime/uv   # sovellus ja palvelin
sudo scripts/asenna-tyoasema.sh --vain-sovellus                      # vain käyttöliittymä, palvelin ennallaan
```

Skripti kääntää commitoidun koodin kertakäyttöisissä konteissa (`npm ci` verkon kanssa, `npm test` ja `npm run build`
ilman verkkoa), asentaa `dist/`:n hakemistoon `/opt/ravintopolku/dist` ja palvelimen hakemistoon
`/opt/ravintopolku/palvelin` koneen omalla Pythonilla (`/usr/bin/python3.14`). Jos jokin vaihe pettää, edellinen
sovellus, palvelin ja palvelutiedosto palautetaan ja palvelu käynnistetään uudelleen. Isännän oma lisäryhmä
(Louhilla `SupplementaryGroups=aiops-ceo`, jolla palvelu pääsee välittäjän sokettiin) säilyy tiedostossa
`ravintopolku.service.d/isanta.conf`. Palvelimen asetukset ovat tiedostossa `/etc/ravintopolku/palvelin.toml` (malli
`config/palvelin.toml.esimerkki`). Sovellus on osoitteessa `https://louhi.<tailnet>.ts.net:8443`.

Puhelimessa uusi versio tulee käyttöön, kun yläreunassa napauttaa **Päivitä**.

## Dokumentit

[Arkkitehtuuri](docs/architecture.md), [ILMARI ja aiops](docs/ilmari-integration.md), [testaus](docs/testing.md),
[kirjastot](docs/dependencies.md) ja [analytiikan jatkotyö](docs/analytics-roadmap.md).
