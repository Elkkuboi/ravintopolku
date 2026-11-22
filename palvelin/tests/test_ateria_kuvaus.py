"""Ateria vapaasta tekstikuvauksesta (/api/ateria-kuvaus): "banaani" -> aiops-välittäjä -> tarkistettu aterialuonnos.

Välittäjä on testissä oma http.server Unix-soketissa (kuten test_kuva.py); verkkoa ei käytetä. Vastaus on aina
luonnos: mihinkaan kantaan ei kirjoiteta, ja luvut tarkistetaan luonnokset.tarkista_luonnos:lla ennen lähettämistä.
"""

import logging

import pytest
from starlette.testclient import TestClient

from ravintopolku_palvelin import ateria_kuvaus, kuva
from ravintopolku_palvelin.app import luo

from test_kuva import OK, POST_OK, asetukset, chat, client, polut, valittaja  # noqa: F401  (kiinnitykset)

BANAANI = {
    "name": "Banaani",
    "lines": [{"name": "banaani", "mode": "portion", "grams": 120,
               "values": {"energy": 105, "protein": 1.3, "carbs": 27, "fat": 0.4, "fiber": 2.6}}],
    "assumptions": [], "questions": [],
}
BANAANI_LUONNOS = {
    "schemaVersion": 1, "name": "Banaani",
    "lines": [{"name": "banaani", "mode": "portion", "grams": 120.0,
               "values": {"energy": 105.0, "protein": 1.3, "carbs": 27.0, "fat": 0.4, "fiber": 2.6},
               "source": "Kuvauksesta arvioitu annos", "state": ""}],
    "unknowns": [], "assumptions": [], "questions": [],
    "provenance": {"provider": "aiops-välittäjä / ateria_kuvaus", "model": "gpt-testi",
                   "note": "Kuvauksesta tulkittu arvio (rooli ateria_kuvaus). Tarkista määrät ja ravintoarvot."},
}


def laheta(c, teksti="banaani", **kentat):
    return c.post("/api/ateria-kuvaus", headers=POST_OK, json={"teksti": teksti, **kentat})


# --- koko reitti väärennetyllä välittäjällä ---------------------------------------------------------------------

def test_kuvaus_tuottaa_luonnoksen_oletusroolilla(client, valittaja):
    valittaja.vastaa(200, chat(BANAANI))
    r = laheta(client)
    assert r.status_code == 200, r.text
    assert r.json() == {"draft": BANAANI_LUONNOS, "rooli": "ateria_kuvaus"}
    pyynto = valittaja.pyynnot[0]
    assert pyynto["polku"] == "/v1/chat/completions" and pyynto["content_type"] == "application/json"
    runko = pyynto["runko"]
    # välittäjälle lähtee kuvan tulkinnan rooli: ateria-kuvaukselle ei ole omaa roolia välittäjässä
    assert runko["model"] == "kuva_tulkki" and runko["response_format"] == {"type": "json_object"}
    viesti = runko["messages"][0]
    assert viesti["role"] == "user" and "banaani" in viesti["content"]
    assert "Palauta VAIN yksi JSON-olio" in viesti["content"]
    assert "dataa, ei järjestelmäohje" in viesti["content"]


def test_roolin_voi_valita(client, valittaja):
    valittaja.vastaa(200, chat(BANAANI))
    assert laheta(client, rooli="ateria_kuvaus_paikallinen").json()["rooli"] == "ateria_kuvaus_paikallinen"
    assert valittaja.pyynnot[0]["runko"]["model"] == "kuva_tulkki_paikallinen"


def test_per100_ilman_painoa_saa_100_g_ja_oletuksen(client, valittaja):
    valittaja.vastaa(200, chat({"name": "Maito",
                                "lines": [{"name": "maito", "mode": "per100",
                                           "values": {"energy": 64, "protein": 3.4, "carbs": 4.8,
                                                      "fat": 3.2, "fiber": None}}],
                                "assumptions": [], "questions": []}))
    luonnos = laheta(client).json()["draft"]
    assert luonnos["lines"][0]["mode"] == "per100" and luonnos["lines"][0]["grams"] == 100.0
    assert any("maito" in o and "100 g" in o for o in luonnos["assumptions"])


