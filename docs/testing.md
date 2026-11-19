# Testaus

## Komennot

```bash
npm ci --ignore-scripts
npm run typecheck              # tsc -b (src ja vite.config.ts)
npm run lint                   # oxlint
npm test                       # vitest, Node-ympäristö, IndexedDB fake-indexeddb:llä
npm run build                  # typecheck ja vite build: dist/index.html, manifest.webmanifest, sw.js
npm run test:e2e               # Playwright-savutesti
(cd palvelin && uv run --frozen pytest -q)
```

Asennus (`scripts/asenna-tyoasema.sh`) ajaa `npm test` ja `npm run build` kontissa ilman verkkoa, joten kumpikaan ei
saa tarvita verkkoa. Asennus ei aja Playwrightia eikä pytestiä: aja ne itse ennen yhdistämistä.

## Yksikkötestit (vitest)

- Ravintolaskenta: per 100 g ja annos, tuntematon arvo pysyy nullina, osittainen summa merkitään osittaiseksi.
- Päivät ja ajat Helsingin aikavyöhykkeessä, kesäaika, painon tulkinta vapaasta tekstistä.
- Tallennus, varmuuskopio ja palautus (atominen), CSV, synkronointi ja poistojen vahvistus.
- Kuori: yläpalkin sivut, alapalkin tallennusrivi, Hubin osoite ja värin luku (`/api/ulkoasu`, localStorage).
- Tänään: kaksi kuvakenttää (`capture="environment"` vain kamerassa, sama `accept`), kuvan pienennys 700 kt:n rajaan,
  kuva lähtee aina roolilla `kuva_tulkki` tallennetuista asetuksista riippumatta, virheteksti HTTP-tilasta ilman
  palvelimen tekstiä, luonnoksen muokkaus ja tallennus, aterian muokkaus säilyttää piilotetut kentät.
- Kehitys: asteikon laskenta, jakso, keskiarvo, tavoitepäivät, viikkopylväät ja sivun piirto.
- Asetukset: tavoitelomake, tavoite-ehdotuksen virheet, "Lähetä N poistoa" -nappi ja karsitut osat.
- Tyylikuri (`tests/tyyli.test.ts`): värit vain neljässä väriyhdistelmässä, ei pyöristyksiä, liukuvärejä eikä varjoja,
  ei inline-tyylejä, ei kuvakekirjastoa, kirjasimet omasta alkuperästä ja esikatselun CSP sama kuin palvelimella.

## Savutesti (Playwright)

`tests/e2e/savu.spec.ts` kääntää sovelluksen ja ajaa sen `vite preview` -palvelimella, joka antaa saman
CSP-otsakkeen kuin työaseman palvelin. `/api/*` mockataan testissä (`page.route`), joten testi ei tarvitse palvelinta,
verkkoa eikä aiopsia. Selain on järjestelmän Chrome (`channel: "chrome"`), puhelimen kokoinen ikkuna 390 × 844.

Testi tarkistaa:

- kolme sivua aukeavat neljällä värillä ilman CSP-rikkeitä ja konsolivirheitä, ja `theme-color` seuraa väriä
- käsin kirjaus näkyy päivän summassa ja ateria aukeaa muokattavaksi
- kamera ja galleria ovat erilliset kentät, `capture` on vain kamerassa ja kohdistuskehys näkyy vain näppäimistöllä
- kuvapolku: kuva, lisätieto, tulkinta, luonnos ja tallennus (pyyntö alle 700 kt, rooli `kuva_tulkki`)
- virhepolku: lyhyt suomenkielinen viesti ilman tarjoajan tekstiä ja "Kirjoita käsin"; "Yritä uudelleen" lähettää
  saman kuvan ja vie luonnokseen; Peru ei tallenna mitään eikä myöhästynyt vastaus avaa luonnosta
- luonnos säilyy, kun käydään toisella sivulla; yläpalkin Tänään kysyy ennen hylkäämistä
- Ilmarin luonnosten napeilla on luonnoksen nimi, ja varmuuskopion palautus vaatii sanan KORVAA
- 360 px:n leveydellä ei vaakavieritystä millään sivulla.

## Palvelin (pytest)

`palvelin/tests/`: tunnistus ja turvaotsakkeet, synkronointi, luonnoslaatikko, kuvan tulkinta (700 kt:n raja,
virheteksti ilman välittäjän tekstiä), tavoite-ehdotus, väri (`/api/ulkoasu`) ja woff2:n MIME-tyyppi.

## Puhelimella tarkistettavat

Testit eivät korvaa oikeaa puhelinta. Asennuksen ja "Päivitä"-napautuksen jälkeen tarkista Pixelillä:

1. "Ota kuva" avaa takakameran ja "Galleriasta" kuvavalitsimen.
2. Väri vaihtuu, kun sen vaihtaa Hubissa ja palaa sovellukseen.
3. Lentotilassa sovellus aukeaa ja kirjaus onnistuu; kirjaus synkronoituu, kun verkko palaa.
4. Numeronäppäimistö ja desimaalipilkku lomakkeissa.
