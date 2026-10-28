"""Palvelutiedosto ja konfiguraatio käsin kirjoitettuna totuutena (aiops ADR-0016)."""

from pathlib import Path

import pytest

from ravintopolku_palvelin.config import Virhe, jasenna, lue

JUURI = Path(__file__).resolve().parents[2]


def asetukset() -> dict[str, list[str]]:
    tulos: dict[str, list[str]] = {}
    for rivi in (JUURI / "config" / "systemd" / "ravintopolku.service").read_text(encoding="utf-8").splitlines():
        rivi = rivi.strip()
        if rivi and not rivi.startswith(("#", "[")):
            avain, _, arvo = rivi.partition("=")
            tulos.setdefault(avain, []).append(arvo)
    return tulos


def test_palvelutiedosto():
    s = asetukset()
    assert s["User"] == ["ravintopolku"] and s["Group"] == ["ravintopolku"] and "SupplementaryGroups" not in s
    assert s["ExecStart"] == ["/opt/ravintopolku/palvelin/.venv/bin/ravintopolku-palvelin --config "
                              "/etc/ravintopolku/palvelin.toml --socket /run/ravintopolku/palvelin.sock"]
    assert s["BindPaths"] == ["/srv/aiops/ravintopolku /srv/aiops/data/public/ravintopolku"]
    assert s["TemporaryFileSystem"] == ["/srv:ro"] and s["InaccessiblePaths"] == ["/etc/aiops"]
    for avain, arvo in {"PrivateNetwork": "yes", "RestrictAddressFamilies": "AF_UNIX", "ProtectSystem": "strict",
                        "ProtectHome": "yes", "NoNewPrivileges": "yes", "CapabilityBoundingSet": "",
                        "RuntimeDirectoryMode": "0700", "MemoryDenyWriteExecute": "yes",
                        "SystemCallFilter": "@system-service"}.items():
        assert s[avain] == [arvo], avain
    assert "ReadWritePaths" not in s and "BindReadOnlyPaths" not in s


def test_konfiguraatiomalli_kelpaa():
    a = lue(JUURI / "config" / "palvelin.toml.esimerkki")
    assert a.alkupera == "https://tyoasema.tailnet.ts.net:8443" and dict(a.kayttajat) == {"tunnus@github": "elias"}
    assert a.luonnokset == Path("/srv/aiops/ravintopolku/luonnokset")


def test_pudotushakemisto_on_valinnainen():
    p = {"rp_id": "tyoasema.ts.net", "tietokanta": "/a/p.sqlite", "varmistus": "/a/v", "julkinen": "/a/j.json",
         "sovellus": "/opt/d", "kayttajat": {"t@github": "elias"}}
    assert jasenna({"palvelin": p}).luonnokset is None
    assert jasenna({"palvelin": {**p, "luonnokset": "/srv/l"}}).luonnokset == Path("/srv/l")


@pytest.mark.parametrize("muutos", [
    lambda p: p.update(muu=1),
    lambda p: p.update(rp_id="Tyoasema.ts.net"),
    lambda p: p.update(rp_id="tyoasema.ts.net:8443"),
    lambda p: p.update(tietokanta="suhteellinen/polku"),
    lambda p: p.update(julkinen="/srv/aiops/../etc/x.json"),
    lambda p: p.update(luonnokset="suhteellinen"),
    lambda p: p.update(luonnokset=""),
    lambda p: p.update(luonnokset=None),
    lambda p: p.update(kayttajat={}),
    lambda p: p.update(kayttajat={"a b": "elias"}),
])
def test_kelvoton_konfiguraatio(muutos):
    p = {"rp_id": "tyoasema.ts.net", "tietokanta": "/a/p.sqlite", "varmistus": "/a/v", "julkinen": "/a/j.json",
         "sovellus": "/opt/d", "kayttajat": {"t@github": "elias"}}
    muutos(p)
    with pytest.raises(Virhe):
        jasenna({"palvelin": p})
