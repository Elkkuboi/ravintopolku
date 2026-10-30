# Ravintopolku 1.1

Suomenkielinen ruokailu-, paino- ja elintapapäiväkirja. Päiväkirja toimii paikallisesti ja offline-tilassa. Valinnainen Node-palvelin lisää **OpenAI API -luonnokset** ja **ILMARIsta vastaanotettavat aterialuonnokset**. AI ei tallenna aterioita: käyttäjä tarkistaa ja hyväksyy ne. Tuotannon päiväkirja alkaa tyhjänä; kokeilutila on eristetty.

React, TypeScript, Vite, Dexie/IndexedDB, Zod, Recharts, Workbox/PWA ja Fastify. Palvelimella ei ole päiväkirjan kopiota tai käyttäjätilirekisteriä. OpenAI-yhteys tarvitsee erikseen API-avaimen ja API-laskutuksen; ChatGPT-tilaus ei korvaa niitä.

## Käynnistys Ubuntu Linuxissa

Tarvitset Node.js **24 LTS** (testattu 24.19.0) ja npm:n (testattu 11.9.0). Jos Node puuttuu, sen voi asentaa käyttäjän hakemistoon nvm:llä (curl tarvitaan):

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh -o /tmp/ravintopolku-nvm-install.sh
bash /tmp/ravintopolku-nvm-install.sh
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 24.19.0
nvm use 24.19.0
```

Nämä ovat omaa konettasi varten annettuja ohjeita; asennusta ei tehty kotikoneelle. Käytä lukittuja riippuvuuksia:

```bash
unzip ravintopolku-v1.1.zip
cd ravintopolku
npm ci
npm run setup
```

`setup` luo `.env`-tiedoston oikeuksilla 0600 sekä satunnaisen palvelusalasanan ja erillisen integraatioavaimen. Olemassa olevaa tiedostoa ei korvata. Avaa tiedosto omalla editorillasi, esimerkiksi `nano .env`. Lisää:

```dotenv
OPENAI_API_KEY=oma_API_avain
OPENAI_MODEL=omaan_API_projektiin_saatavilla_olevan_mallin_tunnus
```

Valitse virallisen [malliluettelon](https://developers.openai.com/api/docs/models) perusteella **Responses APIa ja strict structured outputia** tukeva malli. Kuvan tulkinta vaatii lisäksi vision-tuen; aseta `OPENAI_IMAGE_INPUT=false`, jos käytät tekstimallia. Avain ja mallin käyttöoikeus pitää vahvistaa omassa OpenAI-projektissasi. Älä lähetä avainta chattiin tai lisää sitä `VITE_`-muuttujaan.

```bash
npm run build
npm start
```

Avaa **http://localhost:3001**. Luo profiili. Asetukset → AI-palvelu ja ILMARI → anna `.env`-tiedoston **APP_PASSWORD**. Tämä on paikallisen palvelun salasana, ei OpenAI-avain. Aterialomakkeessa avaa **Pyydä AI-luonnos**, valitse tehtävä, kirjoita kuvaus ja hyväksy lähetys. Kuva lähetetään vain erikseen valittuna. Tarkista palautettu luonnos ja tallenna ateria. Ilman API-avainta tai palvelinyhteyttä käsinkirjaus, JSON-tuonti ja kaikki paikalliset ominaisuudet toimivat.

Palvelin kuuntelee vain loopbackissa. Komennot eivät asenna systemd-palveluita, julkaise sovellusta tai muuta aiopsia, Tailscale Serveä, palomuuria tai reititintä. `.env` pitää säilyttää yksityisenä. Palvelin on käynnissä vain niin kauan kuin `npm start` -prosessi; Ctrl+C lopettaa sen.

## Kehittäminen ja puhelintesti

```bash
npm run dev:full
```

Avaa **http://localhost:5173**. Vite välittää `/api`-pyynnöt localhostin Node-palvelimelle porttiin 3001. `.env` luetaan palvelimen käynnistyessä; asetusten muutoksen jälkeen käynnistä palvelin uudelleen. `npm run dev` käynnistää pelkän käyttöliittymän. `npm run preview` tarjoaa vain staattisen käännöksen ilman APIa.

Vite kuuntelee lähiverkossa. `http://TIETOKONEEN_LAN_IP:5173` sopii lomakkeiden ja ulkoasun kokeiluun, mutta **puhelimen LAN-IP HTTP ei ole localhost eikä yleensä secure context**. Se ei todista PWA-asennettavuutta tai offline-toimintaa. AI-palvelin sallii oletuksena vain määritetyt localhost-originit; LAN-käyttö ei ole sen tuotantoreitti.