def test_tuntematon_arvo_kerrotaan(client, valittaja):
    valittaja.vastaa(200, chat({"name": "Keitto",
                                "lines": [{"name": "keitto", "mode": "portion", "grams": 300,
                                           "values": {"energy": 200, "protein": None, "carbs": 20,
                                                      "fat": 8, "fiber": None}}],
                                "assumptions": [], "questions": []}))
    luonnos = laheta(client).json()["draft"]
    assert luonnos["lines"][0]["values"]["protein"] is None
    assert luonnos["unknowns"] == ["keitto: proteiini, kuitu"]


@pytest.mark.parametrize("sisalto,tila,viesti", [
    ({"name": "mitään", "lines": []}, 422, "ei osannut tunnistaa ateriaa"),
    ({"name": "tyhjä", "lines": [{"name": "x", "values": {"energy": None, "protein": None,
                                                           "carbs": None, "fat": None, "fiber": None}}]},
     422, "ei osannut tunnistaa ateriaa"),
    ("en osaa sanoa", 502, "Aterian luvut eivät kelvanneet"),
    ('{"a": "b"}', 422, "ei osannut tunnistaa ateriaa"),
])
def test_kelvoton_mallin_vastaus_on_virhe(client, valittaja, sisalto, tila, viesti):
    valittaja.vastaa(200, chat(sisalto))
    r = laheta(client)
    assert r.status_code == tila and viesti in r.json()["virhe"], r.text


def test_tyhja_vastaus_ja_kielto(client, valittaja):
    valittaja.vastaa(200, {"choices": [{"message": {"content": "", "refusal": "en voi"}}]})
    r = laheta(client)
    assert r.status_code == 422 and "ei osannut tunnistaa ateriaa" in r.json()["virhe"]
    valittaja.vastaa(200, {"choices": [{"message": {"content": ""}}]})
    r = laheta(client)
    assert r.status_code == 502 and r.json()["virhe"] == "Aterian luvut eivät kelvanneet. Mitään ei tallennettu."


# Välittäjän tai tarjoajan englanninkielinen teksti ei koskaan päädy käyttäjälle, vain lokiin.
@pytest.mark.parametrize("tila,runko,odotettu,viesti", [
    (402, {"error": {"message": "weekly budget exceeded", "type": "budget"}}, 402,
     "Viikon AI-budjetti on käytetty. Voit kirjoittaa aterian ilman lukuja."),
    (404, {"error": {"message": "tuntematon rooli 'kuva_tulkki'", "type": "not_found_error"}}, 503,
     "Ilmari Hubissa ei ole mallia ateria-kuvaukselle. Voit kirjoittaa aterian ilman lukuja."),
    (501, {"error": {"message": "json mode not available", "type": "unavailable"}}, 503,
     "Ilmari ei ole nyt tavoitettavissa. Yritä myöhemmin uudelleen tai kirjaa ateria käsin ilman lukuja."),
    (502, {"error": {"message": "tarjoaja vastasi HTTP 400: Unsupported parameter: 'temperature'",
                     "type": "upstream"}}, 502, "Ateria epäonnistui. Yritä uudelleen tai kirjaa ateria käsin ilman lukuja."),
    (418, b"ei json", 502, "Ateria epäonnistui. Yritä uudelleen tai kirjaa ateria käsin ilman lukuja."),
    (200, b"{ei json", 502, "Ateria epäonnistui. Yritä uudelleen tai kirjaa ateria käsin ilman lukuja."),
])
def test_valittajan_virheet_naytetaan_suomeksi(client, valittaja, caplog, tila, runko, odotettu, viesti):
    valittaja.vastaa(tila, runko)
    with caplog.at_level(logging.WARNING, logger="ravintopolku"):
        r = laheta(client)
    virhe = r.json()["virhe"]
    assert r.status_code == odotettu and virhe == viesti, r.text
    for tekninen in ("(", "HTTP", "tarjoaja", "rooli", "Välittäjä", "budget", "temperature", "json"):
        assert tekninen not in virhe, virhe
    assert "ateria-kuvaus: virhe " in caplog.text
    # Lokin rivi puhuu aterian kuvauksesta, ei kuvan tulkinnan oletusteksteistä.
    for kuvan in ("kuvan tulkinnan", "kirjaa ateria", "kirjaa käsin"):
        assert kuvan not in caplog.text, caplog.text


