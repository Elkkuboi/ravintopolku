"""Palvelimen vartija, rajapinta ja turvaotsakkeet (ADR-0016 kohta 2) sekä luonnoslaatikko (ADR-0026).
Otsaketaulukko käsin kirjoitettu."""

import json
import time
from types import MappingProxyType

import pytest
from starlette.testclient import TestClient

from ravintopolku_palvelin.app import CSP, luo
from ravintopolku_palvelin.config import Asetukset

from test_luonnokset import kuori

RP = "tyoasema.taild1a5b7.ts.net"
ALKUPERA = f"https://{RP}:8443"
OK = {"x-forwarded-host": f"{RP}:8443", "tailscale-user-login": "Elkkuboi@github"}
POST_OK = {**OK, "origin": ALKUPERA, "sec-fetch-site": "same-origin", "content-type": "application/json"}


@pytest.fixture
def polut(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Ravintopolku</title>")
    (dist / "sw.js").write_text("// sw")
    (dist / "manifest.webmanifest").write_text("{}")
    (dist / "assets" / "a.js").write_text("console.log(1)")
    for h in ("varmistus", "julkinen", "luonnokset"):
        (tmp_path / h).mkdir()
    return tmp_path


def asetukset(polut, **lisaa):
    return Asetukset(**{"rp_id": RP, "kayttajat": MappingProxyType({"Elkkuboi@github": "elias"}),
                        "tietokanta": polut / "p.sqlite", "varmistus": polut / "varmistus",
                        "julkinen": polut / "julkinen" / "paivakirja.json", "sovellus": polut / "dist", **lisaa})


@pytest.fixture
def client(polut):
    with TestClient(luo(asetukset(polut, luonnokset=polut / "luonnokset")), base_url="http://localhost", client=None) as c:
        yield c


def pudota(polut, nimi, sisalto):
    (polut / "luonnokset" / nimi).write_text(json.dumps(sisalto), encoding="utf-8")


def _ilman(*nimet):
    return {k: v for k, v in OK.items() if k not in nimet}


@pytest.mark.parametrize("kuvaus,otsakkeet,odotettu", [
    ("Serve portissa 8443", OK, 200),
    ("nimi ilman porttia", {**OK, "x-forwarded-host": RP}, 200),
    ("navigointi Hubista (same-site)", {**OK, "sec-fetch-site": "same-site"}, 200),
    ("ei tunnusta", _ilman("tailscale-user-login"), 403),
    ("tuntematon tunnus", {**OK, "tailscale-user-login": "muu@github"}, 403),
    ("väärä nimi", {**OK, "x-forwarded-host": "paha.example"}, 421),
    ("väärä portti", {**OK, "x-forwarded-host": f"{RP}:9443"}, 421),
    ("ei X-Forwarded-Hostia", _ilman("x-forwarded-host"), 421),
    ("Funnel", {**OK, "tailscale-funnel-request": "?1"}, 403),
])
def test_sivun_otsaketaulukko(client, kuvaus, otsakkeet, odotettu):
    assert client.get("/", headers=otsakkeet).status_code == odotettu


@pytest.mark.parametrize("kuvaus,otsakkeet,odotettu", [
    ("oma alkuperä", POST_OK, 200),
    ("ei Originia", {k: v for k, v in POST_OK.items() if k != "origin"}, 403),
    ("portti 443:n alkuperä", {**POST_OK, "origin": f"https://{RP}"}, 403),
    ("vieras alkuperä", {**POST_OK, "origin": "https://paha.example"}, 403),
    ("same-site", {**POST_OK, "sec-fetch-site": "same-site"}, 403),
    ("väärä sisältötyyppi", {**POST_OK, "content-type": "text/plain"}, 415),
])
def test_post_otsaketaulukko(client, kuvaus, otsakkeet, odotettu):
    assert client.post("/api/synk", headers=otsakkeet, content=json.dumps({"jalkeen": 0, "muutokset": []})).status_code == odotettu


def test_tcp_asiakas_ja_metodit(polut, client):
    assert client.put("/api/synk", headers=POST_OK).status_code == 405
    assert client.get("/api/synk", headers={**OK, "sec-fetch-site": "cross-site"}).status_code == 403
    a = asetukset(polut, tietokanta=polut / "q.sqlite", julkinen=polut / "julkinen" / "x.json")
    with TestClient(luo(a), base_url="http://localhost") as tcp:  # oletusasiakas on TCP-osoite
        assert tcp.get("/", headers=OK).status_code == 403


def test_kahden_laitteen_synkronointi_ja_julkinen_kopio(client, polut, monkeypatch):
    monkeypatch.setattr("ravintopolku_palvelin.app.VIENTI_VALI_S", 0.0)
    puhelin = {"jalkeen": 0, "muutokset": [{"taulu": "weights", "id": "a1", "data": {"id": "a1", "date": "2026-10-20", "kg": 80}}]}
    r1 = client.post("/api/synk", headers=POST_OK, content=json.dumps(puhelin)).json()
    assert r1["kuitatut"] == [{"taulu": "weights", "id": "a1", "seq": 1}] and r1["seq"] == 1
    kannettava = {"jalkeen": 0, "muutokset": [{"taulu": "weights", "id": "b1", "data": {"id": "b1", "date": "2026-10-20", "kg": 79}}]}
    r2 = client.post("/api/synk", headers=POST_OK, content=json.dumps(kannettava)).json()
    assert [(m["seq"], m["id"], m["poistettu"]) for m in r2["muutokset"]] == [(2, "a1", True), (3, "b1", False)]
    r3 = client.get("/api/synk?jalkeen=1", headers=OK).json()
    assert [m["seq"] for m in r3["muutokset"]] == [2, 3] and r3["lisaa"] is False
    tila = client.get("/api/tila", headers=OK).json()
    assert tila == {"seq": 3, "merkintoja": 1, "poistomerkintoja": 1, "kayttaja": "elias"}
    vienti = json.loads((polut / "julkinen" / "paivakirja.json").read_text())
    assert vienti["taulut"]["weights"] == [{"id": "b1", "date": "2026-10-20", "kg": 79}] and vienti["seq"] == 3


def test_kelvoton_pyynto_ei_tallenna(client):
    huono = {"jalkeen": 0, "muutokset": [{"taulu": "photos", "id": "p1", "data": {"id": "p1"}}]}
    assert client.post("/api/synk", headers=POST_OK, content=json.dumps(huono)).status_code == 400
    assert client.post("/api/synk", headers=POST_OK, content=b"{ei json").status_code == 400
    assert client.post("/api/synk", headers=POST_OK, content=json.dumps({"x": 1})).status_code == 400
    assert client.post("/api/synk", headers=POST_OK, content=b"[" + b"1," * 600000 + b"1]").status_code == 413
    assert client.get("/api/tila", headers=OK).json()["seq"] == 0


def test_turvaotsakkeet_ja_valimuisti(client):
    for polku in ("/", "/assets/a.js", "/api/tila", "/api/ei-ole"):
        r = client.get(polku, headers=OK)
        assert r.headers["content-security-policy"] == CSP and r.headers["x-content-type-options"] == "nosniff"
    assert "script-src 'self'" in CSP and "'unsafe" not in CSP
    assert client.get("/", headers=OK).headers["cache-control"] == "no-cache"
    assert client.get("/sw.js", headers=OK).headers["cache-control"] == "no-cache"
    assert client.get("/api/tila", headers=OK).headers["cache-control"] == "no-store"
    assert client.get("/api/ei-ole", headers=OK).status_code == 404
    assert client.get("/manifest.webmanifest", headers=OK).headers["content-type"].startswith("application/manifest+json")
    assert client.get("/", headers=_ilman("tailscale-user-login")).headers["content-security-policy"] == CSP


def test_vientirajoitus_viivastyttaa_mutta_ei_estä(client, polut):
    """Käynnistyksen vienti on juuri tehty, joten heti seuraava muutos odottaa huoltosilmukkaa."""
    muutos = {"jalkeen": 0, "muutokset": [{"taulu": "foods", "id": "f1", "data": {"id": "f1"}}]}
    assert client.post("/api/synk", headers=POST_OK, content=json.dumps(muutos)).status_code == 200
    assert json.loads((polut / "julkinen" / "paivakirja.json").read_text())["taulut"]["foods"] == []


def test_luonnoslaatikko_lukee_pudotuksen_ja_kuittaa(client, polut):
    assert client.get("/api/luonnokset", headers=OK).json() == {"luonnokset": []}
    pudota(polut, "20261028-120000-job-1.json", kuori("job-1"))
    pudota(polut, "20261028-120001-job-2.json", kuori("job-2", dataClass="restricted"))
    laatikko = client.get("/api/luonnokset", headers=OK).json()["luonnokset"]  # haku noutaa tiedostot heti
    assert [(l["id"], l["externalId"], l["source"]) for l in laatikko] == [(1, "job-1", "ilmari")]
    assert laatikko[0]["draft"]["name"] == "Kaurapuuro ja marjat" and set(laatikko[0]) == {
        "id", "externalId", "source", "saapunut", "draft"}
    assert sorted(p.name for p in (polut / "luonnokset").iterdir()) == ["hylatyt"]
    assert (polut / "luonnokset" / "hylatyt" / "20261028-120001-job-2.json.syy.txt").exists()
    assert client.delete("/api/luonnokset/1", headers=POST_OK).json() == {"ok": True}
    assert client.delete("/api/luonnokset/1", headers=POST_OK).status_code == 404
    assert client.delete("/api/luonnokset/7", headers=POST_OK).status_code == 404
    assert client.delete("/api/luonnokset/abc", headers=POST_OK).status_code == 404
    assert client.get("/api/luonnokset", headers=OK).json() == {"luonnokset": []}
    assert client.get("/api/luonnokset", headers=OK).headers["cache-control"] == "no-store"


@pytest.mark.parametrize("kuvaus,otsakkeet,odotettu", [
    ("oma alkuperä", POST_OK, 404),
    ("ei tunnusta", {k: v for k, v in POST_OK.items() if k != "tailscale-user-login"}, 403),
    ("ei Originia", {k: v for k, v in POST_OK.items() if k != "origin"}, 403),
    ("vieras alkuperä", {**POST_OK, "origin": "https://paha.example"}, 403),
    ("same-site", {**POST_OK, "sec-fetch-site": "same-site"}, 403),
    ("Funnel", {**POST_OK, "tailscale-funnel-request": "?1"}, 403),
])
def test_delete_otsaketaulukko(client, kuvaus, otsakkeet, odotettu):
    assert client.delete("/api/luonnokset/1", headers=otsakkeet).status_code == odotettu
    assert client.delete("/api/synk", headers=otsakkeet).status_code in (403, 404)  # ei DELETE-reittiä


def test_huoltosilmukka_noutaa_kaynnistyksessa(polut):
    pudota(polut, "20261028-120000-job-9.json", kuori("job-9"))
    with TestClient(luo(asetukset(polut, luonnokset=polut / "luonnokset")), base_url="http://localhost", client=None) as c:
        raja = time.monotonic() + 5
        while (polut / "luonnokset" / "20261028-120000-job-9.json").exists() and time.monotonic() < raja:
            time.sleep(0.05)  # huoltosilmukka ajaa taustalla heti käynnistyksessä
        assert not (polut / "luonnokset" / "20261028-120000-job-9.json").exists()
        assert [l["externalId"] for l in c.get("/api/luonnokset", headers=OK).json()["luonnokset"]] == ["job-9"]


def test_ilman_pudotushakemistoa_laatikko_on_tyhja(polut):
    pudota(polut, "20261028-120000-job-9.json", kuori("job-9"))
    with TestClient(luo(asetukset(polut)), base_url="http://localhost", client=None) as c:
        assert c.get("/api/luonnokset", headers=OK).json() == {"luonnokset": []}
        assert (polut / "luonnokset" / "20261028-120000-job-9.json").exists()
