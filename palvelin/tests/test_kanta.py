"""Synkronoinnin säännöt (ADR-0016 kohta 1), varmistus (kohta 3) ja vienti (kohta 4).

Riippumaton totuus: järjestysnumerot ja päivämäärät on laskettu käsin alla.
"""

from datetime import date
import json
import os
import sqlite3
import stat

import pytest

from ravintopolku_palvelin import kanta


@pytest.fixture
def y(tmp_path):
    yhteys = kanta.avaa(tmp_path / "p.sqlite")
    yield yhteys
    yhteys.close()


def paino(tunniste, paiva, kg):
    return {"taulu": "weights", "id": tunniste, "data": {"id": tunniste, "date": paiva, "kg": kg}}


def test_jarjestysnumero_kasvaa_ja_viimeisin_saapunut_voittaa(y):
    k1 = kanta.sovella(y, [{"taulu": "foods", "id": "f1", "data": {"id": "f1", "name": "puuro"}}], "puhelin")
    k2 = kanta.sovella(y, [{"taulu": "foods", "id": "f1", "data": {"id": "f1", "name": "kaurapuuro"}}], "kannettava")
    assert [k["seq"] for k in k1 + k2] == [1, 2]
    muutokset, lisaa = kanta.hae(y, 0)
    assert lisaa is False and [(m["seq"], m["data"]["name"]) for m in muutokset] == [(2, "kaurapuuro")]


def test_poisto_sailyy_ja_jaetaan(y):
    kanta.sovella(y, [{"taulu": "foods", "id": "f1", "data": {"id": "f1", "name": "puuro"}}], "puhelin")
    kanta.sovella(y, [{"taulu": "foods", "id": "f1", "data": None, "poistettu": True}], "kannettava")
    muutokset, _ = kanta.hae(y, 1)
    assert muutokset == [{"seq": 2, "taulu": "foods", "id": "f1", "data": None, "poistettu": True}]
    assert kanta.tilasto(y) == {"seq": 2, "merkintoja": 0, "poistomerkintoja": 1}


def test_saman_paivan_paino_kahdelta_laitteelta(y):
    kanta.sovella(y, [paino("a1", "2026-10-20", 80.0)], "puhelin")          # seq 1
    kuitatut = kanta.sovella(y, [paino("b1", "2026-10-20", 79.5)], "kannettava")  # a1 poistetaan seq 2, b1 seq 3
    assert kuitatut == [{"taulu": "weights", "id": "b1", "seq": 3}]
    muutokset, _ = kanta.hae(y, 1)
    assert [(m["seq"], m["id"], m["poistettu"]) for m in muutokset] == [(2, "a1", True), (3, "b1", False)]


def test_saman_tunnisteen_paivitys_ei_poista_itseaan(y):
    kanta.sovella(y, [paino("a1", "2026-10-20", 80.0)], "puhelin")
    kanta.sovella(y, [paino("a1", "2026-10-20", 79.0)], "puhelin")
    muutokset, _ = kanta.hae(y, 0)
    assert [(m["id"], m["poistettu"], m["data"]["kg"]) for m in muutokset] == [("a1", False, 79.0)]


def test_eri_paivat_eivat_tormaa(y):
    kanta.sovella(y, [paino("a1", "2026-10-20", 80.0), paino("b1", "2026-10-21", 79.5)], "puhelin")
    assert kanta.tilasto(y)["merkintoja"] == 2


def test_kaikki_tai_ei_mitaan(y):
    with pytest.raises(kanta.Hylatty):
        kanta.sovella(y, [paino("a1", "2026-10-20", 80.0), {"taulu": "photos", "id": "p1", "data": {"id": "p1"}}], "x")
    assert kanta.tilasto(y)["seq"] == 0