## Android Chrome ja yksityinen HTTPS-käyttöönotto

Sovellusta ei ole julkaistu eikä kotikoneen palveluita muutettu tässä työssä. APIa käyttävä tuotantoversio tarvitsee Node-palvelimen ja saman originin HTTPS-välityksen myös `/api`-reitille. `dist/` yksin riittää paikalliseen päiväkirjaan ja käsin käytettävään AI-tuontiin.

1. Valitse **erillinen Ravintopolun HTTPS-origin** yksityisestä verkostasi ja varmista Androidin luottama varmenne. Aseta `.env`:iin `APP_ORIGIN=https://OMA_RAVINTOPOLKU_OSOITE`, käännä ja käynnistä Node loopbackissa. Välityksen tulee säilyttää oikea `Host`-otsake sekä polku, Origin ja evästeet. Älä luota asiakkaan lähettämiin Tailscale-identiteettiotsakkeisiin tässä palvelussa.
2. Aiopsin nykyinen `https://tyoasema.taild1a5b7.ts.net/` kuuluu gatewaylle. **Älä korvaa sen Serve-määritystä tai avaa uusia portteja** näillä ohjeilla. Saman originin alihakemisto ei eristä JavaScriptiä aiopsin hyväksyntäreiteistä. Erillinen origin on suositus; tarkka Tailscale/DNS/reverse proxy -kytkentä on tehtävä aiopsin omien ohjeiden ja verkkopolitiikan mukaan erillisenä käyttöönottona. Katso [ILMARI-integraatio](docs/ilmari-integration.md).
3. Avaa valittu HTTPS-osoite Pixelin Chromessa, lataa sovellus ja odota offline-valmiutta. Valikosta **Lisää aloitusnäyttöön → Asenna**. Pelkän itse allekirjoitetun varmenteen varoituksen ohittaminen ei ole luotettava asennusratkaisu.
4. Varmista oikealla puhelimella standalone-käynnistys, kamera, virtuaalinäppäimistö, lentotilassa uudelleenkäynnistys sekä JSON-varmuuskopion vienti ja palautus. AI tarvitsee verkkoyhteyden; paikallinen kirjaus ja kuvaajat eivät.

Alihakemistotuki on toteutettu: esimerkiksi `VITE_APP_BASE=/ravintopolku/` käännöksessä ja `APP_BASE_PATH=/ravintopolku/` palvelimella. Manifesti, ikonit, API-polku ja service worker rajautuvat siihen. Palvelin hylkää käännöksen, jonka manifestin scope ei vastaa peruspolkua. Tämä tekninen tuki ei tee saman originin aiops-kytkennästä eristettyä. `APP_DIST_DIR` voi osoittaa toiseen käännöshakemistoon.

**Tallennus kuuluu originille:** domainin, protokollan tai portin vaihto, esimerkiksi kehityksen 5173 → tuotannon 3001, luo uuden IndexedDB-alkuperän. Vie JSON-varmuuskopio vanhassa osoitteessa ja palauta uudessa. Päiväkirja ei synkronoidu tietokoneen ja puhelimen välillä. Persistent storage -pyyntö ei korvaa varmuuskopiota.

## Päiväkirjan ominaisuudet

