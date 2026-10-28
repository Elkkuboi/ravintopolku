"""Ilmarin luonnosten tiedostopudotus (aiops ADR-0026): tarkistus, nouto, hylkäys, toistot ja vanheneminen."""

from datetime import datetime, timedelta, timezone
import json
import os
import re
import stat

import pytest

from ravintopolku_palvelin import kanta, luonnokset

NYT = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def luonnos() -> dict:
    return {"schemaVersion": 1, "name": "Kaurapuuro ja marjat",
            "lines": [{"name": "Kaurapuuro", "mode": "per100", "grams": 250,
                       "values": {"energy": 60, "protein": 2.1, "carbs": 10, "fat": 1.2, "fiber": None},
                       "source": "pakkaus", "state": "kypsä"}],
            "unknowns": ["marjojen määrä"], "assumptions": [], "questions": ["Lisäsitkö maitoa?"],
            "provenance": {"provider": "ilmari", "model": "paikallinen", "note": ""}}


def kuori(external_id="job-42-result-1", **muutokset) -> dict:
    return {"schemaVersion": 1, "source": "ilmari", "externalId": external_id, "dataClass": "private",
            "draft": luonnos(), **muutokset}


@pytest.fixture
def y(tmp_path):
    yhteys = kanta.avaa(tmp_path / "p.sqlite")
    yield yhteys
    yhteys.close()


@pytest.fixture
def hak(tmp_path):
    h = tmp_path / "luonnokset"
    h.mkdir()
    return h


def pudota(hak, nimi: str, sisalto) -> None:
    (hak / nimi).write_text(sisalto if isinstance(sisalto, str) else json.dumps(sisalto), encoding="utf-8")


def test_kelvollinen_tiedosto_tallentuu_ja_poistuu(y, hak):
    pudota(hak, "20261028-120000-job-42-result-1.json", kuori())
    assert luonnokset.nouda(y, hak, NYT) == {"tallennettu": 1, "toisto": 0, "hylatty": 0, "odottaa": 0}
    assert sorted(p.name for p in hak.iterdir()) == []
    odottavat = kanta.luonnokset_odottavat(y)
    assert len(odottavat) == 1 and odottavat[0]["id"] == 1 and odottavat[0]["externalId"] == "job-42-result-1"
    assert odottavat[0]["source"] == "ilmari" and odottavat[0]["saapunut"] == "2026-10-28T12:00:00+00:00"
    assert odottavat[0]["draft"] == luonnos() and "dataClass" not in odottavat[0]


def test_nimijarjestys_ja_muut_nimet_jatetaan_rauhaan(y, hak):
    pudota(hak, "20261028-120001-b.json", kuori("b"))
    pudota(hak, "20261028-120000-a.json", kuori("a"))
    pudota(hak, ".20261028-120002-c.json.tmp", "{")  # keskeneräinen kirjoitus
    pudota(hak, "muistio.txt", "ei luonnos")
    assert luonnokset.nouda(y, hak, NYT)["tallennettu"] == 2
    assert [o["externalId"] for o in kanta.luonnokset_odottavat(y)] == ["b", "a"]  # uusin ensin
    assert sorted(p.name for p in hak.iterdir()) == [".20261028-120002-c.json.tmp", "muistio.txt"]


def hylatty(hak, nimi):
    syy = (hak / "hylatyt" / f"{nimi}.syy.txt").read_text(encoding="utf-8")
    assert (hak / "hylatyt" / nimi).exists() and not (hak / nimi).exists()
    assert syy.startswith("2026-10-28T12:00:00+00:00 " + nimi + ": ")
    return syy


