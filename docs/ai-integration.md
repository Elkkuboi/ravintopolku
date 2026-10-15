# AI-integraatio 1.1

## Toteutettu OpenAI-yhteys

`src/ai/provider.ts` määrittää pienen `AIProvider`-rajapinnan: package, portion ja suggestion, sekä imageInput/structuredOutput-kyvykkyydet. Yhteinen `AIDraft` sisältää ruokalajit, tuntemattomat tiedot, oletukset, tarkentavat kysymykset ja alkuperän. Skeema on [ai-draft.schema.json](ai-draft.schema.json), versio 1. Malli ei laske päiväkirjan summia eikä tunne tietovarastoa.

`HttpProvider` lähettää valitun tekstin ja haluttaessa pienennetyn kuvan samaa originia käyttävälle Fastify-palvelulle. `server/openai.ts` kutsuu **https://api.openai.com/v1/responses** palvelimen API-avaimella. Endpoint on kiinteä, joten selain tai ILMARI ei voi vaihtaa kutsun kohdetta. Malli, kuvaominaisuus, aikaraja, tokenraja ja päiväkohtainen yrityskatto luetaan palvelimen ympäristöstä. Avainta ei siirretä asiakkaalle, URL:iin, localStorageen, IndexedDB:hen tai varmuuskopioon. Vite lukee vain `VITE_`-prefiksin asetukset; salaisuudet eivät saa käyttää tätä prefiksiä.

Pyynnössä käytetään `text.format`-kentän `json_schema`/`strict: true` -outputia ja `store: false`. Kaikki kentät ovat pakollisia; tuntemattomat arvot ovat nullable. Providerin skeemasta poistetaan yleisen strict-skeematuen ulkopuoliset pituus-/lukurajoitukset, mutta **koko Zod-validointi suoritetaan vastaukselle**. Puuttuva massa saa jäädä luonnokseen nulliksi; per100-rivi vaatii massan ennen aterian tallennusta. Negatiiviset ravintoarvot, virheellinen JSON, refusal ja incomplete eivät tuota tallennettavaa tulosta. Alkuperän provider ja malli asetetaan palvelimella, ei mallin väitteen perusteella.

Kuvat toimitetaan `input_image`-data-URLina. Selain pienentää kuvan ja tuottaa uuden JPEG:n, joka poistaa alkuperäiset kuvatiedoston metatiedot. Palvelin tarkistaa koon, sallitun tyypin ja tiedostotunnisteen. Mallin annosmassaa ei esitetä tarkkana kuvamittauksena. UI näyttää lähetyskohteen ja kustannusmahdollisuuden. **Kuvan valinta ja lähetyssuostumus eivät ole oletuksena päällä.** Profiilia, painoja tai muita aterioita ei lähetetä. Syötteen sisältö on käyttäjän vastuulla; tarpeettomia henkilötietoja ei pidä lisätä.

## Käyttöoikeudet ja rajat

Node kuuntelee vain loopbackissa. Etäkäyttö edellyttää HTTPS-välitystä, määritettyä APP_ORIGINia ja oikeaa Host-otsaketta. Salasana luodaan `npm run setup` -komennolla, tallennetaan `.env`:iin ja annetaan sovelluksen AI-palvelukirjautumisessa. Satunnainen istuntotunniste tallentuu HttpOnly/SameSiteStrict-evästeeseen; HTTPS-originiin asetetaan Secure. Istunto vanhenee 8 tunnissa ja palvelimen uudelleenkäynnistys mitätöi sen. Muutokset vaativat sallittua Originia ja omaa request-otsaketta; CORS ei ole avoin. Kirjautumisia rajataan 5/min, AI-pyyntöjä 10/min, enintään kaksi käynnissä. Päiväkohtainen yrityslaskuri säilyy SQLite-kannassa. Oletus 30 yritystä, 60 s, 4096 output-tokenia, 2 Mt kuva, 3 MiB request body.

Tämä on henkilökohtainen palvelu, ei monen käyttäjän SaaS. Pyyntökatto ei takaa rahamääräistä ylärajaa. Käytä rajattua OpenAI-projektin avainta, tarkista mallin hinnat ja projektin laskutusrajat. Suostumus koskee yhtä käyttäjän käynnistämää toimintoa; uudelleenyritykset ovat uusia mahdollisesti laskutettavia kutsuja. Keskeytys katkaisee HTTP-kutsun mutta ei takaa, ettei provider ole jo käsitellyt ja laskuttanut sitä.

Fastify-logger on pois ja virheistä palautetaan hallittu viesti ilman raakaa provider-bodya tai salaisuuksia. AI-pyynnön tekstiä, kuvaa ja vastausta ei kirjoiteta palvelimen kantaan. `store:false` ei itsessään takaa OpenAI:n kaikkien väärinkäytönvalvontalokien poistamista: lue oman projektin tietojen käsittely- ja säilytysehdot ennen käyttöä. ILMARI-vastaanotto säilyttää luonnokset erillisessä rajatussa laatikossa; katso [ilmari-integration.md](ilmari-integration.md).