- Profiili, vapaaehtoiset käyttäjän ravintoainetavoitteet ja voimaantulopäivillä säilyvä tavoitehistoria.
- Omat ruuat per 100 g -arvoilla, suosikit, moniosaiset ateriat grammoineen ja vaihtoehtoinen annoksen kokonaisarvojen syöttö. Puuttuva arvo on null; tunnettu nolla säilyy nollana. Snapshot suojaa aiempia aterioita ruokakirjaston muutoksilta.
- Kuvan liittäminen, muokkaus, kopiointi, siirto, poisto ja vakioateriat määrineen. JPG/PNG/WebP: alkuperäinen enintään 15 Mt, pienennetty JPEG enintään 1600 px / 2 Mt. Kuva säilyy IndexedDB:ssä.
- Yksi muokattava painomittaus päivässä, vapaaehtoiset elintavat ja käyttäjän merkintä päivän valmistumisesta. Ateriamuutos palauttaa päivän keskeneräiseksi.
- Kuvaajat 7/30/90 päivälle: painopisteet, 7 kalenteripäivän keskiarvo vähintään kolmella mittauksella, tavoitesuora, energia, proteiini ja ravintoainetaulukko. Puuttuva päivä ei muutu nollaksi; nimittäjä näkyy.
- Etusivun makrokuvaajat: energia, proteiini, hiilihydraatit ja rasva seitsemänä päivänä valitusta päivästä taaksepäin. Tyhjä kohta on puuttuva havainto eikä nolla, raidoitettu palkki on osittainen summa ja jää keskiarvon ulkopuolelle; katkoviiva on valitun päivän ravintoainetavoite. Päivän makromittarit jäävät niiden yläpuolelle.
- Täydellinen JSON-varmuuskopio kuvineen ja transaktionaalinen palautus esikatselulla sekä KORVAA-vahvistuksella. CSV-viennit ateriariveistä, painoista ja päivistä. Varmuuskopion tuontiraja 100 Mt. Varmuuskopio sisältää yksityiset tiedot selväkielisinä.
- Vaalea/tumma tila, kokeilutila ja offline-kirjaus aiemman onnistuneen latauksen jälkeen. Päivitystä ei pakoteta avoimen lomakkeen yli.
- OpenAI API: pakkauksen tulkinta, annoksen tulkinta ja ateriaehdotus. Käsin käytettävä **Kopioi ohje tekoälylle** ja validoitu JSON-tuonti säilyvät vaihtoehtoina.
- ILMARI: autentikoitu versionoitu tulosrajapinta, JSON-skeema, OpenAPI-kuvaus ja lähetys-CLI. Vastaanotetut luonnokset näkyvät Asetuksissa ja avautuvat muokattaviksi. Tämä ei käynnistä tai hyväksy aiops-töitä.

## Rajat ja palvelimen tiedot

Oletukset: 30 AI-kutsuyritystä / Helsinki-kalenteripäivä, enintään kaksi samanaikaista kutsua, 60 s aikaraja, 4096 output-tokenia, 2 Mt kuva ja 3 MiB HTTP-pyyntö. Päiväkohtainen laskuri säilyy palvelimen uudelleenkäynnistyksessä. Myös providerin virheeseen päättyvä yritys lasketaan. Pyyntökatto **ei ole euromääräinen laskutuskatto**; tarkista projektin käyttörajat, hinnat ja laskutus OpenAI:ssa.

Istunto on 8 tunnin HttpOnly/SameSiteStrict-eväste (HTTPS:llä Secure); palvelimen uudelleenkäynnistys vaatii uuden kirjautumisen. Palvelin ei tallenna AI-syötteitä tai OpenAI-vastauksia. ILMARI-luonnokset säilyvät `server-state/service.sqlite`-kannassa enintään seitsemän päivää ja laatikossa voi olla 100 odottavaa luonnosta. Hyväksymisen/hylkäämisen kuittaus poistaa sisällön; tunniste ja tiiviste jäävät hetkeksi duplikaattien torjumiseen. Sovelluksen JSON-varmuuskopio sisältää paikallisen päiväkirjan, ei palvelimen odottavia luonnoksia, laskureita tai salaisuuksia. Kanta sisältää yksityisiä luonnoksia: pidä hakemisto yksityisenä (0700, kanta 0600).