@pytest.mark.parametrize("nimi,sisalto,syy", [
    ("20261028-120000-r.json", kuori("r", dataClass="restricted"), "restricted"),
    ("20261028-120000-l.json", kuori("l", dataClass="salainen"), "dataClass"),
    ("20261028-120000-v.json", kuori("v", schemaVersion=2), "kuori.schemaVersion"),
    ("20261028-120000-s.json", kuori("s", source="ilmari hub"), "kuori.source"),
    ("20261028-120000-e.json", kuori("e" * 129), "kuori.externalId"),
    ("20261028-120000-x.json", {**kuori("x"), "extra": 1}, "tuntemattomat kentät extra"),
    ("20261028-120000-p.json", {k: v for k, v in kuori("p").items() if k != "draft"}, "draft puuttuvat"),
    ("20261028-120000-j.json", "{ei json", "ei ole UTF-8-JSONia"),
    ("20261028-120000-n.json", "[NaN]", "ei ole UTF-8-JSONia"),
    ("20261028-120000-t.json", "[1]", "kuori: olio"),
])
def test_kelvoton_kuori_siirtyy_hylattyihin(y, hak, nimi, sisalto, syy):
    pudota(hak, nimi, sisalto)
    assert luonnokset.nouda(y, hak, NYT) == {"tallennettu": 0, "toisto": 0, "hylatty": 1, "odottaa": 0}
    assert syy in hylatty(hak, nimi)
    assert kanta.luonnoksia_odottaa(y) == 0


def muokattu(**kentat):
    k = kuori("d")
    k["draft"].update(kentat)
    return k


def rivilla(**kentat):
    k = kuori("d")
    k["draft"]["lines"][0].update(kentat)
    return k


@pytest.mark.parametrize("kuori_,viesti", [
    (muokattu(schemaVersion=True), "draft.schemaVersion"),
    (muokattu(name=""), "draft.name"),
    (muokattu(name="x" * 201), "draft.name"),
    (muokattu(lines=[]), "draft.lines"),
    (muokattu(lines=[luonnos()["lines"][0]] * 101), "draft.lines"),
    (muokattu(unknowns="ei lista"), "draft.unknowns"),
    (muokattu(assumptions=[1]), "draft.assumptions[0]"),
    (muokattu(questions=["x" * 2001]), "draft.questions[0]"),
    (muokattu(provenance={"provider": "", "model": None, "note": ""}), "draft.provenance.provider"),
    (muokattu(provenance={"provider": "p", "model": 3, "note": ""}), "draft.provenance.model"),
    (muokattu(provenance={"provider": "p", "note": ""}), "draft.provenance: kentät model puuttuvat"),
    (rivilla(mode="kpl"), "draft.lines[0].mode"),
    (rivilla(grams=0), "draft.lines[0].grams"),
    (rivilla(grams="250"), "draft.lines[0].grams"),
    (rivilla(grams=True), "draft.lines[0].grams"),
    (rivilla(values={"energy": -1, "protein": None, "carbs": None, "fat": None, "fiber": None}),
     "draft.lines[0].values.energy"),
    (rivilla(values={"energy": 1, "protein": None, "carbs": None, "fat": None}), "draft.lines[0].values"),
    (rivilla(source=""), "draft.lines[0].source"),
    (rivilla(state="x" * 101), "draft.lines[0].state"),
    (rivilla(id="abc"), "draft.lines[0]: tuntemattomat kentät id"),
])
def test_kelvoton_luonnos(kuori_, viesti):
    with pytest.raises(kanta.Hylatty, match=re.escape(viesti)):
        luonnokset.tarkista_kuori(kuori_)


def test_kelvollinen_kuori_palautetaan():
    k = kuori()
    k["draft"]["lines"][0]["grams"] = None
    k["draft"]["provenance"]["model"] = None
    assert luonnokset.tarkista_kuori(k) is k


def test_liian_suuri_tiedosto(y, hak):
    k = kuori("iso")
    k["draft"]["assumptions"] = ["x" * 2000] * 40  # ~80 KiB
    pudota(hak, "20261028-120000-iso.json", k)
    assert luonnokset.nouda(y, hak, NYT)["hylatty"] == 1
    assert "yli 64 KiB" in hylatty(hak, "20261028-120000-iso.json")