## Luonnoksen hyväksyntä ja offline

Palautettu tulos avautuu aterialomakkeessa muokattavaksi. Käyttäjä näkee alkuperän, oletukset ja lisätietotarpeet. Kirjasto, snapshotit, päivän summat ja graafit käyttävät samoja keskitettyjä funktioita kuin käsinkirjaus. Provider ei voi kutsua `saveMeal`-funktiota. Avoimen luonnoksen voi jättää tallentamatta. Virhe jättää käsinkirjauksen käyttöön; sovellusta voi käyttää offline-tilassa ilman AI-palvelua.

`DisabledProvider` on käytössä ilman määritettyä yhteyttä. `MockProvider` on kiinteä, simulaatioksi merkitty **testiapuri**, ei käyttöliittymän ruokakuvan analysoija. Selainkokeiden OpenAI-vastaukset on korvattu selvästi nimetyllä testisimulaatiolla; ei maksullisia kutsuja.

Käsin käytettävä **Kopioi ohje tekoälylle** säilyy: käyttäjä siirtää ohjeen ja kuvan itse ChatGPT:hen tai Claudeen ja liittää JSONin takaisin. JSON validoidaan ennen luonnosta. React esittää tuodut tekstit datana eikä HTML:nä. Toisten palveluiden selainta, evästeitä tai istuntotunnuksia ei lueta tai automatisoida.

## Viralliset ohjeet ja paikallinen aktivointi

OpenAI-ohjeet tarkistettiin verkon kautta 4.10.2026:

- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Models](https://developers.openai.com/api/docs/models)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)

Palvelin ei arvaa sopivaa mallia eikä väitä konfiguraation todistavan live-yhteyttä. Aseta OPENAI_API_KEY ja OPENAI_MODEL paikallisesti, tarkista mallin Responses-, strict-output- ja vision-tuki sekä käyttöoikeus, käynnistä palvelin uudelleen. Kokeile ensin tiedossa olevalla 200 kcal/100 g -tekstillä ja 150 g massalla: sovelluksen laskennan pitää antaa 300 kcal. Kokeile sitten pakkauksen kuvaa, tuntematonta annosmassaa ja virheellistä avainta. Tarkista käyttö OpenAI-projektista. Tässä ympäristössä ei ollut avainta, joten **oikeaa OpenAI-kutsua ei tehty**.

## Muut providerit myöhemmin

| Provider                                                         | Toteutus ja ennen sitä tarkistettavat asiat                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic API                                                    | Oma palvelinadapteri ja erillinen API-avain. Tarkista viralliset Messages/vision- ja structured-output-ohjeet, mallien tuki, kuvarajat, laskutus ja tietojen säilytys. Ei vielä toteutettu.                                                       |
| Paikallinen vision-malli, esim. Ollama                           | Oma palvelinadapteri autentikoidun HTTPS:n tai yksityisen verkon takana. Tarkista mallin todellinen kuvatuki, JSON-skeema, VRAM/resurssit, aikarajat ja aiopsin ADR-0009. Älä avaa suojaamatonta Ollama-porttia internetiin. Ei vielä toteutettu. |
| Mahdollinen virallinen ChatGPT plan usage / Sign in with ChatGPT | Ensin varmista, että virallinen käyttö sallii tämän kolmannen osapuolen sovelluksen. Tarkista rekisteröinti, redirect-URI:t, scopes, PKCE, tokenin elinkaari, käyttörajat ja ehdot. Ei vielä toteutettu eikä esitetty toimivana palveluna.        |

**Tilauskirjautuminen ja tavallinen API-avain ovat eri autentikointitapoja.** ChatGPT-/Claude-tilaus tai Codexin kirjautuminen ei osoita yleistä päiväkirjasovelluksen API-oikeutta. Avaimellinen backend on nyt toteutettu OpenAI:lle; tulevat OAuth-tokenit kuuluvat myös palvelimeen asianmukaisesti suojattuina, eivät selaimeen tai varmuuskopioon.

Uuden providerin työnkulku: varmista viralliset ehdot ja dokumentaatio, lisää palvelinadapteri ja kyvykkyysmetatieto, validoi samaan AIDraft-sopimukseen, testaa rikkinäiset/arvoltaan mahdottomat vastaukset, virheet ja keskeytys. Säilytä sama käyttäjän hyväksyntä ja paikallinen laskenta. Lisää tarkempi eurobudjetti vain providerin hinnoittelun ja tokenkäytön perusteella, erillään ravintolaskennasta.
