# Arkkitehtuuri

## Moduulit ja datan kulku

`src/domain/model.ts` sisältää Zod-skeemat, yksiköt ja tyypit. `nutrition.ts` on ravintoaineiden ainoa laskentapaikka: per100-arvo × grammat / 100 tai annoksen ilmoitettu kokonaisarvo. Pakkauksen energiaa ei korvata makrolaskennalla. `dates.ts` vastaa Helsingin päivistä ja seinäkellon ajasta. `analytics.ts` käyttää raakakirjauksia. `paino.ts` on ainoa paikka, jossa vapaasta tekstistä poimitaan päivän paino ("paino 82,4"); epäselvää ei arvata, ja skeema pyöristää luvun yhteen desimaaliin. `src/data` toteuttaa Dexie-varaston, kuvat, viennit ja eristetyn demodatan. `src/ai` ei tunne tietokantaa eikä voi kirjoittaa sinne. `src/components` ja App ovat käyttöliittymä.

UI validoi syötteen, muodostaa aterian ruokalistasta ja välittää sen `saveMeal`-funktiolle. Tietovarasto validoi uudelleen, laskee snapshotin ja ajankohdan sekä kirjoittaa aterian ja kuvan samassa transaktiossa. Dexien `useLiveQuery` päivittää näkymät kirjoituksen jälkeen. Myöhempi backend voi korvata tietovaraston rajat; puhtaat laskenta- ja analyysifunktiot sekä provider-sopimus säilyvät.

## Tietomalli ja versiot

Dexie version 1: profiles, goals, foods, meals, photos, templates, weights, lifestyles, days, settings. Jokaisella tietueella vakaa UUID ja createdAt/updatedAt. Painon, elintapojen ja päivän tilan date-indeksit ovat uniikkeja. Profiileja ja asetuksia on korkeintaan yksi. Tavoitehistoria valitaan effectiveDate-päivän mukaan; sama voimaantulopäivä korvataan profiililomakkeen transaktiossa.

Ateriarivi säilyttää nimen, valmistustilan, lähteen, syöttötavan, määrän ja ravintoarvot. foodId on viite kirjastoon, **ei laskennan lähde**. Aterialla on lisäksi laskettu snapshot, alkuperä, oletukset, kuva-ID ja muistiinpano. Kokonaisarvon snapshot on null, jos yhdelläkin ainesosalla on kyseinen arvo tuntematon. Alkuperäiset rivit säilyvät, joten tunnettu osasumma ja puuttuvien rivien määrä ovat laskettavissa erikseen. Vakioateria sisältää rivien snapshotit ja määrät; se ei ole suosikkiruoka. Kirjastosta poistaminen ei poista historiatietoa.

Uudessa tietokantaversiossa lisätään Dexie `version(2).stores(...).upgrade(...)`, jonka migraatio testataan kopioidulla v1-kannalla. Varmuuskopion schemaVersion on tästä erillinen ja nyt 1. Tuntemattomia versioita ei palauteta. Tulevat migraatiot validoidaan ensin muistissa ja kirjoitetaan vasta transaktiossa. Älä muuta v1-skeemaa julkaistun version jälkeen.

## Päivämäärät

Tarkoitettu paikallinen date säilyy ISO-päivänä ja meal.timestamp UTC-aikaleimana. timezone on Europe/Helsinki. Lomakkeet käyttävät tietovaraston CRUD-funktioita ja `saveProfileGoal`-operaatiota; ne eivät suorita suoria Dexie-kyselyitä. Päivän valinta, summat ja analyysit käyttävät aina date-arvoa. Kalenteripäivien aritmetiikka käyttää UTC:n keskipäivää vain ISO-päivien siirtämiseen; sitä ei käsitellä ateria-ajankohtana.

Kevään kesäaikaan siirtymisen olematon Helsinki-seinäkellonaika hylätään. Syksyn toistuva tunti valitsee ensimmäisen esiintymän. Käyttöliittymä säilyttää intended date/time -arvot. V1 ei tarjoa syksyn toisen 03.xx-tunnin manuaalista valintaa. Raakakirjausta ei siirretä UTC-päivän puolelle.

