# ILMARI / aiops -tulosliitäntä

Ravintopolku 1.1 tarjoaa **aterialuonnosten vastaanoton**, lähetys-CLI:n, versionoidun JSON-sopimuksen ja käyttäjän tarkistusnäkymän. Se ei ole aiopsin dispatcher, hyväksyjä tai työjonon käyttöliittymä. Vastaanotin toimii paikallisesti testattuna; aiopsin live-kytkentää ei ole tehty.

## Lähtötilan rajat

Käyttäjän toimittama 3.10.2026 tilannekuva kuvaa aiopsin schema 3 / commit d26974e -asennusta: gateway on Unix-soketissa ja Tailscale Serve välittää siihen, gatewaylla ja dispatcherilla ei ole verkkoa eikä AI-agenttia ole vielä kytketty. Tässä työtilassa aiops-repoa ei ole. GitHubin lukuyritys palautti HTTP 401, joten sen reittejä, job-skeemaa ja ADR-ohjeita ei voitu tarkistaa lähdekoodista. Tilannekuvaa ei ole varmennettu livenä.

Ravintopolku ei muuta nykyisiä palveluita, tietokantoja, passkey-reittejä, hyväksyjäavaimia, Dockeria tai Tailscale Serveä. Erityisesti **ILMARI_INTEGRATION_TOKEN ei ole aiopsin hyväksyjäavain**. Se ei oikeuta töiden hyväksyntään, ajoon tai Ravintopolun päiväkirjan lukemiseen. Gatewayn ja dispatcherin verkko-oikeuksia ei muuteta tämän integraation vuoksi.

## Sopimus

- [OpenAPI 3.1](ilmari.openapi.json): palvelun suhteellinen juuri `/api/integrations/v1` (alihakemistossa lisää sovelluksen peruspolku).
- [Tuloskuoren JSON-skeema](../integrations/ilmari/result.schema.json).
- [Aterialuonnoksen skeema](ai-draft.schema.json).
- [Selvästi merkitty testiesimerkki](../integrations/ilmari/example-result.json).

`GET /api/integrations/v1/schema` palauttaa luonnoksen skeeman ja kyvykkyydet. `POST /api/integrations/v1/drafts` vastaanottaa yhden tuloskuoren. Molemmat vaativat `Authorization: Bearer <ILMARI_INTEGRATION_TOKEN>`. Salaisuus ei kuulu URL:iin, JSON-runkoon, komentorivin argumenttiin tai mallin promptiin.

Tuloskuori:

```json
{
  "schemaVersion": 1,
  "source": "ilmari",
  "externalId": "job-42-result-1",
  "dataClass": "private",
  "draft": { "...": "AIDraft-skeeman mukainen kokonainen objekti" }
}
```

Yllä oleva draft on havainnollistus, ei validoitu lähetettävä esimerkki. Käytä linkitettyä kokonaisesimerkkiä. `source` on 1–64 merkkiä (ASCII-kirjaimet/numerot ja `_-`); `externalId` 1–128 merkkiä (ASCII-kirjaimet/numerot ja `._:-`). `dataClass`: public/private/restricted. **restricted hylätään sekä CLI:ssä ennen siirtoa että vastaanottimessa (403)**. Tulosvälittäjän pitää johtaa dataluokka aiopsin todennetusta työstä ja politiikasta, ei mallin tekstistä; JSONin dataClass ei yksin todista luokitusta. Yksityistä dataa ei saa lähettää frontier-APIin tämän kautta: tulosliitäntä vastaanottaa jo muodostetun luonnoksen, ei käynnistä OpenAI-kutsua. Ravintopolun OpenAI-toiminnon lähetys on erillinen käyttäjän suostumukseen perustuva syöte, ei aiopsin private-datahakemiston vienti.

Sama `source + externalId` ja sama sisältö palauttaa 200 sekä saman id:n (state on pending_review tai käsitellylle already_reviewed); ensimmäinen vastaanotto palauttaa 201. Sama tunniste eri sisällöllä palauttaa 409. Uudessa korjatussa tuloksessa käytä uutta externalId:tä. Deduplicointi toimii seitsemän päivän säilytysajan sisällä. Vastaanotossa tietokantaan tallentuu **pending_review-luonnos**, ei ateria.