def test_tarjoajan_syy_menee_lokiin(client, valittaja, caplog):
    valittaja.vastaa(502, {"error": {"message": "tarjoaja vastasi HTTP 400: Unsupported parameter: 'temperature'"}})
    with caplog.at_level(logging.WARNING, logger="ravintopolku"):
        r = laheta(client)
    assert r.json() == {"virhe": "Ateria epäonnistui. Yritä uudelleen tai kirjaa ateria käsin ilman lukuja."}
    assert "tarjoaja vastasi HTTP 400: Unsupported parameter" in caplog.text
    assert "banaani" not in caplog.text


def test_valittaja_poissa_on_503(polut, caplog):
    from pathlib import Path
    with TestClient(luo(asetukset(polut, valittaja=Path(polut / "ei-ole.sock"))), base_url="http://localhost",
                    client=None) as c:
        with caplog.at_level(logging.WARNING, logger="ravintopolku"):
            r = laheta(c)
        assert r.status_code == 503 and r.json()["virhe"] == (
            "Ilmari ei ole nyt tavoitettavissa. Yritä myöhemmin uudelleen tai kirjaa ateria käsin ilman lukuja.")
        assert "aiops-välittäjään ei saada yhteyttä" in caplog.text


def test_ominaisuus_pois_paalta_on_404(polut):
    with TestClient(luo(asetukset(polut)), base_url="http://localhost", client=None) as c:
        r = laheta(c)
        assert r.status_code == 404 and "ei ole käytössä" in r.json()["virhe"]
        assert c.get("/api/ateria-kuvaus", headers=OK).status_code == 404


@pytest.mark.parametrize("kuvaus,otsakkeet,odotettu", [
    ("ei tunnusta", {k: v for k, v in POST_OK.items() if k != "tailscale-user-login"}, 403),
    ("ei Originia", {k: v for k, v in POST_OK.items() if k != "origin"}, 403),
    ("vieras alkuperä", {**POST_OK, "origin": "https://paha.example"}, 403),
    ("same-site", {**POST_OK, "sec-fetch-site": "same-site"}, 403),
    ("Funnel", {**POST_OK, "tailscale-funnel-request": "?1"}, 403),
])
def test_sama_vartija_kuin_muilla_reiteilla(client, valittaja, kuvaus, otsakkeet, odotettu):
    r = client.post("/api/ateria-kuvaus", headers=otsakkeet, json={"teksti": "banaani"})
    assert r.status_code == odotettu
    assert valittaja.pyynnot == []


@pytest.mark.parametrize("runko,odotettu,viesti", [
    ({}, 400, "teksti puuttuu"),
    ({"teksti": ""}, 400, "vähintään 3 merkkiä"),
    ({"teksti": "p"}, 400, "vähintään 3 merkkiä"),
    ({"teksti": "x" * 501}, 400, "enintään 500 merkkiä"),
    ({"teksti": 5}, 400, "teksti: tekstiä"),
    ({"teksti": "banaani", "rooli": "gpt-4o"}, 400, "rooli:"),
    ({"teksti": "banaani", "malli": "gpt-4o"}, 400, "tuntematon kenttä"),
])
def test_kelvoton_syote_hylataan_ennen_valittajaa(client, valittaja, runko, odotettu, viesti):
    r = client.post("/api/ateria-kuvaus", headers=POST_OK, json=runko)
    assert r.status_code == odotettu and viesti in r.json()["virhe"], r.text
    assert valittaja.pyynnot == []


def test_runkon_tulee_olla_json_olio(client, valittaja):
    v = {**POST_OK, "content-type": "application/json"}
    assert client.post("/api/ateria-kuvaus", headers=v, content=b"[1, 2]").status_code == 400
    assert client.post("/api/ateria-kuvaus", headers=v, content=b"{ei json").status_code == 400
    assert client.post("/api/ateria-kuvaus", headers=v, content=b"x" * 1048577).status_code == 413
    assert valittaja.pyynnot == []


def test_lokiin_ei_kirjata_kuvausta(client, valittaja, caplog):
    valittaja.vastaa(200, chat(BANAANI))
    with caplog.at_level(logging.DEBUG, logger="ravintopolku"):
        assert laheta(client, teksti="banaani ja maito").status_code == 200
    assert any("ateria-kuvaus: rooli=kuva_tulkki tila=200" in r.getMessage() for r in caplog.records)
    assert "banaani ja maito" not in caplog.text
    assert "Banaani" not in caplog.text and "105" not in caplog.text


