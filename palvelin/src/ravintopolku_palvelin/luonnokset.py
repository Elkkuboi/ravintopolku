"""Ilmarin aterialuonnosten tiedostopudotus (aiops ADR-0026).

Ilmari (aiops-gw) kirjoittaa tuloskuoren tiedostoon <YYYYMMDD-HHMMSS>-<externalId>.json pudotushakemistoon. Palvelin lukee
hakemiston huoltosilmukassa ja laatikkoa haettaessa, tarkistaa kuoren samoilla säännöillä kuin Node-palvelimen
vastaanotto (docs/ilmari-integration.md, src/ai/contracts.ts), tallentaa luonnoksen odottavaksi ja poistaa tiedoston.
Kelvoton tiedosto siirretään alihakemistoon hylatyt/ ja syy kirjoitetaan viereen <nimi>.syy.txt-tiedostoon; mitään ei
poisteta hiljaa. Tiedostot avataan seuraamatta symbolisia linkkejä, vain tavalliset tiedostot ja enintään 64 KiB kelpaavat.
"""

from __future__ import annotations

from datetime import datetime, timezone
import errno
import json
import logging
import math
import os
from pathlib import Path
import re
import sqlite3
import stat

from . import kanta
from .kanta import Hylatty

TIEDOSTO_MAX = 64 * 1024
HYLATYT = "hylatyt"
NIMI = re.compile(r"^\d{8}-\d{6}-[A-Za-z0-9._:-]{1,128}\.json$")
LAHDE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
TUNNISTE = re.compile(r"^[a-zA-Z0-9._:-]{1,128}$")
DATALUOKAT = ("public", "private", "restricted")
loki = logging.getLogger("ravintopolku")


def _olio(arvo: object, kentat: tuple[str, ...], polku: str) -> dict:
    if not isinstance(arvo, dict):
        raise Hylatty(f"{polku}: olio")
    puuttuu, ylimaaraiset = sorted(set(kentat) - set(arvo)), sorted(set(arvo) - set(kentat))
    if puuttuu or ylimaaraiset:
        raise Hylatty(f"{polku}: kentät {', '.join(puuttuu)} puuttuvat" if puuttuu
                      else f"{polku}: tuntemattomat kentät {', '.join(ylimaaraiset)}")
    return arvo


def _teksti(arvo: object, polku: str, vahintaan: int = 0, enintaan: int = 2000) -> str:
    if not isinstance(arvo, str) or not vahintaan <= len(arvo) <= enintaan:
        raise Hylatty(f"{polku}: merkkijono, {vahintaan}–{enintaan} merkkiä")
    return arvo


def _luku(arvo: object, polku: str, vahintaan: float, enintaan: float, tyhja_sallittu: bool = True,
          avoin_alaraja: bool = False) -> float | None:
    if arvo is None and tyhja_sallittu:
        return None
    if isinstance(arvo, bool) or not isinstance(arvo, (int, float)) or not math.isfinite(arvo):
        raise Hylatty(f"{polku}: luku tai null")
    if arvo > enintaan or arvo < vahintaan or (avoin_alaraja and arvo == vahintaan):
        raise Hylatty(f"{polku}: luku väliltä {vahintaan}–{enintaan}")
    return arvo


def _tekstilista(arvo: object, polku: str) -> list[str]:
    if not isinstance(arvo, list) or len(arvo) > 100:
        raise Hylatty(f"{polku}: lista, enintään 100 merkkijonoa")
    return [_teksti(a, f"{polku}[{i}]") for i, a in enumerate(arvo)]


def _rivi(arvo: object, polku: str) -> None:
    rivi = _olio(arvo, ("name", "mode", "grams", "values", "source", "state"), polku)
    _teksti(rivi["name"], f"{polku}.name", 1, 200)
    if rivi["mode"] not in ("per100", "portion"):
        raise Hylatty(f"{polku}.mode: per100 tai portion")
    _luku(rivi["grams"], f"{polku}.grams", 0, 100000, avoin_alaraja=True)
    arvot = _olio(rivi["values"], ("energy", "protein", "carbs", "fat", "fiber"), f"{polku}.values")
    for nimi, a in arvot.items():
        _luku(a, f"{polku}.values.{nimi}", 0, 100000)
    _teksti(rivi["source"], f"{polku}.source", 1, 500)
    _teksti(rivi["state"], f"{polku}.state", 0, 100)


def tarkista_luonnos(arvo: object, polku: str = "draft") -> dict:
    """AIDraft (src/ai/provider.ts draftSchema, docs/ai-draft.schema.json): tarkka rakenne, ei ylimääräisiä kenttiä."""
    luonnos = _olio(arvo, ("schemaVersion", "name", "lines", "unknowns", "assumptions", "questions", "provenance"), polku)
    if isinstance(luonnos["schemaVersion"], bool) or luonnos["schemaVersion"] != 1:
        raise Hylatty(f"{polku}.schemaVersion: 1")
    _teksti(luonnos["name"], f"{polku}.name", 1, 200)
    if not isinstance(luonnos["lines"], list) or not 1 <= len(luonnos["lines"]) <= 100:
        raise Hylatty(f"{polku}.lines: lista, 1–100 riviä")
    for i, rivi in enumerate(luonnos["lines"]):
        _rivi(rivi, f"{polku}.lines[{i}]")
    for nimi in ("unknowns", "assumptions", "questions"):
        _tekstilista(luonnos[nimi], f"{polku}.{nimi}")
    alkupera = _olio(luonnos["provenance"], ("provider", "model", "note"), f"{polku}.provenance")
    _teksti(alkupera["provider"], f"{polku}.provenance.provider", 1, 200)
    if alkupera["model"] is not None:
        _teksti(alkupera["model"], f"{polku}.provenance.model", 0, 200)
    _teksti(alkupera["note"], f"{polku}.provenance.note", 0, 2000)
    return luonnos


