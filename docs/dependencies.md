# Kirjastot ja viralliset ohjeet

Tarkistettu 2.10.2026 tämän ympäristön verkon kautta. Lockfile tallentaa täsmälliset versiot; käytä `npm ci`, älä satunnaista päivittämistä tuotannossa. Ei runtime-CDN-riippuvuuksia.

| Kirjasto          | Asennettu versio | Virallinen ohje ja sovellettu käytäntö                                                                                                                                                |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React / React DOM | 19.3.0           | https://react.dev/learn — lomakkeiden kontrolloidut kentät, tilapäivitykset ja komponentit                                                                                            |
| Vite              | 8.3.2            | https://vite.dev/guide/ — react-ts template, production build/preview; Node 24 täyttää 20.19+/22.12+ vähimmäisrajan                                                                   |
| TypeScript        | 6.0.3            | Viten react-ts-mallin tsconfig; strict/noUnused-tarkistukset                                                                                                                          |
| Dexie             | 4.4.6            | https://dexie.org/docs/ — versionoidut stores, uniikit indeksit, transaktiot; kuvat blobina                                                                                           |
| dexie-react-hooks | 4.4.0            | Dexien live-query-käytäntö; käyttöliittymä reagoi tietokannan muutoksiin                                                                                                              |
| Zod               | 4.6.5            | https://zod.dev/ ja virallinen https://github.com/colinhacks/zod — nullable, ISO-ajat, safeParse, refinements, JSON schema                                                            |
| vite-plugin-pwa   | 1.3.0            | https://vite-pwa-org.netlify.app/guide/ ja https://vite-pwa-org.netlify.app/guide/prompt-for-update.html — prompt-rekisteröinti, updateSW vasta käyttäjän pyynnöstä, Workbox precache |
| Vitest            | 5.0.3            | https://vitest.dev/guide/ — requires Vite ≥6.4 / Node ≥22.12; erillinen testikonfiguraatio                                                                                            |
| Playwright        | 1.63.0           | https://playwright.dev/docs/intro — savutesti järjestelmän Chromella (`channel: "chrome"`), `vite preview` webServerinä, `page.route`                                                 |

Zod-verkkosivu palautti ympäristössä HTTP 403. Sen ajantasainen API-ohje luettiin virallisen GitHub-repositorion `packages/docs/content/api.mdx`-tiedostosta. Zod 4 ei salli `.omit()`-kutsua refinements-skeemalle: raakamuoto ja rajausten validointi erotettiin tämän mukaan. `npm ls --depth=0` ei ilmoittanut yhteensopivuusvirheitä. Node 24.19.0, npm 11.9.0. Tuotantokäännös ja testit vahvistavat yhdistelmän tässä ympäristössä. Kirjastojen peer dependencies ja Node-vaatimukset tulee tarkistaa uudelleen päivityksissä.

Kuvaajat ovat omaa SVG:tä, kuvakkeita ei ole, ja kirjasin (IBM Plex Mono, OFL) on repossa (`public/fonts/`).
Palvelimen (`palvelin/`) Python-riippuvuudet on lukittu tiedostoon `palvelin/uv.lock`.