@pytest.mark.parametrize("muutos,viesti", [
    ({"taulu": "photos", "id": "p1", "data": {"id": "p1"}}, "tuntematon taulu"),
    ({"taulu": "aiops", "id": "x", "data": {"id": "x"}}, "tuntematon taulu"),
    ({"taulu": "foods", "id": "a" * 101, "data": {"id": "a" * 101}}, "1–100"),
    ({"taulu": "foods", "id": "", "data": {"id": ""}}, "1–100"),
    ({"taulu": "foods", "id": "f1", "data": {"id": "f2"}}, "sama kuin muutoksen"),
    ({"taulu": "foods", "id": "f1", "data": ["lista"]}, "sama kuin muutoksen"),
    ({"taulu": "foods", "id": "f1", "data": {"id": "f1"}, "poistettu": "kyllä"}, "totuusarvo"),
    ({"taulu": "foods", "id": "f1", "data": {"id": "f1"}, "poistettu": True}, "ei ole dataa"),
    ({"taulu": "foods", "id": "f1", "data": {"id": "f1"}, "seq": 99}, "vain taulu"),
    ({"taulu": "weights", "id": "w1", "data": {"id": "w1", "kg": 80}}, "date puuttuu"),
    ({"taulu": "goals", "id": "g1", "data": {"id": "g1"}}, "effectiveDate puuttuu"),
    ({"taulu": "foods", "id": "f1", "data": {"id": "f1", "nimi": "x" * 70000}}, "64 KiB"),
    ("ei olio", "olio"),
])
def test_kelvoton_muutos_hylataan(y, muutos, viesti):
    with pytest.raises(kanta.Hylatty, match=viesti):
        kanta.sovella(y, [muutos], "x")


def test_liian_monta_muutosta(y):
    with pytest.raises(kanta.Hylatty, match="enintään 500"):
        kanta.sovella(y, [paino(f"w{i}", f"2026-01-{i % 28 + 1:02d}", 80) for i in range(501)], "x")


def test_haku_sivuttain_ja_kelvoton_jalkeen(y):
    kanta.sovella(y, [{"taulu": "foods", "id": f"f{i}", "data": {"id": f"f{i}"}} for i in range(3)], "x")
    eka, lisaa = kanta.hae(y, 0, raja=2)
    assert [m["seq"] for m in eka] == [1, 2] and lisaa is True
    toka, lisaa = kanta.hae(y, 2, raja=2)
    assert [m["seq"] for m in toka] == [3] and lisaa is False
    for huono in (-1, True, "1", 1.5):
        with pytest.raises(kanta.Hylatty):
            kanta.hae(y, huono)


def test_varmistus_ja_30_paivan_saily(y, tmp_path):
    hak = tmp_path / "varmistus"
    hak.mkdir()
    kanta.sovella(y, [paino("a1", "2026-10-20", 80.0)], "x")
    for vanha in ("2026-09-20", "2026-09-21", "2026-10-01", "roska"):
        (hak / f"paivakirja-{vanha}.sqlite").write_bytes(b"")
    luotu = kanta.varmista(y, hak, tanaan=date(2026, 10, 20))
    assert luotu == hak / "paivakirja-2026-10-20.sqlite"
    assert stat.S_IMODE(os.stat(luotu).st_mode) == 0o600
    kopio = sqlite3.connect(luotu)
    assert kopio.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert kopio.execute("SELECT COUNT(*) FROM merkinnat").fetchone()[0] == 1
    kopio.close()
    # säilytetään 2026-09-21 ... 2026-10-20 (30 päivää); 2026-09-20 poistuu, tuntematon nimi jää
    assert sorted(p.name for p in hak.iterdir()) == [
        "paivakirja-2026-09-21.sqlite", "paivakirja-2026-10-01.sqlite", "paivakirja-2026-10-20.sqlite",
        "paivakirja-roska.sqlite"]
    assert kanta.varmista(y, hak, tanaan=date(2026, 10, 20)) is None


def test_vienti_ilman_poistoja(y, tmp_path):
    kanta.sovella(y, [paino("a1", "2026-10-20", 80.0), {"taulu": "foods", "id": "f1", "data": {"id": "f1"}}], "x")
    kanta.sovella(y, [{"taulu": "foods", "id": "f1", "data": None, "poistettu": True}], "x")
    kohde = tmp_path / "paivakirja.json"
    kanta.vie(y, kohde)
    sisalto = json.loads(kohde.read_text())
    assert sisalto["versio"] == "ravintopolku-paivakirja-v1" and sisalto["seq"] == 3
    assert sisalto["taulut"]["weights"] == [{"id": "a1", "date": "2026-10-20", "kg": 80.0}]
    assert sisalto["taulut"]["foods"] == [] and "photos" not in sisalto["taulut"]
    assert stat.S_IMODE(os.stat(kohde).st_mode) == 0o640
    assert [p.name for p in tmp_path.iterdir() if p.name.startswith(".")] == []