## Tarkistukset ja toimituksen rajat

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:subpath
npm run schema
```

Selainajo käynnistää oikean tuotantopalvelimen portissa 4173 testiasetuksilla, ei lue `.env`:iä eikä tee maksullisia OpenAI-kutsuja. Build on ajettava ensin. Ubuntu voi tarvita `npx playwright install --with-deps chromium` -järjestelmäriippuvuudet. Testit kattavat myös profiilin, aterian, kuvan palautuksen, muokkauksen, vakioaterian, painot, kuvaajat, säilymisen ja offline-kirjauksen. Tarkat tulokset: [docs/testing.md](docs/testing.md).

**Live-aktivointi jää paikallisiin tunnuksiisi:** tässä ympäristössä ei ole OpenAI-avainta eikä tehty maksullista kutsua. API-sopimus ja virhetilat on testattu kontrolloiduilla vastauksilla; oikea malli, avain, laskutus ja kuva-analyysin laatu on vielä varmistettava omassa projektissasi. Aiopsin lähdekoodia ei saatu luettua (GitHub-tunnistus palautti HTTP 401), joten toimitus sisältää testatun Ravintopolun vastaanottimen ja lähetys-CLI:n, ei live-aiopsin job-adapteria. Oikeaa Pixel 10a:ta ei ollut käytössä. Mitään ei julkaistu.

Dokumentit: [arkkitehtuuri](docs/architecture.md), [AI](docs/ai-integration.md), [ILMARI](docs/ilmari-integration.md), [kirjastot](docs/dependencies.md) ja [analytiikan jatkotyö](docs/analytics-roadmap.md). Seuraavat työt: paikallinen avain/mallikoe ja puhelimen HTTPS-varmistus; aiops-repon tarkastuksen jälkeen erillinen sallittu tulosvälittäjä ilman gatewayn tai dispatcherin verkkovaltaa; myöhemmin regressio, robusti tasoitus ja epävarmuus kattavuuskriteereineen. JSON- ja integraatioskeemojen versio on edelleen 1; merkitystä muutettaessa tarvitaan versionnosto ja migraatio.

## Työasemalla (aiops ADR-0014, vaihe R1)

Päiväkirja tarjoillaan työaseman Tailscale Serven kautta omassa alkuperässään `https://tyoasema.taild1a5b7.ts.net:8443`
ilman Node-palvelinta: ei OpenAI-luonnoksia, ei ILMARI-laatikkoa eikä salasanaa. Päiväkirja on puhelimen selaimessa, joten
ota JSON-varmuuskopio säännöllisesti (Asetukset → Varmuuskopio).

Käännös ja asennus repon juuresta: `sudo scripts/asenna-tyoasema.sh`. Skripti kääntää commitoidun koodin kertakäyttöisissä
konteissa tiivisteellä kiinnitetystä Node 24 -imagesta (riippuvuudet ilman asennusskriptejä, testit ja käännös ilman verkkoa)
ja asentaa vain `dist/`-hakemiston kohteeseen `/opt/ravintopolku/dist`. Serve-määritys ja tailnet-politiikka ovat aiops-repon
isäntämuutoksia.

## Synkronointi työasemalle (aiops ADR-0016, vaihe R2)

Työasemalla portin 8443 takana on Ravintopolun oma palvelin (`palvelin/`, Python): se tarjoilee sovelluksen turvaotsakkein
ja synkronointirajapinnan Tailscale-tunnistuksella. Päiväkirja synkronoituu laitteiden välillä automaattisesti (käynnistyessä,
5 minuutin välein, verkon palatessa) ja käsin Asetusten Synkronointi-osiosta. Palvelin ratkaisee ristiriidat saapumisjärjestyksessä,
myös saman päivän merkinnöissä, ja poistot säilyvät. Yli 25 poistoa kerralla vaatii vahvistuksen. Kuvat pysyvät laitteella.