def test_symbolinen_linkki_ja_putki(y, hak, tmp_path):
    kohde = tmp_path / "ulkopuolinen.json"
    kohde.write_text(json.dumps(kuori("linkki")))
    os.symlink(kohde, hak / "20261028-120000-linkki.json")
    os.mkfifo(hak / "20261028-120001-putki.json")
    assert luonnokset.nouda(y, hak, NYT) == {"tallennettu": 0, "toisto": 0, "hylatty": 2, "odottaa": 0}
    assert "symbolinen linkki" in hylatty(hak, "20261028-120000-linkki.json")
    assert (hak / "hylatyt" / "20261028-120000-linkki.json").is_symlink() and kohde.exists()
    assert "ei tavallinen tiedosto" in hylatty(hak, "20261028-120001-putki.json")
    assert stat.S_IMODE(os.stat(hak / "hylatyt").st_mode) == 0o770
    assert stat.S_IMODE(os.stat(hak / "hylatyt" / "20261028-120001-putki.json.syy.txt").st_mode) == 0o640


def test_toisto_poistetaan_ilman_uutta_luonnosta(y, hak):
    pudota(hak, "20261028-120000-job-1.json", kuori("job-1"))
    assert luonnokset.nouda(y, hak, NYT)["tallennettu"] == 1
    pudota(hak, "20261028-120500-job-1.json", kuori("job-1"))  # sama tunniste uudelleen
    assert luonnokset.nouda(y, hak, NYT) == {"tallennettu": 0, "toisto": 1, "hylatty": 0, "odottaa": 0}
    assert sorted(p.name for p in hak.iterdir()) == [] and kanta.luonnoksia_odottaa(y) == 1
    assert kanta.luonnos_valmis(y, 1) is True
    pudota(hak, "20261028-121000-job-1.json", kuori("job-1"))  # käsitelty luonnos ei palaa laatikkoon
    assert luonnokset.nouda(y, hak, NYT)["toisto"] == 1 and kanta.luonnoksia_odottaa(y) == 0
    pudota(hak, "20261028-121000-job-1b.json", kuori("job-1", source="toinen"))  # eri source on eri luonnos
    assert luonnokset.nouda(y, hak, NYT)["tallennettu"] == 1


def test_laatikko_tayttyy_sadasta(y, hak):
    for i in range(kanta.LUONNOKSIA_MAX + 2):
        pudota(hak, f"20261028-12{i:04d}-j{i}.json", kuori(f"j{i}"))
    assert luonnokset.nouda(y, hak, NYT) == {"tallennettu": 100, "toisto": 0, "hylatty": 0, "odottaa": 2}
    assert sorted(p.name for p in hak.iterdir()) == ["20261028-120100-j100.json", "20261028-120101-j101.json"]
    assert kanta.luonnos_valmis(y, 1) is True
    assert luonnokset.nouda(y, hak, NYT) == {"tallennettu": 1, "toisto": 0, "hylatty": 0, "odottaa": 1}


def test_vanheneminen_seitseman_paivan_jalkeen(y):
    kanta.luonnos_lisaa(y, kuori("vanha"), NYT - timedelta(days=7, seconds=1))
    kanta.luonnos_lisaa(y, kuori("raja"), NYT - timedelta(days=7))
    kanta.luonnos_lisaa(y, kuori("uusi"), NYT)
    assert kanta.luonnokset_vanhenna(y, NYT) == 1
    assert [o["externalId"] for o in kanta.luonnokset_odottavat(y)] == ["uusi", "raja"]
    assert y.execute("SELECT tila, data FROM luonnokset WHERE external_id = 'vanha'").fetchone() == ("done", None)
    assert kanta.luonnos_valmis(y, 1) is False  # jo käsitelty
    assert kanta.luonnos_valmis(y, 99) is False  # tuntematon


def test_puuttuva_hakemisto_ei_kaada(y, tmp_path):
    assert luonnokset.nouda(y, tmp_path / "ei-ole", NYT) == {"tallennettu": 0, "toisto": 0, "hylatty": 0, "odottaa": 0}
