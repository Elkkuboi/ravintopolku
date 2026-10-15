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
| Recharts          | 3.10.1           | https://recharts.github.io/en-US/guide/ — ResponsiveContainer ja line/bar-komponentit; puuttuvat arvot nullina                                                                        |
| vite-plugin-pwa   | 1.3.0            | https://vite-pwa-org.netlify.app/guide/ ja https://vite-pwa-org.netlify.app/guide/prompt-for-update.html — prompt-rekisteröinti, updateSW vasta käyttäjän pyynnöstä, Workbox precache |
| Vitest            | 5.0.3            | https://vitest.dev/guide/ — requires Vite ≥6.4 / Node ≥22.12; erillinen testikonfiguraatio                                                                                            |
| Playwright        | 1.63.0           | https://playwright.dev/docs/intro — Chromium, mobile viewport ja production-webServer                                                                                                 |

Zod-verkkosivu palautti ympäristössä HTTP 403. Sen ajantasainen API-ohje luettiin virallisen GitHub-repositorion `packages/docs/content/api.mdx`-tiedostosta. Zod 4 ei salli `.omit()`-kutsua refinements-skeemalle: raakamuoto ja rajausten validointi erotettiin tämän mukaan. `npm ls --depth=0` ei ilmoittanut yhteensopivuusvirheitä. Node 24.19.0, npm 11.9.0. Tuotantokäännös ja testit vahvistavat yhdistelmän tässä ympäristössä. Kirjastojen peer dependencies ja Node-vaatimukset tulee tarkistaa uudelleen päivityksissä.

## Palvelin 1.1 (tarkistettu 4.10.2026)

Fastify 5.12.5, @fastify/cookie 11.1.2, @fastify/rate-limit 11.2.0 ja @fastify/static 10.1.5 on lukittu package-lock.jsoniin. Viralliset ohjeet: [Fastify](https://fastify.dev/docs/latest/), [cookie](https://github.com/fastify/fastify-cookie), [rate-limit](https://github.com/fastify/fastify-rate-limit) ja [static](https://github.com/fastify/fastify-static). Pluginit ovat Fastify 5 -yhteensopivia; rate-limit-ohjeen taulukko edellyttää versiota 10 tai uudempaa Fastify 5:lle. Rekisteröinti, evästeet, rate limits ja staattinen tuotantopalvelu on testattu oikeaa palvelua vasten.

Palvelimen SQLite käyttää Node 24:n sisäänrakennettua [node:sqlite](https://nodejs.org/api/sqlite.html)-moduulia, ei aiops-kantaa. Työtilan Node 24.19.0 suorittaa DatabaseSync-operaatiot; Node-majoria ei pidä alentaa. TypeScript suoritetaan tsx 4.23.15:llä. Kehityksen kahden prosessin käynnistys käyttää concurrently 10.0.5:tä. Lockfile pitää myös testiajossa käytetyn oxlint 1.86.0:n. `npm ls --depth=0` läpäisi ilman peer-riippuvuusvirheitä.

OpenAI:n viralliset Responses-, structured-output- ja vision-ohjeet tarkistettiin erikseen; linkit ja käytetty pyyntösopimus ovat [AI-dokumentissa](ai-integration.md). Mallin saatavuutta tai maksullista live-yhteyttä ei tarkistettu ilman käyttäjän API-avainta.
