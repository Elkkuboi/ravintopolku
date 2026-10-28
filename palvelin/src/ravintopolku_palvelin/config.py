"""Konfiguraatio /etc/ravintopolku/palvelin.toml (aiops ADR-0016). Tiukka: tuntematon avain on virhe."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import tomllib
from types import MappingProxyType

OLETUS = Path("/etc/ravintopolku/palvelin.toml")
PORTTI = 8443
_HOSTNAME = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_NAME = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_LOGIN = re.compile(r"^[!-~]{1,254}$")
_PATH = re.compile(r"^(/[A-Za-z0-9._-]+)+$")
POLUT = ("tietokanta", "varmistus", "julkinen", "sovellus")
VALINNAISET_POLUT = ("luonnokset",)  # Ilmarin luonnosten pudotushakemisto (aiops ADR-0026); puuttuva = ei käytössä


class Virhe(Exception):
    pass


@dataclass(frozen=True)
class Asetukset:
    rp_id: str
    kayttajat: MappingProxyType
    tietokanta: Path
    varmistus: Path
    julkinen: Path
    sovellus: Path
    luonnokset: Path | None = None

    @property
    def alkupera(self) -> str:
        return f"https://{self.rp_id}:{PORTTI}"


def jasenna(data: dict) -> Asetukset:
    ongelmat: list[str] = []
    for avain in sorted(set(data) - {"palvelin"}):
        ongelmat.append(f"tuntematon avain {avain!r}")
    p = data.get("palvelin")
    if not isinstance(p, dict):
        raise Virhe("[palvelin] puuttuu")
    for avain in sorted(set(p) - {"rp_id", "kayttajat", *POLUT, *VALINNAISET_POLUT}):
        ongelmat.append(f"[palvelin]: tuntematon avain {avain!r}")
    rp = p.get("rp_id")
    if not isinstance(rp, str) or not _HOSTNAME.fullmatch(rp):
        ongelmat.append("[palvelin] rp_id: nimi pienillä kirjaimilla ilman porttia")
    polut = {}
    for nimi in POLUT + VALINNAISET_POLUT:
        arvo = p.get(nimi)
        if nimi in VALINNAISET_POLUT and nimi not in p:
            continue
        if not isinstance(arvo, str) or not _PATH.fullmatch(arvo) or {".", ".."} & set(arvo.split("/")):
            ongelmat.append(f"[palvelin] {nimi}: absoluuttinen polku ilman '.'- ja '..'-osia")
        else:
            polut[nimi] = Path(arvo)
    kayttajat = {}
    k = p.get("kayttajat")
    if not isinstance(k, dict) or not k:
        ongelmat.append("[palvelin.kayttajat] puuttuu tai on tyhjä")
    else:
        for tunnus, nimi in k.items():
            if not _LOGIN.fullmatch(tunnus) or not isinstance(nimi, str) or not _NAME.fullmatch(nimi):
                ongelmat.append(f"[palvelin.kayttajat]: kelvoton rivi {tunnus!r}")
            else:
                kayttajat[tunnus] = nimi
    if ongelmat:
        raise Virhe("; ".join(ongelmat))
    return Asetukset(rp_id=rp, kayttajat=MappingProxyType(kayttajat), **polut)


def lue(polku: Path = OLETUS) -> Asetukset:
    try:
        data = tomllib.loads(Path(polku).read_bytes().decode("utf-8"))
    except OSError as e:
        raise Virhe(f"konfiguraatiota {polku} ei voi lukea: {e.strerror}") from None
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as e:
        raise Virhe(f"{polku} ei ole kelvollista TOMLia: {e}") from None
    return jasenna(data)