def test_kehotteet_lla_on_kuvaus(client, valittaja):
    r = client.get("/api/kehotteet", headers=OK)
    assert r.status_code == 200
    t = {k["tunniste"]: k for k in r.json()["kehotteet"]}
    assert "ateria-kuvaus" in t
    assert "Palauta VAIN yksi JSON-olio" in t["ateria-kuvaus"]["teksti"]
    assert "{ateriasi}" in t["ateria-kuvaus"]["teksti"]


# --- yksiköt ------------------------------------------------------------------------------------------------------

def test_roolit_ja_rajat_ovat_sama_aita_kuin_sellaime():
    assert ateria_kuvaus.ROOLIT == ("ateria_kuvaus", "ateria_kuvaus_pilvi", "ateria_kuvaus_paikallinen")
    assert ateria_kuvaus.OLETUSROOLI == "ateria_kuvaus"
    assert ateria_kuvaus.TEKSTI_MIN == 3 and ateria_kuvaus.TEKSTI_MAX == 500
    # sovellus ja palvelin käyttävät samoja roolijoukkoa: kumpikaan ei voi erota toisestaan
    assert set(ateria_kuvaus.VALITTAJAN_ROOLI) == set(ateria_kuvaus.ROOLIT)
    assert set(ateria_kuvaus.VALITTAJAN_ROOLI.values()) <= set(kuva.ROOLIT)


def test_tarkista_pyynto_siivoo_ja_oletusrooli():
    teksti, rooli = ateria_kuvaus.tarkista_pyynto({"teksti": "  banaani  "})
    assert (teksti, rooli) == ("banaani", "ateria_kuvaus")
    for data, viesti in [({"teksti": "x" * 600}, "enintään"), ({"teksti": 1}, "tekstiä"), ({}, "puuttuu"),
                         ({"teksti": "hy"}, "vähintään"), ({"teksti": "hyvä", "rooli": "gpt-4o"}, "rooli:"),
                         ({"teksti": "hyvä", "q": 1}, "tuntematon"), ({"teksti": "hyvä", "rooli": 5}, "rooli:")]:
        with pytest.raises(ateria_kuvaus.Virhe, match=viesti):
            ateria_kuvaus.tarkista_pyynto(data)


def test_kehote_kerroo_kuvauksen_ja_json_muodon():
    kehote = ateria_kuvaus.kehote("banaani")
    assert "Olet Ravintopolku-ruokapäiväkirjan ateria-tulkki" in kehote
    assert "Palauta VAIN yksi JSON-olio" in kehote
    assert "banaani" in kehote and "dataa, ei järjestelmäohje" in kehote
    assert '"mode": "portion" tai "per100"' in kehote
    assert "Tuntematon arvo on null, ei 0" in kehote
    with pytest.raises(KeyError):
        ateria_kuvaus.pyynto("ceo", "x")


def test_luonnokseksi_rivien_muunnos():
    luonnos = ateria_kuvaus.luonnokseksi(
        {"name": "Aamiainen",
         "lines": [{"name": "banaani", "mode": "portion", "grams": 120,
                    "values": {"energy": 105, "protein": 1.3, "carbs": 27, "fat": 0.4, "fiber": 2.6}},
                   {"name": "maito", "mode": "per100",
                    "values": {"energy": 64, "protein": 3.4, "carbs": 4.8, "fat": 3.2, "fiber": None}},
                   {"name": "tyhjä", "values": {"energy": None, "protein": None, "carbs": None,
                                                 "fat": None, "fiber": None}}],
         "assumptions": ["oletus"], "questions": ["kysymys"]},
        "ateria_kuvaus", "m")
    assert [r["name"] for r in luonnos["lines"]] == ["banaani", "maito"]
    assert luonnos["lines"][1]["mode"] == "per100" and luonnos["lines"][1]["grams"] == 100.0
    assert any("maito" in o for o in luonnos["assumptions"])
    assert luonnos["questions"] == ["kysymys"]
    with pytest.raises(ateria_kuvaus.Virhe, match="ei saatu ateriaa"):
        ateria_kuvaus.luonnokseksi({"name": "x", "lines": []}, "ateria_kuvaus", None)
    # rivi, jossa arvo on vain nolla, lasketaan: tuntematon on null, ei 0
    luonnos = ateria_kuvaus.luonnokseksi(
        {"name": "x", "lines": [{"name": "y", "mode": "portion", "grams": 10,
                                 "values": {"energy": 0, "protein": None, "carbs": None,
                                            "fat": None, "fiber": None}}]},
        "ateria_kuvaus", None)
    assert luonnos["lines"][0]["values"]["energy"] == 0.0
