# ILMARI ja aiops

Ravintopolku ottaa Ilmarilta vastaan tarkistettavia aterialuonnoksia ja käyttää aiops-välittäjää kahteen asiaan:
kuvasta ateria ja tavoite-ehdotus. Kaikki kulkee Louhin Python-palvelimen (`palvelin/`) kautta samasta alkuperästä
(`https://louhi.taild1a5b7.ts.net:8443`) Tailscale-tunnistuksella. Ilmari ei kirjoita päiväkirjaan: luonnos tai
ehdotus päätyy päiväkirjaan vasta käyttäjän tarkistuksen ja tallennuksen jälkeen.

## Tuloskuori

Skeemat: [tuloskuori](ilmari-tuloskuori.schema.json), [aterialuonnos](ai-draft.schema.json) (versio 1, `npm run
schema`) ja [testiesimerkki](ilmari-tuloskuori.esimerkki.json).

```json
{
  "schemaVersion": 1,
  "source": "ilmari",
  "externalId": "job-42-result-1",
  "dataClass": "private",
  "draft": { "...": "AIDraft-skeeman mukainen kokonainen objekti" }
}
```

`source` on 1–64 merkkiä (ASCII-kirjaimet/numerot ja `_-`); `externalId` 1–128 merkkiä (ASCII-kirjaimet/numerot ja
`._:-`). `dataClass`: public/private/restricted; **restricted hylätään aina**. Dataluokka pitää johtaa aiopsin
todennetusta työstä ja politiikasta, ei mallin tekstistä. Integraatio ei kuljeta kuvia.

## Tiedostopudotus palvelimelle (aiops ADR-0026)

Ilmari (aiops-gatewayn `aiops-gw`-käyttäjänä ajettava palvelu) **pudottaa tuloskuoren tiedostona** hakemistoon, jonka
Ravintopolun Python-palvelin (`palvelin/`) lukee ja tarjoilee sovellukselle.
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
tarkistetaan yllä kuvatuin säännöin; `restricted` hylätään aina. Kelvollinen luonnos tallentuu palvelimen
SQLite-kantaan odottavaksi (`luonnokset`-taulu) ja tiedosto poistetaan. **Kelvoton tiedosto siirretään alihakemistoon
`hylatyt/`** ja syy kirjoitetaan viereen tiedostoon `<nimi>.syy.txt`; mitään ei poisteta hiljaa. Sama `source + externalId`
otetaan vastaan vain kerran: toistotiedosto poistetaan ilman uutta luonnosta myös silloin, kun aiempi on jo käsitelty.
Korjattu tulos tarvitsee uuden `externalId`:n. Laatikossa on enintään 100 odottavaa luonnosta; ylimenevät tiedostot jäävät
odottamaan hakemistoon. Odottava luonnos vanhenee seitsemässä päivässä, jolloin se merkitään käsitellyksi ja sen sisältö
poistetaan kannasta; tunniste säilyy toistojen torjuntaan.

**Rajapinta sovellukselle** (sama Tailscale-tunnistus ja saman alkuperän säännöt kuin muilla `/api`-reiteillä):
`GET /api/luonnokset` → `{"luonnokset":[{"id","externalId","source","saapunut","draft"}]}` (vain odottavat, uusin ensin);
`DELETE /api/luonnokset/{id}` merkitsee luonnoksen käsitellyksi (404, jos sitä ei ole odottamassa). Odottavat luonnokset
näkyvät Tänään-sivulla (osio näkyy vain, kun luonnoksia on). Luonnos avautuu aterialomakkeeseen, ja tallennuksen
jälkeen sovellus kuittaa sen; ateriaan jää oletusrivi `ILMARI-luonnos: <id>`.
Kuittaus on best effort: yhteysvirhe ei peru jo tallennettua ateriaa, ja luonnoksen voi merkitä käsitellyksi myöhemmin.

## Kuvasta ateria (aiops ADR-0027)