Luonnos avataan sovelluksen Asetuksista, käyttäjä täydentää massat/tiedot ja hyväksyy aterian. Vasta silloin selain kirjoittaa IndexedDB:hen. Kuittaus poistaa palvelinlaatikon sisällön; tunniste ja tiiviste säilyvät alkuperäiseen seitsemän päivän määräaikaan asti. Jos kuittaus epäonnistuu, paikallisen aterian luonnos-ID estää tahattoman uudelleenavauksen samassa päiväkirjassa. Tämä ei lupaa exactly-once-kirjausta useaan laitteeseen: päiväkirja on laitekohtainen. Integraatio ei kuljeta kuvia; käyttäjä voi lisätä kuvan aterialomakkeessa erikseen.

Virheet: 401 väärä avain, 403 data/Origin-kielto, 409 tunnisteristiriita, 413 liian suuri pyyntö, 422 virheellinen skeema, 429 raja. Laatikko enintään 100 odottavaa luonnosta, vastaanotto 20/min, HTTP-runko enintään 3 MiB. Sovelluksen koko päiväkirja, avaimet ja hyväksynnät eivät kuulu tuloskuoreen. Virhe ei muuta päiväkirjaa.

## Paikallinen lähetys-CLI

Palvelimen `npm run setup` luo erillisen integraatioavaimen `.env`:iin. Tyhjä ILMARI_INTEGRATION_TOKEN poistaa tulosrajapinnan käytöstä. Palvelun käynnistys lukee arvon; avaimen vaihdon jälkeen käynnistä palvelin uudelleen.

Lähettävän prosessin ympäristössä tarvitaan:

```dotenv
RAVINTOPOLKU_URL=http://localhost:3001/
RAVINTOPOLKU_INTEGRATION_TOKEN=sama_rajattu_token_kuin_palvelimella
```

Etä-URL tarvitsee HTTPS:n; HTTP sallitaan vain loopbackiin. Perus-URL päättyy `/`:iin. Säilytä arvot esimerkiksi erillisessä 0600-tiedostossa **repon ulkopuolella**, jonka oikeutettu välitysprosessi lukee. Älä kopioi OpenAI-avainta ILMARIlle.

```bash
# Esimerkki prosessille, joka saa lukea tämän oman rajatun ympäristötiedoston:
node --env-file=/oma/yksityinen/ravintopolku-bridge.env --import tsx \
  integrations/ilmari/bridge.ts submit /oma/validoitu-tulos.json

# Pelkän AIDraft-skeeman vienti ilman verkkoa (ei korvaa tiedostoa):
npm run ilmari -- schema /tmp/ravintopolku-draft.schema.json
```

CLI validoi tiedoston ennen HTTP-kutsua, ei lue aiops-kantaa/avaimia eikä käynnistä kontteja. Se tulostaa vain vastaanoton tunnisteen ja tilan. Virheestä ei tulosteta syötettä tai tokenia. Tarkka tiedostopolkujen ja tuloslähteen valinta kuuluu myöhempään aiops-adapteriin.

## Tiedostopudotus palvelimelle (aiops ADR-0026)

Työasemalla (`https://tyoasema.taild1a5b7.ts.net:8443`) Node-palvelinta ei ole, joten yllä kuvattu HTTP-vastaanotto ei ole
käytössä. Sen sijaan Ilmari (aiops-gatewayn `aiops-gw`-käyttäjänä ajettava palvelu) **pudottaa tuloskuoren tiedostona**
hakemistoon, jonka Ravintopolun Python-palvelin (`palvelin/`) lukee ja tarjoilee sovelluksen ILMARIn luonnoslaatikkoon.
Tiedostopudotuksessa ei ole tokenia eikä verkkoa: oikeudet ovat hakemiston käyttöoikeuksia, ja laatikko näkyy vain
Tailscale-tunnistetulle käyttäjälle samasta alkuperästä. Ilmari ei edelleenkään kirjoita päiväkirjaan: luonnos päätyy
ateriaksi vasta käyttäjän tarkistuksen ja tallennuksen jälkeen.

