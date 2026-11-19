# Arkkitehtuuri

## Moduulit ja datan kulku

`src/domain/model.ts` sisältää Zod-skeemat, yksiköt ja tyypit. `nutrition.ts` on ravintoaineiden ainoa laskentapaikka: per100-arvo × grammat / 100 tai annoksen ilmoitettu kokonaisarvo. Pakkauksen energiaa ei korvata makrolaskennalla. `dates.ts` vastaa Helsingin päivistä ja seinäkellon ajasta. `analytics.ts` käyttää raakakirjauksia. `paino.ts` on ainoa paikka, jossa vapaasta tekstistä poimitaan päivän paino ("paino 82,4"); epäselvää ei arvata, ja skeema pyöristää luvun yhteen desimaaliin. `src/data` toteuttaa Dexie-varaston, kuvat ja viennit. `src/ai` ei tunne tietokantaa eikä voi kirjoittaa sinne. Käyttöliittymä: `App.tsx` on kuori (yläpalkki, alapalkki, ilmoitukset), `src/nakymat/` sivut ja `src/components/` niiden osat; tyyli `src/style.css` on Ilmari Hubin tyyli.

UI validoi syötteen, muodostaa aterian ruokalistasta ja välittää sen `saveMeal`-funktiolle. Tietovarasto validoi uudelleen, laskee snapshotin ja ajankohdan sekä kirjoittaa aterian ja kuvan samassa transaktiossa. Dexien `useLiveQuery` päivittää näkymät kirjoituksen jälkeen. Myöhempi backend voi korvata tietovaraston rajat; puhtaat laskenta- ja analyysifunktiot säilyvät.

## Tietomalli ja versiot

Dexie version 1: profiles, goals, foods, meals, photos, templates, weights, lifestyles, days, settings. Jokaisella tietueella vakaa UUID ja createdAt/updatedAt. Painon, elintapojen ja päivän tilan date-indeksit ovat uniikkeja. Profiileja ja asetuksia on korkeintaan yksi. Tavoitehistoria valitaan effectiveDate-päivän mukaan; sama voimaantulopäivä korvataan profiililomakkeen transaktiossa.

Ateriarivi säilyttää nimen, valmistustilan, lähteen, syöttötavan, määrän ja ravintoarvot. foodId on viite kirjastoon, **ei laskennan lähde**. Aterialla on lisäksi laskettu snapshot, alkuperä, oletukset, kuva-ID ja muistiinpano. Kokonaisarvon snapshot on null, jos yhdelläkin ainesosalla on kyseinen arvo tuntematon. Alkuperäiset rivit säilyvät, joten tunnettu osasumma ja puuttuvien rivien määrä ovat laskettavissa erikseen. Vakioateria sisältää rivien snapshotit ja määrät; se ei ole suosikkiruoka. Kirjastosta poistaminen ei poista historiatietoa.

Uudessa tietokantaversiossa lisätään Dexie `version(2).stores(...).upgrade(...)`, jonka migraatio testataan kopioidulla v1-kannalla. Varmuuskopion schemaVersion on tästä erillinen ja nyt 1. Tuntemattomia versioita ei palauteta. Tulevat migraatiot validoidaan ensin muistissa ja kirjoitetaan vasta transaktiossa. Älä muuta v1-skeemaa julkaistun version jälkeen.

## Päivämäärät

Tarkoitettu paikallinen date säilyy ISO-päivänä ja meal.timestamp UTC-aikaleimana. timezone on Europe/Helsinki. Lomakkeet käyttävät tietovaraston CRUD-funktioita ja `saveProfileGoal`-operaatiota; ne eivät suorita suoria Dexie-kyselyitä. Päivän valinta, summat ja analyysit käyttävät aina date-arvoa. Kalenteripäivien aritmetiikka käyttää UTC:n keskipäivää vain ISO-päivien siirtämiseen; sitä ei käsitellä ateria-ajankohtana.

Kevään kesäaikaan siirtymisen olematon Helsinki-seinäkellonaika hylätään. Syksyn toistuva tunti valitsee ensimmäisen esiintymän. Käyttöliittymä säilyttää intended date/time -arvot. V1 ei tarjoa syksyn toisen 03.xx-tunnin manuaalista valintaa. Raakakirjausta ei siirretä UTC-päivän puolelle.

## Puuttuva tieto ja kattavuus

null on tuntematon; 0 on tunnettu nolla. Tunnetut arvot summataan ilman välipyöristyksiä ja esitetään suomenkielisesti vasta näytössä. Osittainen tunnettu summa merkitään osittaiseksi eikä sitä väitetä koko saanniksi. Tyhjä päivä on puuttuva havainto, vaikka se merkittäisiin valmiiksi. Valmis päivä on käyttäjän oma kattavuusmerkintä. Aterian lisääminen, muokkaus, siirto ja poisto palauttavat asianomaisen päivän keskeneräiseksi.

