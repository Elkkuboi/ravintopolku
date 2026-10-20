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