**Hakemisto.** Konfiguraation `/etc/ravintopolku/palvelin.toml` valinnainen rivi `luonnokset = "/srv/aiops/ravintopolku/luonnokset"`
(malli: `config/palvelin.toml.esimerkki`). Ilman riviä palvelin ei lue tiedostoja ja laatikko on tyhjä. Hakemiston omistaa
`aiops-gw`, ryhmä on `ravintopolku` ja tila `2770` (setgid: palvelimen luomat alihakemistot ja tiedostot perivät ryhmän):

```bash
sudo install -d -o aiops-gw -g ravintopolku -m 2770 /srv/aiops/ravintopolku/luonnokset
```

Palvelun sandbox (`BindPaths=/srv/aiops/ravintopolku`) kattaa hakemiston jo; palvelutiedostoa ei tarvitse muuttaa. Ilmarin
kirjoittamien tiedostojen pitää olla ryhmän luettavissa (esimerkiksi 0640), jotta `ravintopolku`-käyttäjä voi lukea ne.

**Tiedosto.** Nimi `<YYYYMMDD-HHMMSS>-<externalId>.json`, esimerkiksi `20261028-120000-job-42-result-1.json`; `externalId`
on sama kuin kuoressa (1–128 merkkiä `[a-zA-Z0-9._:-]`). Sisältö on täsmälleen yllä kuvattu tuloskuori (`schemaVersion` 1,
`source`, `externalId`, `dataClass`, `draft` AIDraft-skeeman mukaisena) UTF-8-JSONina, enintään **64 KiB**. Kirjoita
atomisesti: ensin pisteellä alkavaan väliaikaisnimeen samassa hakemistossa (esim. `.20261028-120000-job-42-result-1.json.tmp`)
ja sitten `rename`. Palvelin käsittelee vain nimimallin mukaiset tiedostot; muut nimet se jättää koskematta.

**Käsittely.** Palvelin lukee hakemiston huoltosilmukassa (60 s välein) ja heti, kun sovellus hakee laatikon
(`GET /api/luonnokset`). Tiedosto avataan seuraamatta symbolisia linkkejä, ja vain tavallinen tiedosto kelpaa. Kuori
tarkistetaan samoin säännöin kuin HTTP-vastaanotossa; `restricted` hylätään aina. Kelvollinen luonnos tallentuu palvelimen
SQLite-kantaan odottavaksi (`luonnokset`-taulu) ja tiedosto poistetaan. **Kelvoton tiedosto siirretään alihakemistoon
`hylatyt/`** ja syy kirjoitetaan viereen tiedostoon `<nimi>.syy.txt`; mitään ei poisteta hiljaa. Sama `source + externalId`
otetaan vastaan vain kerran: toistotiedosto poistetaan ilman uutta luonnosta myös silloin, kun aiempi on jo käsitelty.
Korjattu tulos tarvitsee uuden `externalId`:n. Laatikossa on enintään 100 odottavaa luonnosta; ylimenevät tiedostot jäävät
odottamaan hakemistoon. Odottava luonnos vanhenee seitsemässä päivässä, jolloin se merkitään käsitellyksi ja sen sisältö
poistetaan kannasta; tunniste säilyy toistojen torjuntaan.

**Rajapinta sovellukselle** (sama Tailscale-tunnistus ja saman alkuperän säännöt kuin muilla `/api`-reiteillä):
`GET /api/luonnokset` → `{"luonnokset":[{"id","externalId","source","saapunut","draft"}]}` (vain odottavat, uusin ensin);
`DELETE /api/luonnokset/{id}` merkitsee luonnoksen käsitellyksi (404, jos sitä ei ole odottamassa). Sovellus avaa luonnoksen
Asetuksista aterialomakkeeseen, ja tallennuksen jälkeen se kuittaa luonnoksen; ateriaan jää oletusrivi `ILMARI-luonnos: <id>`.
Kuittaus on best effort: yhteysvirhe ei peru jo tallennettua ateriaa, ja luonnoksen voi merkitä käsitellyksi myöhemmin.