def tarkista_kuori(arvo: object) -> dict:
    """Tuloskuori kuten Node-palvelimen vastaanotossa (incomingSchema); restricted hylätään aina."""
    kuori = _olio(arvo, ("schemaVersion", "source", "externalId", "dataClass", "draft"), "kuori")
    if isinstance(kuori["schemaVersion"], bool) or kuori["schemaVersion"] != 1:
        raise Hylatty("kuori.schemaVersion: 1")
    if not isinstance(kuori["source"], str) or not LAHDE.fullmatch(kuori["source"]):
        raise Hylatty("kuori.source: 1–64 merkkiä [a-zA-Z0-9_-]")
    if not isinstance(kuori["externalId"], str) or not TUNNISTE.fullmatch(kuori["externalId"]):
        raise Hylatty("kuori.externalId: 1–128 merkkiä [a-zA-Z0-9._:-]")
    if kuori["dataClass"] not in DATALUOKAT:
        raise Hylatty("kuori.dataClass: public, private tai restricted")
    if kuori["dataClass"] == "restricted":
        raise Hylatty("rajoitettua aiops-dataa (restricted) ei oteta vastaan")
    tarkista_luonnos(kuori["draft"])
    return kuori


def _lue(polku: Path) -> bytes:
    """Avaa seuraamatta linkkejä; vain tavallinen tiedosto, enintään 64 KiB."""
    try:
        fd = os.open(polku, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    except OSError as e:
        raise Hylatty("symbolinen linkki" if e.errno == errno.ELOOP else f"tiedostoa ei voi avata: {e.strerror}") from None
    try:
        tiedot = os.fstat(fd)
        if not stat.S_ISREG(tiedot.st_mode):
            raise Hylatty("ei tavallinen tiedosto")
        if tiedot.st_size > TIEDOSTO_MAX:
            raise Hylatty(f"tiedosto on yli {TIEDOSTO_MAX // 1024} KiB")
        data = b""
        while pala := os.read(fd, TIEDOSTO_MAX + 1 - len(data)):
            data += pala
            if len(data) > TIEDOSTO_MAX:
                raise Hylatty(f"tiedosto on yli {TIEDOSTO_MAX // 1024} KiB")
        return data
    finally:
        os.close(fd)


def _jasenna(data: bytes) -> object:
    def vakio(nimi: str) -> None:
        raise ValueError(nimi)
    try:
        return json.loads(data.decode("utf-8"), parse_constant=vakio)
    except (UnicodeDecodeError, ValueError):
        raise Hylatty("tiedosto ei ole UTF-8-JSONia") from None


def _hylkaa(hakemisto: Path, nimi: str, syy: str, nyt: datetime) -> None:
    """Siirtää tiedoston (tai linkin itsensä) hakemistoon hylatyt/ ja kirjoittaa syyn viereen."""
    kohde = hakemisto / HYLATYT
    if not kohde.is_dir():
        os.mkdir(kohde, 0o770)
        os.chmod(kohde, 0o770)  # umask 0077 ei saa estää ryhmää ravintopolku lukemasta syytä
    os.replace(hakemisto / nimi, kohde / nimi)
    fd = os.open(kohde / f"{nimi}.syy.txt", os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o640)
    try:
        os.write(fd, f"{nyt.isoformat(timespec='seconds')} {nimi}: {syy}\n".encode("utf-8"))
    finally:
        os.close(fd)
    loki.warning("luonnos %s hylätty: %s", nimi, syy)


def nouda(yhteys: sqlite3.Connection, hakemisto: Path, nyt: datetime | None = None) -> dict[str, int]:
    """Lukee pudotushakemiston nimijärjestyksessä (aikaleima ensin). Palauttaa laskurit: tallennettu, toisto, hylatty,
    odottaa (jätetty paikalleen, koska laatikko on täynnä)."""
    aika = nyt or datetime.now(timezone.utc)
    laskurit = {"tallennettu": 0, "toisto": 0, "hylatty": 0, "odottaa": 0}
    try:
        nimet = sorted(n for n in os.listdir(hakemisto) if NIMI.fullmatch(n))
    except OSError as e:
        loki.warning("pudotushakemistoa %s ei voi lukea: %s", hakemisto, e.strerror)
        return laskurit
    for nimi in nimet:
        try:
            kuori = tarkista_kuori(_jasenna(_lue(hakemisto / nimi)))
        except Hylatty as e:
            _hylkaa(hakemisto, nimi, str(e), aika)
            laskurit["hylatty"] += 1
            continue
        if kanta.luonnos_on_vastaanotettu(yhteys, kuori["source"], kuori["externalId"]):
            os.unlink(hakemisto / nimi)
            laskurit["toisto"] += 1
            continue
        if kanta.luonnoksia_odottaa(yhteys) >= kanta.LUONNOKSIA_MAX:
            laskurit["odottaa"] += 1  # tiedosto jää odottamaan, kunnes käyttäjä käsittelee laatikkoa
            continue
        if kanta.luonnos_lisaa(yhteys, kuori, aika) is None:  # kilpaileva lisäys samalla tunnisteella
            laskurit["toisto"] += 1
        else:
            laskurit["tallennettu"] += 1
        os.unlink(hakemisto / nimi)
    if laskurit["odottaa"]:
        loki.warning("luonnoslaatikko on täynnä (%d); %d tiedostoa odottaa", kanta.LUONNOKSIA_MAX, laskurit["odottaa"])
    return laskurit