Tänään-sivun **Ota kuva** avaa takakameran (`capture="environment"`) ja **Galleriasta** kuvavalitsimen. Kuva
pienennetään heti puhelimessa JPEGiksi (pidempi sivu 1600 px, laatu 0,8 → 0,7 → 0,6, tarvittaessa 1280 px) enintään
700 000 tavuun; raakaa tiedostoa ei lähetetä koskaan, ja pienennyksen virhe näytetään. Kuvan mukana saa kirjoittaa
valinnaisen lisätiedon (`vihje`, enintään 300 merkkiä), joka menee tulkitsijalle datana ja jää ateriaan näkyviin.
**Tulkitse kuva** lähettää kuvan; odotuksen voi perua. Tulos on **tallentamaton luonnos** (nimi, kello, rivit ruoka /
g / kcal, yhteensä), jonka käyttäjä tallentaa tai hylkää. Mitään ei tallenneta ennen Tallenna-napautusta. Ateriaan jää
alkuperä `Kuvasta (malli): ruoka-annos` tai `…: tuoteseloste`, ja mallin oletukset ja kysymykset ovat taitteessa.
Pienennetty kuva tallentuu laitteelle kuten muissakin aterioissa (ei synkronoidu).

Virheessä käyttäjä näkee yhden lyhyen suomenkielisen rivin, joka valitaan HTTP-tilan mukaan
(`src/ai/kuva-ateria.ts`, `kuvaVirhe`): palvelimen tai välittäjän tekstiä ei näytetä. Tekninen syy kirjataan
palvelimen lokiin. **Yritä uudelleen** lähettää saman kuvan (uusi kutsu), **Kirjoita käsin** avaa käsin kirjauksen
kuva liitettynä.

**Reitti.** Palvelin (`palvelin/`, ADR-0025) kutsuu aiops-välittäjää ("valittaja") Unix-soketissa, joka konfiguroidaan
riville `valittaja = "/run/aiops-valittaja/valittaja.sock"` (`/etc/ravintopolku/palvelin.toml`; malli
`config/palvelin.toml.esimerkki`). Ilman riviä reitti vastaa 404 ja sovellus kertoo, ettei toiminto ole käytössä.
Palvelimen sandboxissa on `PrivateNetwork=yes` ja vain `AF_UNIX`, joten palvelimella ei ole verkkoa, avaimia eikä
mallivalintaa: välittäjä hoitaa budjetin, politiikan ja mallin. Soketin pitää olla `ravintopolku`-käyttäjän
yhdistettävissä (välittäjän oma asennus, aiops-repon isäntämuutos).

**Välittäjäkutsu.** `POST /v1/chat/completions` OpenAI-muotoisena JSONina: `model` on **rooli**, ei malli –
sovellus lähettää aina `kuva_tulkki` (Hub päättää roolin takana olevan mallin); palvelin hyväksyy myös
`kuva_tulkki_pilvi` ja `kuva_tulkki_paikallinen`. Yksi `user`-viesti, jossa tekstiosa (suomenkielinen kehote) ja
kuvaosa `{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,…"}}`, sekä `response_format:
{"type":"json_object"}`. Aikaraja 120 s, enintään kaksi samanaikaista kutsua. Vastaus on chat-completions-JSON
(`choices[0].message.content`) tai virheolio `{"error":{"message","type"}}`: 402 viikkobudjetti ylittynyt, 404 roolille
ei mallia, 501/503 ei käytettävissä, 502 malli epäonnistui. Välittäjän oma teksti kirjataan palvelimen lokiin
(warning), eikä mitään tallenneta.

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
700 000 tavua, sama raja kuin sovelluksessa), valinnaiset `rooli` (oletus `kuva_tulkki`), `pvm` (VVVV-KK-PP, palautetaan sellaisenaan) ja `vihje` (enintään
300 merkkiä, liitetään kehotteeseen datana; kehote käskee mallia ottamaan sen huomioon nimissä, grammoina ja arvioissa).
Vastaus `{"draft": AIDraft (schemaVersion 1), "kind", "rooli", "pvm"}`;
`draft.provenance.provider` on `aiops-välittäjä / <rooli>` ja `model` välittäjän ilmoittama malli. Virheet: 400 kelvoton
kenttä tai kuva, 404 toiminto ei käytössä, 413 liian suuri, 415 väärä sisältötyyppi, 422 kuvasta ei saatu ateriaa,
402/502/503/504 välittäjästä. Lokiin kirjataan rooli, tila ja kesto – ei kuvaa eikä mallin tekstiä.

Asetusten vanhat kentät `kuvantunnistus` ja `kuvantulkinta` säilyvät datassa ja skeemassa, mutta sovellus ei lue niitä.

## Tavoitteet luonnollisesta kielestä