def test_migraatio_luo_kayttajan_ja_profiilin():
    yhteys = sqlite3.connect(":memory:", check_same_thread=False)
    yhteys.executescript("CREATE TABLE merkinnat (taulu TEXT NOT NULL, id TEXT NOT NULL, data TEXT, "
                         "poistettu INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL UNIQUE, saapunut TEXT NOT NULL, "
                         "laite TEXT NOT NULL, PRIMARY KEY (taulu, id)); "
                         "CREATE TABLE luonnokset (id INTEGER PRIMARY KEY, external_id TEXT NOT NULL, source TEXT NOT NULL, "
                         "data TEXT, saapunut TEXT NOT NULL, tila TEXT NOT NULL DEFAULT 'pending', "
                         "UNIQUE (source, external_id));")
    yhteys.execute("INSERT INTO merkinnat (taulu, id, data, poistettu, seq, saapunut, laite) "
                   "VALUES ('weights', 'a1', '{}', 0, 1, 't', 'x')")
    kanta.migraatio(yhteys)
    assert yhteys.execute("SELECT id, nimi FROM kayttajat").fetchall() == [(1, "elias")]
    assert yhteys.execute("SELECT id, kayttaja_id, nimi FROM profiilit").fetchall() == [(1, 1, "Elias")]
    assert yhteys.execute("SELECT kayttaja_id, profiili_id FROM merkinnat").fetchall() == [(1, 1)]
    kanta.migraatio(yhteys)  # toisto on haitaton
    assert yhteys.execute("SELECT COUNT(*) FROM kayttajat").fetchone()[0] == 1


def test_omistukset_erottuvat_haussa_ja_laskussa(y):
    kanta.sovella(y, [paino("a1", "2026-10-20", 80.0)], "puhelin", kayttaja_id=1, profiili_id=1)
    k2 = kanta.kayttaja_lisaa(y, "matti")
    p2 = kanta.profiili_lisaa(y, k2, "Matti")
    kanta.sovella(y, [paino("b1", "2026-10-21", 90.0)], "puhelin", kayttaja_id=k2, profiili_id=p2)
    muutokset, _ = kanta.hae(y, 0, kanta.HAKU_MAX, 1, 1)
    assert [m["id"] for m in muutokset] == ["a1"] and [m["data"]["kg"] for m in muutokset] == [80.0]
    assert kanta.tilasto(y, 1, 1) == {"seq": 1, "merkintoja": 1, "poistomerkintoja": 0}
    assert kanta.tilasto(y, k2, p2) == {"seq": 2, "merkintoja": 1, "poistomerkintoja": 0}
    assert kanta.suurin_seq(y, 1, 1) == 1 and kanta.suurin_seq(y, k2, p2) == 2


def test_vienti_omistajakokeinen(y, tmp_path):
    kanta.sovella(y, [paino("a1", "2026-10-20", 80.0)], "x")
    k2 = kanta.kayttaja_lisaa(y, "matti")
    kanta.sovella(y, [paino("b1", "2026-10-21", 70.0)], "x", kayttaja_id=k2, profiili_id=1)
    kohde = tmp_path / "paivakirja.json"
    kanta.vie(y, kohde, None, 1, 1)
    sisalto = json.loads(kohde.read_text())
    assert [m["id"] for m in sisalto["taulut"]["weights"]] == ["a1"]
    assert sisalto["seq"] == 1


def test_api_avaimet(y):
    avain = "rp_" + "x" * 32
    tunnus = kanta.avain_lisaa(y, 1, avain, "testilaitteeksi")
    assert kanta.avain_vastaanota(y, avain) == 1
    rivi = kanta.avaimet_listaa(y, 1)[0]
    assert rivi["id"] == tunnus and rivi["etoniimi"] == "testilaitteeksi" and rivi["voimassa"] is True
    assert kanta.avain_vastaanota(y, "rp_tuntematon_avain_" + "z" * 24) is None
    assert kanta.avain_kielta(y, tunnus, 1) is True
    assert kanta.avain_kielta(y, tunnus, 1) is False
    assert kanta.avain_vastaanota(y, avain) is None


def test_kayttaja_ja_profiili_toisto(y):
    assert kanta.kayttaja_lisaa(y, "elias") == 1
    assert kanta.kayttaja_lisaa(y, "matti") == 2
    assert kanta.kayttaja_lisaa(y, "matti") == 2
    p1 = kanta.profiili_lisaa(y, 2, "Matti")
    assert kanta.profiili_lisaa(y, 2, "Matti") == p1
    with pytest.raises(kanta.Hylatty):
        kanta.profiili_lisaa(y, 99, "Ei ole")
    with pytest.raises(kanta.Hylatty):
        kanta.sovella(y, [paino("a1", "2026-10-20", 80.0)], "x", kayttaja_id=0)
    with pytest.raises(kanta.Hylatty):
        kanta.hae(y, 0, kanta.HAKU_MAX, True, 1)