## Kuvasta ateria (aiops ADR-0027)

Ateria syntyy **pelkästä kuvasta** ilman pakollisia kenttiä: kotinäkymän **Kuvaa ateria** -painike avaa kameran (tai
kuvan valinnan), lähettää kuvan työaseman palvelimelle ja tallentaa palautetun luonnoksen heti valitun päivän ateriaksi.
Kuva voi olla ruoka-annos tai pakkauksen takaetiketti (ravintosisältö per 100 g ja pakkauksen paino). Ateriaan jää
alkuperä `Kuvasta (rooli X)` ja mallin oletukset, puuttuvat tiedot ja kysymykset; ilmoituksen **Avaa** avaa aterian
muokattavaksi. Pienennetty kuva tallentuu laitteelle kuten muissakin aterioissa (ei synkronoidu).

**Reitti.** Palvelin (`palvelin/`, ADR-0025) kutsuu aiops-välittäjää ("valittaja") Unix-soketissa, joka konfiguroidaan
riville `valittaja = "/run/aiops-valittaja/valittaja.sock"` (`/etc/ravintopolku/palvelin.toml`; malli
`config/palvelin.toml.esimerkki`). Ilman riviä reitti vastaa 404 ja sovellus kertoo, ettei toiminto ole käytössä.
Palvelimen sandboxissa on `PrivateNetwork=yes` ja vain `AF_UNIX`, joten palvelimella ei ole verkkoa, avaimia eikä
mallivalintaa: välittäjä hoitaa budjetin, politiikan ja mallin. Soketin pitää olla `ravintopolku`-käyttäjän
yhdistettävissä (välittäjän oma asennus, aiops-repon isäntämuutos).

**Välittäjäkutsu.** `POST /v1/chat/completions` OpenAI-muotoisena JSONina: `model` on **rooli**, ei malli –
`kuva_tulkki` (Hubin valinta: Hub päättää roolin takana olevan mallin), `kuva_tulkki_pilvi` (pakota pilvimalli) tai
`kuva_tulkki_paikallinen` (pakota paikallinen malli). Yksi `user`-viesti, jossa tekstiosa (suomenkielinen kehote) ja
kuvaosa `{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,…"}}`, sekä `response_format:
{"type":"json_object"}`. Aikaraja 120 s, enintään kaksi samanaikaista kutsua. Vastaus on chat-completions-JSON
(`choices[0].message.content`) tai virheolio `{"error":{"message","type"}}`: 402 viikkobudjetti ylittynyt, 404 roolille
ei mallia, 501/503 ei käytettävissä, 502 malli epäonnistui. Jokainen muu kuin 200 näytetään käyttäjälle
suomenkielisenä viestinä (välittäjän oma viesti lyhennettynä perässä), eikä mitään tallenneta.

**Mallin sopimus.** Malli palauttaa vain JSON-olion `{"name", "kind": "ateria"|"tuoteseloste", "lines": [{"name",
"mode": "per100"|"portion", "grams": luku|null, "values": {"energy","protein","carbs","fat","fiber"} luku|null}],
"assumptions": [..], "questions": [..]}`. Ruokakuvasta jokainen näkyvä ruoka on `portion`-rivi realistisella
suomalaisella annoskoolla; tuoteselosteesta palautetaan **yksi** `per100`-rivi, jonka `values` ovat per 100 g ja
`grams` pakkauksen paino tai ilmoitettu annos. Palvelin jäsentää tekstin puolustavasti (koodiaidat pois, ensimmäisestä
`{` viimeiseen `}`), muuntaa luvut (merkkijonot ja desimaalipilkku kelpaavat, muu on tuntematon), leikkaa arvot
välille 0–100 000, rajaa rivit 30:een, antaa massattomalle `per100`-riville 100 g oletuksella ja tarkistaa lopputuloksen
samoilla säännöillä kuin Ilmarin luonnokset (`luonnokset.tarkista_luonnos`). Tuntematon arvo on null, ei koskaan 0.
Rivi ilman yhtäkään arvoa hylätään; jos rivejä ei jää, vastaus on 422.