Energia- ja proteiinikeskiarvoihin otetaan vain päivät, joilla kaikki kirjatut ainesosat sisältävät kyseisen arvon. Kuluva päivä otetaan keskiarvoihin vasta, kun se on merkitty valmiiksi; osittainen summa on alaraja (ontto pylväs) eikä mene keskiarvoon. Nimittäjä näytetään havaintopäivinä suhteessa kalenteripäiviin. Painokeskiarvo käyttää kuluvan päivän ja kuuden edellisen päivän olemassa olevia mittauksia, vähintään kolme. Puuttuvia mittauksia ei interpoloida.

Kehityksen painokuvaajan tavoiteviiva on vaakasuora: tänään voimassa olevan tavoitteen tavoitepaino. Se ei ole ennuste tai turvallisuusarvio. Kuvaajat ovat omaa SVG:tä (`components/Kuvaaja.tsx`); asteikon laskenta on puhtaina funktioina (`components/asteikko.ts`).

## Kuvat, vienti ja palautus

Kuvat validoidaan, puretaan selaimessa ja pienennetään JPEG-blobeiksi IndexedDB:hen (enintään 700 kt). Kuva lähtee verkkoon vain, kun käyttäjä napauttaa Tulkitse kuva. JSON-viennissä blob muutetaan MIME-tyypiksi ja base64-sisällöksi. Tuonnissa validoidaan kokonainen schema, päivämäärät, ID:t, uniikit päiväkirjaukset, kuvien tunniste/MIME/kokorajat ja selaimen kuvan dekoodaus, aterioiden viitteet, aikaleimat ja lasketut snapshotit ennen kirjoitusta. Palautus tyhjentää ja täyttää kaikki taulut yhden Dexie-transaktion sisällä; epäonnistuminen peruu koko operaation.

CSV:n desimaalierotin on piste, erotin pilkku, UTF-8 BOM. Null-arvot ovat tyhjiä kenttiä. Taulukot sisältävät yksiköt, aikavyöhykkeen ja kattavuuden. Tekstikentistä poistetaan CSV-taulukkolaskennan kaavatulkinnan riski lisäämällä tarvittaessa apostrofi. CSV ei ole palautusmuoto: siihen eivät kuulu kuvat tai koko tietomalli.

## PWA ja turvallinen päivitys

vite-plugin-pwa/Workbox precache sisältää kaikki sovellusresurssit, ei henkilökohtaisia tietoja. Service worker rekisteröidään prompt-tilassa. Uuden version ilmoitus ei pakota sivun latausta; päivityspainike ei ole käytettävissä lomakkeen ollessa auki. Käyttäjä tallentaa ensin. Päiväkirja ei säilytä avaimia tai tokeneita. localStoragessa on vain viimeksi tunnettu väri, jonka `public/vari.js` asettaa ennen ensimmäistä piirtoa; kirjasimet tulevat omasta alkuperästä (`public/fonts/`). API-vastauksia ei välimuistiteta. Tallennusvirheet ja quota-virheet näkyvät lomakkeessa tai ilmoituksessa. Persistent storagea pyydetään tallennusten yhteydessä.

## Työaseman palvelin

`palvelin/` (Python, Starlette, uv) kuuntelee Unix-soketissa, ja Tailscale Serve välittää siihen portista 8443. Se
tarjoilee käännöksen turvaotsakkein (CSP ilman inline-skriptejä ja -tyylejä, `font-src 'self'`) ja reitit:
`/api/synk` (synkronointi, aiops ADR-0016), `/api/luonnokset` (Ilmarin luonnokset, ADR-0026), `/api/kuva-ateria` ja
`/api/tavoitteet` (aiops-välittäjän kautta, ADR-0025/-0027) sekä `/api/ulkoasu`. Tunnistus on Tailscale-identiteetti,
ja muuttavat pyynnöt vaativat saman alkuperän.

Värit: Ilmari Hub asettaa evästeen `ilmari_vari`. Se on HttpOnly, joten sovellus kysyy värin reitiltä `/api/ulkoasu`
(arvo on aina yksi neljästä, oletus paperi), asettaa `<html data-vari>`, `color-scheme` ja `theme-color` sekä muistaa
värin seuraavaa käynnistystä varten (`src/vari.ts`). Palvelin ei aseta evästettä.

Kuvan tulkinta, tavoite-ehdotus ja luonnokset: [ILMARI ja aiops](ilmari-integration.md).