Asetukset → Tavoitteet → taite **Ehdota tavoitteet omin sanoin**: vapaa tekstikenttä (esim. "painon lievä pudotus" tai
"rasvan muuttaminen lihakseksi") ja **Ehdota**. Sovellus lähettää tekstin sekä
lyhyen kuvan nykytilanteesta (ikä, pituus, uusin paino, treenit, nykyinen energiatavoite) Louhin palvelimelle, joka
kutsuu aiops-välittäjää samalla tavalla kuin kuvasta ateria. Ilmari ehdottaa päivän energia- ja makrotavoitteet sekä
lyhyen perustelun, ja ehdotus näkyy **tarkistettavana**: luvut voi muokata, ja vasta **Ota käyttöön** kirjoittaa tavoitteen. Hylättyä tai epäonnistunutta ehdotusta ei tallenneta, eikä olemassa olevaa tavoitetta muuteta.

**Rajapinta sovellukselle.** `POST /api/tavoitteet` (`palvelin/`, `tavoitteet.py`) JSON-rungolla `{"teksti": enintään
500 merkkiä, "rooli"?: rooli, "profiili"?: enintään 300 merkkiä}`; sama Tailscale-tunnistus, Origin-sääntö ja 1 MiB:n
runkoraja kuin muilla `/api`-reiteillä. Vastaus `{"ehdotus": {"energy","protein","carbs","fat"} luku|null,
"perustelu": enintään 400 merkkiä, "oletukset": [enintään 10 × 300 merkkiä], "rooli", "malli"}`. Ilman
`valittaja`-sokettia reitti vastaa 404 ja sovellus kertoo, ettei toiminto ole käytössä.

**Välittäjäkutsu.** `POST /v1/chat/completions` OpenAI-muotoisena JSONina: `model` on **rooli**, ei malli. Sovelluksen
roolinimet `tavoite_ehdottaja`, `tavoite_ehdottaja_pilvi` ja `tavoite_ehdottaja_paikallinen` muunnetaan palvelimessa
välittäjän rooleiksi `kuva_tulkki`, `kuva_tulkki_pilvi` ja `kuva_tulkki_paikallinen` (`tavoitteet.VALITTAJAN_ROOLI`):
välittäjässä ei ole omaa roolia tavoite-ehdotukselle, joten se käyttää samaa mallia kuin kuvan tulkinta. Yksi `user`-viesti (suomenkielinen kehote, jossa tavoite ja nykytilanne **datana, ei järjestelmäohjeina**),
`response_format: {"type":"json_object"}`, aikaraja 120 s ja sama enintään kahden samanaikaisen kutsun lukko kuin
kuvassa. Sovellus lähettää aina roolin `tavoite_ehdottaja`. Käyttäjä näkee lyhyen suomenkielisen viestin tilan mukaan
(esim. välittäjän 404 → 503 "Ilmari Hubissa ei ole mallia tavoite-ehdotukselle"), ja tekninen syy kirjataan lokiin
(`tavoitteet: virhe N: …`) — ei tavoitetta eikä lukuja.

**Numerot tarkistetaan koodissa** (palvelin `tavoitteet.py` ja selain `src/ai/tavoitteet.ts`, samat rajat): energia
800–6 000 kcal, proteiini 30–250 g, hiilihydraatit 20–700 g ja rasva 20–200 g. Äärirajan alapuolelle jäävä arvo
jätetään tyhjäksi ja ylikäynyt leikataan; syy kerrotaan ehdotuksen oletuksissa. Energian puuttuessa se lasketaan
makroista (4 + 4 + 9 kcal/g), ja jos makrot poikkeavat energiatavoitteesta yli 10 %, näytetään varoitus. Jos yksikään
neljästä luvusta ei kelpaa, vastaus on 422. Tuntematon arvo on null, ei 0.

**Hyväksyminen.** Hyväksytyt luvut tallentuvat tavoitteeksi, jonka `effectiveDate` on tämä päivä: saman päivän
tavoite korvataan ja aiempi jää historiaksi. Kuitu sekä painotavoite ja -päivämäärä peritään voimassa olevalta
tavoitteelta, joten Goal-skeemaa ei muuteta; rooli, malli ja perustelu näkyvät vain tarkistusnäkymässä.

**Testit.** `palvelin/tests/test_tavoitteet.py` (reitti, roolit, numeroiden rajat, virheet ja lokitus väärennetyllä
välittäjällä Unix-soketissa) ja `tests/tavoitteet.test.ts` (pyyntö, palvelinvirheiden näyttäminen, rajatarkistus ja
hyväksytyn ehdotuksen tallentuminen Dexielle).