**Rajapinta sovellukselle.** `POST /api/kuva-ateria`, `multipart/form-data` (sama Tailscale-tunnistus ja
Origin-sääntö kuin muilla `/api`-reiteillä): kenttä `kuva` (JPEG/PNG/WebP taikatavuista tunnistettuna, enintään
8 MiB), valinnaiset `rooli` (oletus `kuva_tulkki`), `pvm` (VVVV-KK-PP, palautetaan sellaisenaan) ja `vihje` (enintään
300 merkkiä, liitetään kehotteeseen datana). Vastaus `{"draft": AIDraft (schemaVersion 1), "kind", "rooli", "pvm"}`;
`draft.provenance.provider` on `aiops-välittäjä / <rooli>` ja `model` välittäjän ilmoittama malli. Virheet: 400 kelvoton
kenttä tai kuva, 404 toiminto ei käytössä, 413 liian suuri, 415 väärä sisältötyyppi, 422 kuvasta ei saatu ateriaa,
402/502/503/504 välittäjästä. Lokiin kirjataan rooli, tila ja kesto – ei kuvaa eikä mallin tekstiä.

**Roolin valinta.** Asetukset → Kuvantulkinta: Hubin valinta, Pilvi tai Paikallinen. Valinta tallentuu päiväkirjan
`settings`-tauluun (`kuvantulkinta`, puuttuva = `kuva_tulkki`) ja synkronoituu laitteiden välillä; sama vaihto on
Ilmari Hubissa. Node-palvelimella (`server/`) reittiä ei ole.

## Live-aiopsiin kytkeminen: jäljellä oleva työ

1. Hanki aiopsin lähdekoodi luettavaksi ja lue sen AGENTS.md, ADR-0003/0007/0010, gatewayn reitit ja job/tulosskeemat. Varmista nykyinen asennettu versio; toimitettu tilannekuva ei korvaa tarkastusta.
2. Toteuta **erillinen rajattu tulosvälittäjä**, joka saa vain käyttäjän salliman työn rakenteisen tuloksen ja tämän vastaanotto-tokenin. Älä anna tokenia tai OpenAI-avainta verkkottomalle dispatcherille, gatewaylle tai `--network none` -laskentakontille. Valitse tuloksen lukureitti aiopsin oikean API-sopimuksen perusteella, älä suoraan SQLite-kannasta.
3. Säilytä aiopsin nykyinen politiikka ja allekirjoitettu hyväksyntä. Jos myöhemmin halutaan työn luonti Ravintopolusta, se tarvitsee erikseen todennetun gateway-sopimuksen ja AI-agenttipolitiikan; tätä toimintoa ei toimituksessa ole.
4. Päätä Ravintopolun **erillinen HTTPS-origin** ja sen yksityinen pääsy. Nykyinen gateway-root ja aiopsin vain tcp:443 -politiikka pidetään käytössä. Saman originin alihakemisto antaa Ravintopolun JS:lle aiops-reittien same-origin-oikeuden, vaikka SW olisi rajattu. Älä luo oletettuja `tailscale serve` -komentoja tai avaa reititintä tämän dokumentin perusteella.
5. Testaa oikea hyväksytty työ → validoitu tulos → vastaanotto → puhelimen muokattava luonnos → hyväksyntä. Testaa väärä token, restricted, tunnisteristiriita, gatewayn pääsynesto, hylätty työ ja verkkokatkos. Varmista, että mitään ei tallennu päiväkirjaan ilman käyttäjän toimintaa.

Alihakemistotuki (`APP_BASE_PATH` = käännöksen `VITE_APP_BASE`) mahdollistaa tulevan hallitun reitityksen mutta ei ratkaise originien välistä eristystä. Palvelin ei luota Tailscale-User-Login- tai X-Forwarded-Host-otsakkeisiin identiteettinä. Välitysprosessille annettu token on erillinen henkilökohtaisen Ravintopolku-palvelun oikeus, ei aiopsin hyväksyjän valta.
