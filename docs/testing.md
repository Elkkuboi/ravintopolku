# Testaus

## Ympäristö

Ubuntu-pohjainen hallittu Linux-työtila, Node 24.19.0 / npm 11.9.0. Chromium 153 (Playwright 1.63). Testit ajetaan Viten tuotantokäännöstä tarjoavaa oikeaa Fastify-palvelinta vasten localhostissa, ei kehityspalvelimella. Selainkomennolle annettiin tämän ympäristön vaatima verkkolupa localhost-kuuntelua varten. E2E-palvelin käyttää tilapäistä kantaa ja testitunnuksia, ei paikallista .env-tiedostoa. Mitään ei julkaistu.

## Automatisoidut testit

Vitest testaa:

- 150 g × 200 kcal/100 g = 300 kcal; annoksen arvot eivät tule vahingossa kerrotuiksi.
- Tuntematon kuitu pysyy nullina, tunnettu nolla pysyy nollana, tunnettu osasumma merkitään osittaiseksi.
- Desimaalipilkku ja epäkelpojen arvojen hylkääminen.
- Päiväkohtainen tavoitehistoria.
- Helsingin UTC-vuorokauden rajat, kesä-/talviaika, siirtymät ja olematon kellonaika.
- 7 **kalenteripäivän** painokeskiarvo, vähintään 3 mittausta ja oikea nimittäjä.
- Puuttuvat päivät jäävät havainnoista pois eivätkä muutu nolliksi.
- Virheellinen AI-JSON ja Disabled-/MockProviderin käyttäytyminen.
- Ruokakirjaston muutos ei muuta aiemman aterian snapshotia.
- JSON palauttaa aterian, null-arvot ja blob-kuvan.
- Tuntematon varmuuskopioversio, vioittunut kuva ja päällekkäiset painopäivät eivät muuta tietokantaa.
- CSV-yksiköt, kattavuus, alkuperä, aikavyöhyke ja tyhjät arvot.
- Päänavigaatiossa on kolme välilehteä (Tänään, Kehitys, Asetukset); erillistä Päiväkirja-näkymää ei ole, koska "Tänään" näyttää saman sisällön.
- Kuvasta ateria: kuva ja vapaat lisätiedot lähtevät yhtenä multipart-pyyntönä (`vihje`-kenttä), liian pitkät lisätiedot hylätään lähettämättä kuvaa ollenkaan, rajan 300 merkin teksti säilyy sellaisenaan ateriaan asti, eikä Kuvaa ateria -valitsimessa ole pakotettua kameraa.

Playwrightin mobiili-Chromium testaa:

- Profiilin luonti ilman ravintoainetavoitteita, suosikkiruuan luonti, moniosainen ateria, annoslaskenta ja aterian muokkaus.
- Ruokakirjaston muokkaus ja historian muuttumattomuus, vakioaterian tallennus ja käyttö.
- Painokirjaus desimaalipilkulla, päivän valmius, kuvaajat ja reloadin jälkeinen säilyminen.
- AI:n virheellinen JSON ja kelvollisen vastauksen avautuminen hyväksymistä odottavaksi luonnokseksi.
- Oikean PNG-tiedoston pienennys ja esikatselu, JSON-vienti, palautuksen esikatselu, väärän vahvistuksen estäminen, vahvistettu palautus, näkyvä kuva ja CSV-lataus.
- Offline-käynnistys, aterian lisäys, reload, offline-muokkaus ja kuvaajan käyttö tuotantoversiolla.
- Kuvaa ateria: kuva ja vapaa lisäteksti lähtevät samana pyyntönä, teksti näkyy avatussa luonnoksessa mallin oletusten joukossa ja kenttä tyhjenee onnistuneen tallennuksen jälkeen.
- Näkymät 360, 393, 430 ja 1440 pikselissä, kolmen välilehden navigaatio (entistä Päiväkirja-välilehteä ei tarjota), sivun vaakavierityksen puuttuminen ja selainvirheet. Kuvakaappaukset syntyvät `test-results/`-hakemistoon.

Lopullinen v1.1-ajo 4.10.2026: `npm run typecheck`, `npm run lint`, `npm test` (33/33), `npm run build` ja `npm run test:e2e` (11/11) onnistuivat. Tuotantokäännös tuottaa manifestin, ikonit, service workerin ja kaikki sovellusresurssit (14 precache-merkintää). Ei buildin chunk-varoituksia. `npm run schema` generoi version 1 AI-skeeman.

Selainajo sisältää lisäksi aterian kopioinnin, siirtämisen ja poistamisen, vapaaehtoiset elintavat, painomittauksen päällekkäisyyden avaamisen muokattavaksi, tumman tilan, kokeilutilan eristyksen ja virheellisen kuvan jälkeisen käsinkirjauksen. Yksikkötesti simuloi palautuksen kirjoitusvirheen ja varmistaa kaikkien aiemmin käsiteltyjen taulujen rollbackin. Puuttuva massa hyväksytään AI-luonnoksessa mutta estetään lopullisessa per100-ateriakirjauksessa; luonnoksen energia ei muutu nollaksi. Playwrightin HTML-raportti syntyy `playwright-report/`-hakemistoon; epäonnistumisesta tallennetaan trace.