## Puuttuva tieto ja kattavuus

null on tuntematon; 0 on tunnettu nolla. Tunnetut arvot summataan ilman välipyöristyksiä ja esitetään suomenkielisesti vasta näytössä. Osittainen tunnettu summa merkitään osittaiseksi eikä sitä väitetä koko saanniksi. Tyhjä päivä on puuttuva havainto, vaikka se merkittäisiin valmiiksi. Valmis päivä on käyttäjän oma kattavuusmerkintä. Aterian lisääminen, muokkaus, siirto ja poisto palauttavat asianomaisen päivän keskeneräiseksi.

Energia- ja proteiinikeskiarvoihin otetaan vain päivät, joilla kaikki kirjatut ainesosat sisältävät kyseisen arvon. Käyttäjä voi suodattaa vain valmiiksi merkityt päivät. Nimittäjä näytetään havaintopäivinä suhteessa kalenteripäiviin. Painokeskiarvo käyttää kuluvan päivän ja kuuden edellisen päivän olemassa olevia mittauksia, vähintään kolme. Puuttuvia mittauksia ei interpoloida.

Painotavoitteen suora kulkee profiilin lähtöpainosta ja -päivästä tavoitepäivään, päiväkohtaisen tavoitehistorian mukaan. Lähtöprofiilin korjaaminen voi muuttaa tätä vertailusuoraa; se ei muuta mittauksia tai ravintoainetavoitehistoriaa. Se ei ole ennuste tai turvallisuusarvio.

## Kuvat, vienti ja palautus

Kuvat validoidaan, puretaan selaimessa ja pienennetään JPEG-blobeiksi IndexedDB:hen. Ei automaattisia verkkopyyntöjä. JSON-viennissä blob muutetaan MIME-tyypiksi ja base64-sisällöksi. Tuonnissa validoidaan kokonainen schema, päivämäärät, ID:t, uniikit päiväkirjaukset, kuvien tunniste/MIME/kokorajat ja selaimen kuvan dekoodaus, aterioiden viitteet, aikaleimat ja lasketut snapshotit ennen kirjoitusta. Palautus tyhjentää ja täyttää kaikki taulut yhden Dexie-transaktion sisällä; epäonnistuminen peruu koko operaation.

CSV:n desimaalierotin on piste, erotin pilkku, UTF-8 BOM. Null-arvot ovat tyhjiä kenttiä. Taulukot sisältävät yksiköt, aikavyöhykkeen ja kattavuuden. Tekstikentistä poistetaan CSV-taulukkolaskennan kaavatulkinnan riski lisäämällä tarvittaessa apostrofi. CSV ei ole palautusmuoto: siihen eivät kuulu kuvat tai koko tietomalli.

## PWA ja turvallinen päivitys

vite-plugin-pwa/Workbox precache sisältää kaikki sovellusresurssit, ei henkilökohtaisia tietoja. Service worker rekisteröidään prompt-tilassa. Uuden version ilmoitus ei pakota sivun latausta; päivityspainike ei ole käytettävissä lomakkeen ollessa auki. Käyttäjä tallentaa ensin. Päiväkirja ei säilytä API-avaimia tai tokeneita eikä käytä localStoragea tai ulkoisia fontteja. Valinnainen AI-kutsu kulkee erillisen palvelimen kautta; sen vastauksia ei välimuistiteta. Tallennusvirheet ja quota-virheet näkyvät lomakkeessa tai ilmoituksessa. Persistent storagea pyydetään sekä ensimmäisen tallennuksen yhteydessä että asetuksista.

Demo on muistissa luotu erillinen Dataset. Sen tietueita ei kirjoiteta oikeaan IndexedDB:hen ja asetusten viennit on rajattu oikeaan dataan.

## Valinnainen palvelin (1.1)