Palvelin ottaa päivittäisen varmuuskopion (30 päivää) ja kirjoittaa nykytilan julkiseen datahakemistoon Ilmarin luettavaksi.
Testit: `cd palvelin && uv run --frozen pytest -q` ja `npm test`. Asennus: `sudo scripts/asenna-tyoasema.sh "$(command -v uv)"`.

## ILMARIn luonnokset työasemalla (aiops ADR-0026)

Ilmari pudottaa aterialuonnokset tiedostoina hakemistoon `/srv/aiops/ravintopolku/luonnokset`, josta työaseman palvelin
lukee ne ja näyttää Asetusten ILMARIn luonnoslaatikossa. Käyttäjä avaa luonnoksen, tarkistaa ja tallentaa aterian;
mitään ei kirjata päiväkirjaan automaattisesti. Node-palvelinta tai salasanaa ei tarvita: tunnistus on Tailscale-identiteetti.
Asennus: lisää `luonnokset = "/srv/aiops/ravintopolku/luonnokset"` tiedostoon `/etc/ravintopolku/palvelin.toml`, luo hakemisto
`sudo install -d -o aiops-gw -g ravintopolku -m 2770 /srv/aiops/ravintopolku/luonnokset` ja käynnistä palvelu uudelleen
(`sudo systemctl restart ravintopolku.service`). Kelvottomat tiedostot jäävät alihakemistoon `hylatyt/` syineen.
Tiedostomuoto ja säännöt: [ILMARI-integraatio](docs/ilmari-integration.md).

## Kuvasta ateria (aiops ADR-0027)

Kotinäkymän **Kuvaa ateria** luo aterian pelkästä kuvasta – ruoka-annoksesta tai pakkauksen takaetiketistä (arvot
per 100 g ja pakkauksen paino) – eikä vaadi muita kenttiä. Työaseman palvelin lähettää kuvan aiops-välittäjälle
Unix-soketissa; välittäjän rooli valitaan Asetukset → Kuvantulkinta (Hubin valinta, pilvi tai paikallinen malli) tai
Ilmari Hubista. Ateria tallentuu heti alkuperällä `Kuvasta (rooli X)` ja mallin oletuksilla; ilmoituksen **Avaa** avaa
sen muokattavaksi. Asennus: lisää `valittaja = "/run/aiops-valittaja/valittaja.sock"` tiedostoon
`/etc/ravintopolku/palvelin.toml` ja käynnistä palvelu uudelleen. Sopimus, roolit ja rajat:
[ILMARI-integraatio](docs/ilmari-integration.md#kuvasta-ateria-aiops-adr-0027).

## Tavoitteet sanoin

Asetusten **Tavoitteet omin sanoin** -kortissa kirjoittaa tavoitteensa vapaina sanoin ("painon lievä pudotus", "rasvan
muuttaminen lihakseksi") tai valitsee valmiin kuvauksen. Sovellus lähettää tekstin työaseman palvelimelle, joka kutsuu
aiops-välittäjää samalla soketilla ja rooliperinteellä (`tavoite_ehdottaja`) kuin kuvan; Ilmari ehdottaa päivän
energia- ja makrotavoitteet sekä lyhyen perustelun. Ehdotus näkyy tarkistettavana ja korjattavana, ja vasta **Hyväksy ja
tallenna** kirjoittaa päivän tavoitteen — hylätty tai epäonnistunut ehdotus ei muuta mitään. Numerot tarkistetaan
äärirajojen ja makrojen suhteen sekä palvelimella että selaimessa. Roolit ja rajat:
[ILMARI-integraatio](docs/ilmari-integration.md#tavoitteet-luonnollisesta-kielestä).