## Laitevarmistukseen jäävät tarkistukset

Oikeaa Google Pixel 10a:ta ei ole käytössä. Pixel 7 -profiilin Chromium-emulaatio käyttää 393 px:n viewportia; tätä ei pidä tulkita fyysisen laitteen testiksi. Varmista Pixel 10a:n Android Chromessa:

1. HTTPS-originiin asennus ja standalone-käynnistys kotinäytöltä; ikonit ja safe area.
2. Kameran ja gallerian tiedostovalitsin, käyttöoikeuden epääminen, iso kuva ja kuva ilman verkkoyhteyttä.
3. Suomen numeronäppäimistö/desimaalipilkku ja viimeisen lomakekentän sekä tallennuspainikkeen näkyminen virtuaalinäppäimistön kanssa.
4. Lentotila, prosessin sulkeminen ja offline-uudelleenkäynnistys, sekä blob-kuvien säilyminen.
5. Androidin lataus-/tiedostovalitsin JSON-viennissä ja palautuksessa.
6. Selaimen persistent storage -päätös ja varmuuskopion palautus ennen pitkän aikavälin käyttöä.
7. Service workerin päivitysilmoitus kahden julkaistun version välillä; avoin lomake pitää tallentaa ennen päivitystä. Päivityksen estoa toteutetaan koodissa, mutta versionvaihto ei ole fyysisesti testattu.

Tallennustilan täyttymisen virhe käsitellään sovelluksessa. Todellista laitteen levytilan loppumista tai selaimen automaattista tietojen siivousta ei simuloitu tässä ympäristössä. Pitkäaikaista säilymistä ei voi luvata IndexedDB:n perusteella.

## OpenAI- ja ILMARI-testit 1.1

Vitestin 14 lisätestiä kattavat istuntokirjautumisen, HttpOnly/SameSiteStrict/Secure-evästeet ja logoutin, väärän salasanan, Origin-/Host-suojaukset, rajatun integraatioavaimen, suostumuksen ja tehtävän validoinnin, Responses-endpointin ja strict-output-pyynnön, kuvan data-URLin ja tunniste-/kokorajat, kuvakyvyttömän providerin, negatiiviset arvot, rikkinäisen JSONin, refusal/incomplete-tilat, avaimen piilottamisen virheistä, upstream-aikarajan, pysyvän päiväkaton, ILMARI-idempotenssin ja ristiriidan, hylätyn luonnoksen sisällön poistamisen, restricted-kiellon sekä alihakemiston API-reitit.

Neljä uutta Playwright-polkua käyttävät oikeaa istuntopalvelua: API-luonnos odottaa hyväksyntää, kuva jää lähettämättä oletuksena ja lähtee vain valittuna, käyttäjän muuttama massa lasketaan uudelleen ja säilyy reloadissa; ILMARIn oikea HTTP-vastaanotto ja idempotenssi eivät kirjaa ateriaa automaattisesti; provider-virhe jättää käsinkirjauksen käyttöön. Viivästynyt provider-vastaus tarkistetaan lomakkeen uusinta tilaa vasten: odotuksen aikana lisätty käsinkirjaus ei korvaudu ilman vahvistusta. OpenAI-providerin vastaukset ovat **nimettyjä testisimulaatioita**. Oikeaa OpenAI-verkkokutsua tai laskutusta ei tehty, koska avainta ei ole.

`npm run test:subpath` tekee erillisen tuotantokäännöksen tilapäishakemistoon peruspolulla `/ravintopolku/`. Se tarkistaa API-polun, manifestin start_url/scope/ikonit, todellisen service workerin scopen ja offline-käynnistyksen 360 px:n Chromiumissa. Samalla se suorittaa oikean ILMARI-CLI:n schema- ja submit-komennot käynnissä olevaa vastaanotinta vasten ja varmistaa laatikon sisällön. Käyttää porttia 4184 ja poistaa tilapäisen tilan; ei tarvitse OpenAI-avainta tai aiopsia. Aja `npx playwright install chromium` ennen testiä.

Aiopsin live-repo ei ollut luettavissa (HTTP 401), joten job-adapteria, hyväksyntöjä, puhelimen passkeyta tai Tailscale Serve -kytkentää ei testattu eikä muutettu. Valmis tulosrajapinta ei ole väite live-aiops-integraatiosta. OpenAI-mallin yhteensopivuus ja ravintoarvioiden laatu tulee vielä testata omilla tunnuksilla. Palvelusalasanan luonti ja olemassa olevan .env-tiedoston säilyminen tarkistetaan eristetyssä setup-kokeessa; salaisuuksia ei tulosteta tai pakata toimitukseen.