`server/config.ts` validoi asetukset, `app.ts` hoitaa autentikoinnin ja reitit, `openai.ts` on Responses-adapteri ja `store.ts` on palvelimen rajatun tilan varasto. Node 24:n SQLite-kanta sisältää vain AI-yrityslaskurin ja ILMARI-luonnoslaatikon; ei profiilia, ateriahistoriaa, kuvia, painoja tai API-avaimia. Palvelimen schemaVersion on 1 ja tuntematon tuleva versio hylätään ennen migraatiokirjoituksia. Palvelinversion vaihto ei muuta IndexedDB:tä tai JSON-varmuuskopion versiota. Raakadata ja kaikki ravintoainelaskenta säilyvät selaimessa.

`src/ai/contracts.ts` määrittää analyysipyynnön, yhteystilan ja ILMARI-tuloskuoren. `client.ts` käyttää saman originin APIa. OpenAI-avain luetaan vain palvelimella; selain käyttää satunnaista HttpOnly-istuntoa. Käyttäjän suostumus rajaa lähetyksen aterialomakkeen kuvaukseen ja erikseen valittuun kuvaan. Vastauksen Zod-validointi ja muokattava luonnos edeltävät paikallista hyväksyntää.

ILMARI-token oikeuttaa vain skeeman hakemiseen ja luonnoksen jättämiseen. Se ei anna käyttöoikeutta AI-kutsuun, laatikon lukemiseen tai päiväkirjaan. Tuloskuoren source/externalId on idempotenssiavain seitsemän päivän sisällä. Hyväksymisen jälkeen paikalliseen ateriaan jää vastaanottotunniste; palvelimen kuittaus poistaa sisällön, mutta tunniste/tiiviste säilyvät määräajan duplikaattien torjuntaa varten. Kuittaus on best effort: yhteysvirhe ei peru jo tallennettua paikallista ateriaa. Eri laitteiden päiväkirjojen hyväksyntää ei synkronoida.

PWA:n sovellusbase, manifest, SW-scope, ikonit ja API-reitti ovat yhtenäisesti konfiguroitavissa. Workbox ei palauta sovellus-HTML:ää API-navigaatioon eikä cacheta API-vastauksia. Backend tarjoaa dist-resurssit ja no-cache-otsakkeet indexille/SW:lle. HTTPS-käytössä erillinen origin eristää Ravintopolun aiopsin hyväksyntäreiteistä; alihakemisto yksin ei eristä same-origin-JavaScriptiä.

Työasemalla (`palvelin/`, Python) Node-palvelinta ei ole. Ilmarin luonnokset tulevat tiedostopudotuksena hakemistoon,
jonka Python-palvelin lukee huoltosilmukassa, tarkistaa samoin säännöin ja tarjoilee reitillä `/api/luonnokset`
Tailscale-tunnistuksella (aiops ADR-0026). Sovelluksen luonnoslaatikko käyttää tätä reittiä; Node-palvelimen `/api/inbox`
jää sen omaksi reitiksi.

Kuvasta ateria (aiops ADR-0027): `src/ai/kuva-ateria.ts` lähettää kuvan reitille `/api/kuva-ateria`, ja Python-palvelimen
`kuva.py` kutsuu aiops-välittäjää Unix-soketissa (rooli `kuva_tulkki*` model-kenttänä), muuntaa mallin JSONin
AIDraft-luonnokseksi ja tarkistaa sen `luonnokset.tarkista_luonnos`-säännöillä. Sovellus luo aterian heti IndexedDB:hen
samalla `saveMeal`-polulla kuin lomake; snapshot lasketaan `nutrition.ts`:ssä. Tämä on ainoa toiminto, jossa AI:n luonnos
tallentuu ilman lomakkeen tarkistusta; alkuperä ja oletukset jäävät ateriaan näkyviin.

Katso [AI-integraatio](ai-integration.md) ja [ILMARI-sopimus ja live-työn rajat](ilmari-integration.md). Tuleva aiops-adapteri ei saa ohittaa gatewayta, politiikkaa tai hyväksyntää. Tämän version Node-palvelin on henkilökohtainen valinnainen API-välittäjä, ei yleiskäyttöinen agenttialusta tai usean laitteen synkronointipalvelu.
