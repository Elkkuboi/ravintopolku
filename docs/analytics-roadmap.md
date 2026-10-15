# Analytiikan jatkopolku

V1 säilyttää raakakirjaukset ja laskee niistä vain perustilastot. Seuraavia analyysejä ei ole toteutettu.

1. Painotrendin regressio: päiväaika selittäjänä, riittävä havaintoikkuna, trendin yksikkö kg/viikko, herkkyys eri aikaväleille ja puuttuville päiville. Älä sekoita tavoitesuoraa havaintotrendiin.
2. Robusti tasoitus: vertaa paikallista regressiota ja robustia keskiarvoa nykyiseen kalenteripäiväkeskiarvoon. Näytä mittauspisteet aina; älä täytä aukkoja keksityillä havainnoilla.
3. Epävarmuuden visualisointi: mallipohjaiset välit ja niiden oletukset, havaintomäärä ja vaihtelu. Ei kalibroimattomia prosentteja. Tavoitesuora ei ole ennuste.
4. Energiamerkintöjen ja painonmuutoksen yhteys: aikaviiveet, nestevaihtelu, lyhyen ja pitkän aikavälin erottaminen ja kattavuuden herkkyysanalyysi. Saannin kirjausvirhe voi sekoittua kulutuksen arviointiin; älä päättele yksilön todellista energiankulutusta pelkistä kirjauksista.
5. Viikkorytmi: viikonpäiväjakaumat, vertailukelpoinen kattavuus ja päivän valmiuden vaikutus tuloksiin.
6. Kirjauksen kattavuus: erota puuttuva päivä, käyttäjän keskeneräinen päivä ja ravintoarvojen puuttuminen. Raportoi havaintojen määrä, aikaväli ja valinnan perusteet jokaiselle tilastolle.
7. Uni/nälkä/treeni: vapaaehtoisten havaintojen aikasarjat ja eksploratiivinen yhteistarkastelu. Valikoituneet kirjauspäivät, kausivaihtelu ja sekoittavat tekijät rajoittavat päätelmiä.

**Korrelaatio ei osoita syy-yhteyttä.** Käyttäjän päiväkirja ei ole satunnaistettu tutkimus. Kuvaile havaintoja ilman terveydellisiä johtopäätöksiä tai automaattista kalorivajeen säätöä. Ei liikuntakalorien automaattista lisäämistä tavoitteisiin.

Ennen laajennusta määritä täsmällinen estimaatti, käsittele puuttuvuus, säilytä raakadata, kirjoita tilastolliset testit tunnetuilla aineistoilla ja dokumentoi epävarmuus sekä soveltuvuuden rajat. CSV-vienti mahdollistaa ensin tutkimisen Pythonilla tai R:llä ilman tuotantosovelluksen muuttamista.
