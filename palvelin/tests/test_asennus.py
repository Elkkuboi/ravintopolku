"""Asennusskripti scripts/asenna-tyoasema.sh ajettuna väliaikaisessa juuressa.

Skripti tarvitsee oikeasti rootin, Dockerin ja systemd:n. Tässä ne ovat pieniä valekomentoja polun alussa, ja
RAVINTOPOLKU_ASENNUSJUURI siirtää isännän polut väliaikaiseen hakemistoon. Testi ajaa oikean skriptin oikealla
gitillä: onnistunut asennus, paluu edelliseen versioon jokaisesta virhekohdasta, --vain-sovellus ja se, ettei
puuttuva Python ehdi rikkoa mitään.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

import pytest

JUURI = Path(__file__).resolve().parents[2]
RYHMA = "SupplementaryGroups=aiops-ceo"

VALEKOMENNOT = {
    "id": '#!/bin/sh\nif [ "$1" = "-u" ]; then echo 0; else exec /usr/bin/id "$@"; fi\n',
    "getent": "#!/bin/sh\nexit 0\n",
    "chown": "#!/bin/sh\nexit 0\n",
    # Odotukset ohitetaan, paitsi kun testi haluaa aikaa lähettää signaalin (OIKEA_UNI).
    "sleep": '#!/bin/sh\n[ -z "${OIKEA_UNI:-}" ] || exec /usr/bin/sleep "$@"\nexit 0\n',
    "install": """#!/usr/bin/env bash
a=(); while [ $# -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) a+=("$1"); shift;; esac; done
exec /usr/bin/install "${a[@]}"
""",
    "sudo": '#!/usr/bin/env bash\n[ "$1" = "-u" ] && shift 2\nexec "$@"\n',
    "docker": """#!/usr/bin/env bash
echo "docker $*" >> "$LOKI"
src=""; edellinen=""
for a in "$@"; do [ "$edellinen" = "-v" ] && src="${a%%:*}"; edellinen="$a"; done
case "$*" in
  *"npm test"*) [ -z "${TESTIT_PETTAVAT:-}" ] || exit 1 ;;
  *"npm run build"*)
    mkdir -p "$src/dist"
    for f in index.html manifest.webmanifest sw.js; do echo uusi > "$src/dist/$f"; done ;;
esac
""",
    "systemctl": """#!/usr/bin/env bash
echo "systemctl $*" >> "$LOKI"
ajo="$VALEJUURI/run/ravintopolku"
case "$1" in
  is-active) [ -f "$TILA/aktiivinen" ] ;;
  stop) rm -f "$TILA/aktiivinen" "$ajo/palvelin.sock" ;;
  start)
    # Kuten systemd: käynnissä olevalle palvelulle start ei tee mitään (prosessi ja sen versio pysyvät).
    [ ! -f "$TILA/aktiivinen" ] || exit 0
    [ -z "${HIDAS_KAYNNISTYS:-}" ] || /usr/bin/sleep "$HIDAS_KAYNNISTYS"
    versio=vanha; [ ! -f "$VALEJUURI/opt/ravintopolku/palvelin/uusi" ] || versio=uusi
    # Testi voi määrätä, ettei uusi palvelin pysy käynnissä; edellinen käynnistyy aina.
    if [ -n "${UUSI_EI_KAYNNISTY:-}" ] && [ "$versio" = uusi ]; then exit 0; fi
    mkdir -p "$ajo"
    (cd "$ajo" && python3 -c 'import socket; socket.socket(socket.AF_UNIX).bind("palvelin.sock")')
    echo "$versio" > "$TILA/aktiivinen" ;;
esac
""",
    "uv": """#!/usr/bin/env bash
echo "uv $* lataus=${UV_PYTHON_DOWNLOADS:-}" >> "$LOKI"
[ -z "${UV_PETTAA:-}" ] || exit 1
[ -z "${HIDAS_UV:-}" ] || /usr/bin/sleep "$HIDAS_UV"
mkdir -p .venv/bin
printf '#!/bin/sh\\nexit 0\\n' > .venv/bin/ravintopolku-palvelin
chmod +x .venv/bin/ravintopolku-palvelin
touch uusi
""",
}


class Kone:
    """Väliaikainen repo, valejuuri edellisellä asennuksella ja valekomennot."""

    def __init__(self, tmp: Path, *, kaynnissa: bool = True, lisaryhma: bool = True, python: bool = True):
        self.repo, self.j, self.tila, self.bin = tmp / "repo", tmp / "j", tmp / "tila", tmp / "bin"
        self.loki = tmp / "loki"
        for h in (self.repo / "scripts", self.repo / "config" / "systemd", self.tila, self.bin):
            h.mkdir(parents=True)
        shutil.copy(JUURI / "scripts" / "asenna-tyoasema.sh", self.repo / "scripts")
        shutil.copy(JUURI / "config" / "systemd" / "ravintopolku.service", self.repo / "config" / "systemd")
        (self.repo / "palvelin" / "src").mkdir(parents=True)
        for nimi in ("pyproject.toml", "uv.lock", ".python-version"):
            shutil.copy(JUURI / "palvelin" / nimi, self.repo / "palvelin")
        (self.repo / "palvelin" / "src" / "koodi.py").write_text("uusi\n")
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("-c", "user.name=testi", "-c", "user.email=testi@example.invalid", "commit", "-q", "-m", "testi")
        for nimi, sisalto in VALEKOMENNOT.items():
            (self.bin / nimi).write_text(sisalto)
            (self.bin / nimi).chmod(0o755)

        self.kohde = self.j / "opt" / "ravintopolku"
        (self.kohde / "dist").mkdir(parents=True)
        (self.kohde / "dist" / "index.html").write_text("vanha\n")
        (self.kohde / "palvelin" / ".venv" / "bin").mkdir(parents=True)
        (self.kohde / "palvelin" / "vanha").write_text("")
        (self.kohde / "DEPLOYED").write_text("vanha 2026-11-24T00:22:00+02:00\n")
        self.unitdir = self.j / "etc" / "systemd" / "system"
        self.unitdir.mkdir(parents=True)
        self.repon_unit = (JUURI / "config" / "systemd" / "ravintopolku.service").read_text(encoding="utf-8")
        asennettu = self.repon_unit
        if lisaryhma:  # kuten Louhilla: siirto lisäsi rivin palvelutiedostoon
            asennettu = asennettu.replace("Group=ravintopolku\n", f"Group=ravintopolku\n{RYHMA}\n")
            assert RYHMA in asennettu
        self.unit = self.unitdir / "ravintopolku.service"
        self.unit.write_text(asennettu, encoding="utf-8")
        self.vanha_unit = asennettu
        self.lisa = self.unitdir / "ravintopolku.service.d" / "isanta.conf"
        if python:
            (self.j / "usr" / "bin").mkdir(parents=True)
            (self.j / "usr" / "bin" / "python3.14").write_text("#!/bin/sh\n")
            (self.j / "usr" / "bin" / "python3.14").chmod(0o755)
        if kaynnissa:
            (self.tila / "aktiivinen").write_text("vanha\n")

    def git(self, *args: str) -> None:
        subprocess.run(["git", "-C", str(self.repo), *args], check=True)

    def ymparisto(self, **lisa: str) -> dict[str, str]:
        return {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "RAVINTOPOLKU_ASENNUSJUURI": str(self.j),
                "VALEJUURI": str(self.j), "TILA": str(self.tila), "LOKI": str(self.loki), **lisa}

    def aja(self, *args: str, **ymparisto: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["bash", str(self.repo / "scripts" / "asenna-tyoasema.sh"), *args],
                              env=self.ymparisto(**ymparisto), capture_output=True, text=True, timeout=60)

    def kaynnista(self, virheet: Path, **ymparisto: str) -> subprocess.Popen[bytes]:
        """Täysi asennus taustalle omassa prosessiryhmässään, jotta testi voi lähettää sille signaalin kuten pääte."""
        return subprocess.Popen(["bash", str(self.repo / "scripts" / "asenna-tyoasema.sh"), str(self.bin / "uv")],
                                env=self.ymparisto(**ymparisto), stdout=subprocess.DEVNULL, stderr=virheet.open("wb"),
                                start_new_session=True)

    def odota(self, ehto, kuvaus: str, aikaraja: float = 20.0) -> None:
        loppu = time.monotonic() + aikaraja
        while not ehto():
            assert time.monotonic() < loppu, f"ei tapahtunut ajoissa: {kuvaus}"
            time.sleep(0.02)

    def taysi(self, **ymparisto: str) -> subprocess.CompletedProcess[str]:
        return self.aja(str(self.bin / "uv"), **ymparisto)

    @property
    def kaynnissa(self) -> bool:
        return (self.tila / "aktiivinen").exists()

    @property
    def versio(self) -> str | None:
        """Käynnissä olevan prosessin versio: se, joka oli asennettuna, kun palvelu käynnistettiin."""
        return (self.tila / "aktiivinen").read_text().strip() if self.kaynnissa else None

    def kutsut(self, komento: str) -> list[str]:
        if not self.loki.exists():
            return []
        return [r for r in self.loki.read_text().splitlines() if r.startswith(komento + " ")]

    def ennallaan(self) -> None:
        """Edellinen asennus on koskematon: sovellus, palvelin, palvelutiedosto ja DEPLOYED."""
        assert (self.kohde / "dist" / "index.html").read_text() == "vanha\n"
        assert (self.kohde / "palvelin" / "vanha").exists() and not (self.kohde / "palvelin" / "uusi").exists()
        assert self.unit.read_text(encoding="utf-8") == self.vanha_unit
        assert not self.lisa.exists() and not self.lisa.parent.exists()
        assert (self.kohde / "DEPLOYED").read_text().startswith("vanha ")
        assert sorted(p.name for p in self.kohde.iterdir()) == ["DEPLOYED", "dist", "palvelin"]


@pytest.fixture
def kone(tmp_path: Path) -> Kone:
    return Kone(tmp_path)


def test_taysi_asennus_vaihtaa_kaiken_ja_sailyttaa_isannan_lisaryhman(kone: Kone):
    tulos = kone.taysi()
    assert tulos.returncode == 0, tulos.stderr
    assert (kone.kohde / "dist" / "index.html").read_text() == "uusi\n"
    assert (kone.kohde / "palvelin" / "uusi").exists() and not (kone.kohde / "palvelin" / "vanha").exists()
    assert (kone.kohde / "palvelin" / "src" / "koodi.py").read_text() == "uusi\n"
    assert sorted(p.name for p in kone.kohde.iterdir()) == ["DEPLOYED", "dist", "palvelin"]
    assert not (kone.kohde / "DEPLOYED").read_text().startswith("vanha ")
    # repon palvelutiedosto sellaisenaan; Louhin lisäryhmä on siirtynyt drop-iniin
    assert kone.unit.read_text(encoding="utf-8") == kone.repon_unit
    assert not any(r.startswith("SupplementaryGroups=") for r in kone.repon_unit.splitlines())
    assert kone.lisa.read_text(encoding="utf-8").splitlines()[-2:] == ["[Service]", RYHMA]
    # pysäytys ennen vaihtoa, käynnistys vaihdon jälkeen; uv koneen omalla Pythonilla eikä lataa tulkkia
    jarjestys = [r.split()[1] for r in kone.kutsut("systemctl") if r.split()[1] in ("stop", "daemon-reload", "start")]
    assert jarjestys == ["stop", "daemon-reload", "start"]
    assert kone.versio == "uusi"
    (uv,) = kone.kutsut("uv")
    assert f"--python {kone.j}/usr/bin/python3.14" in uv and uv.endswith("lataus=never")
    assert "--frozen --no-dev --no-editable" in uv
    assert "Valmis:" in tulos.stdout


def test_toinen_ajo_ei_koske_drop_iniin(kone: Kone):
    assert kone.taysi().returncode == 0
    kone.lisa.write_text("[Service]\nSupplementaryGroups=aiops-ceo muu\n", encoding="utf-8")
    assert kone.taysi().returncode == 0
    assert kone.lisa.read_text(encoding="utf-8") == "[Service]\nSupplementaryGroups=aiops-ceo muu\n"
    assert kone.unit.read_text(encoding="utf-8") == kone.repon_unit


def test_ilman_lisaryhmaa_ei_synny_drop_inia(tmp_path: Path):
    kone = Kone(tmp_path, lisaryhma=False)
    assert kone.taysi().returncode == 0
    assert not kone.lisa.parent.exists()
    assert kone.unit.read_text(encoding="utf-8") == kone.repon_unit


def test_pysaytetty_palvelu_jaa_pysaytetyksi(tmp_path: Path):
    kone = Kone(tmp_path, kaynnissa=False)
    tulos = kone.taysi()
    assert tulos.returncode == 0, tulos.stderr
    assert not kone.kaynnissa and "jää pysäytetyksi" in tulos.stdout
    assert not any(r.split()[1] in ("stop", "start") for r in kone.kutsut("systemctl"))
    assert (kone.kohde / "palvelin" / "uusi").exists()


@pytest.mark.parametrize("vika", ["UV_PETTAA", "UUSI_EI_KAYNNISTY"])
def test_virhe_palvelimen_vaihdossa_palauttaa_edellisen_version(kone: Kone, vika: str):
    tulos = kone.taysi(**{vika: "1"})
    assert tulos.returncode != 0
    assert "Palautetaan edellinen versio" in tulos.stderr and "käynnistetty" in tulos.stderr
    kone.ennallaan()
    assert kone.versio == "vanha"  # edellinen versio pyörii taas
    assert kone.kutsut("systemctl")[-1] == "systemctl start ravintopolku.service"


@pytest.mark.parametrize("merkki", [signal.SIGINT, signal.SIGHUP, signal.SIGTERM])
def test_keskeytys_uuden_version_jo_kaynnistyttya_palauttaa_ja_kaynnistaa_vanhan(kone: Kone, tmp_path: Path, merkki):
    # Ctrl-C tai katkennut SSH-yhteys terveystarkistuksen aikana: uusi prosessi pyörii jo. Paluun pitää pysäyttää se,
    # sillä käynnissä olevalle palvelulle pelkkä start ei tee mitään ja uusi versio jäisi ajoon vanhojen tiedostojen päälle.
    virheet = tmp_path / "virheet"
    ajo = kone.kaynnista(virheet, OIKEA_UNI="1")
    kone.odota(lambda: kone.versio == "uusi", "uusi versio käynnistyi")
    os.killpg(ajo.pid, merkki)
    assert ajo.wait(timeout=30) == 130
    assert "Palautetaan edellinen versio" in virheet.read_text()
    kone.ennallaan()
    assert kone.versio == "vanha"
    toimet = [r.split()[1] for r in kone.kutsut("systemctl") if r.split()[1] in ("stop", "start")]
    assert toimet == ["stop", "start", "stop", "start"]


def test_toinen_keskeytys_ei_katkaise_palautusta(kone: Kone, tmp_path: Path):
    virheet = tmp_path / "virheet"
    ajo = kone.kaynnista(virheet, HIDAS_UV="5", HIDAS_KAYNNISTYS="1")
    kone.odota(lambda: bool(kone.kutsut("uv")), "palvelimen asennus alkoi")
    os.killpg(ajo.pid, signal.SIGINT)
    kone.odota(lambda: "Palautetaan" in virheet.read_text(), "palautus alkoi")
    os.killpg(ajo.pid, signal.SIGINT)  # kärsimätön toinen Ctrl-C kesken palautuksen
    assert ajo.wait(timeout=30) == 130
    kone.ennallaan()
    assert kone.versio == "vanha" and "käynnistetty" in virheet.read_text()


@pytest.mark.parametrize("jaanne", ["palvelin.vanha", "dist.vanha"])
@pytest.mark.parametrize("args", [("UV",), ("--vain-sovellus",)])
def test_kesken_jaaneen_ajon_varakopiota_ei_poisteta(kone: Kone, jaanne: str, args: tuple[str, ...]):
    (kone.kohde / jaanne).mkdir()
    (kone.kohde / jaanne / "ainoa-ehja-kopio").write_text("x")
    tulos = kone.aja(*[str(kone.bin / "uv") if a == "UV" else a for a in args])
    assert tulos.returncode == 1 and "jäi kesken" in tulos.stderr and "Mitään ei muutettu" in tulos.stderr
    assert (kone.kohde / jaanne / "ainoa-ehja-kopio").exists()
    assert (kone.kohde / "dist" / "index.html").read_text() == "vanha\n"
    assert (kone.kohde / "palvelin" / "vanha").exists()
    assert kone.versio == "vanha" and kone.kutsut("docker") == [] and kone.kutsut("systemctl") == []


def test_pettavat_testit_eivat_muuta_mitaan(kone: Kone):
    tulos = kone.taysi(TESTIT_PETTAVAT="1")
    assert tulos.returncode != 0
    kone.ennallaan()
    assert kone.kaynnissa and kone.kutsut("systemctl") == [] and kone.kutsut("uv") == []
    assert "Palautetaan" not in tulos.stderr


def test_puuttuva_python_pysayttaa_ennen_muutoksia(tmp_path: Path):
    kone = Kone(tmp_path, python=False)
    tulos = kone.taysi()
    assert tulos.returncode == 1 and "python3.14" in tulos.stderr and "Mitään ei muutettu" in tulos.stderr
    kone.ennallaan()
    assert kone.kaynnissa and kone.kutsut("docker") == [] and kone.kutsut("systemctl") == []


def test_vain_sovellus_ei_koske_palvelimeen(tmp_path: Path):
    kone = Kone(tmp_path, python=False)  # pelkkä sovellus ei tarvitse Pythonia eikä uv:ta
    tulos = kone.aja("--vain-sovellus")
    assert tulos.returncode == 0, tulos.stderr
    assert (kone.kohde / "dist" / "index.html").read_text() == "uusi\n"
    assert (kone.kohde / "palvelin" / "vanha").exists()
    assert kone.unit.read_text(encoding="utf-8") == kone.vanha_unit and not kone.lisa.parent.exists()
    assert not (kone.kohde / "DEPLOYED").read_text().startswith("vanha ")
    assert kone.kutsut("systemctl") == [] and kone.kutsut("uv") == [] and kone.kaynnissa
    assert sorted(p.name for p in kone.kohde.iterdir()) == ["DEPLOYED", "dist", "palvelin"]


def _asennettu_commit(kone: Kone) -> str:
    """Merkitsee edellisen asennuksen tehdyksi repon nykyisestä commitista, kuten oikea DEPLOYED."""
    commit = subprocess.run(["git", "-C", str(kone.repo), "rev-parse", "--short", "HEAD"], check=True,
                            capture_output=True, text=True).stdout.strip()
    (kone.kohde / "DEPLOYED").write_text(f"{commit} 2026-11-24T00:22:00+02:00\n")
    return commit


def _commitoi(kone: Kone, polku: str, sisalto: str) -> None:
    tiedosto = kone.repo / polku
    tiedosto.parent.mkdir(parents=True, exist_ok=True)
    tiedosto.write_text(sisalto)
    kone.git("add", "-A")
    kone.git("-c", "user.name=testi", "-c", "user.email=testi@example.invalid", "commit", "-q", "-m", "muutos")


@pytest.mark.parametrize("polku", ["palvelin/src/koodi.py", "palvelin/src/uusi/moduuli.py", "palvelin/uv.lock"])
def test_vain_sovellus_pysahtyy_kun_palvelin_on_muuttunut(tmp_path: Path, polku: str):
    """Sovellus ja palvelin eivät saa jäädä eri versioihin: muuttunut palvelin vaatii täyden asennuksen."""
    kone = Kone(tmp_path)
    asennettu = _asennettu_commit(kone)
    _commitoi(kone, polku, "muuttunut\n")
    tulos = kone.aja("--vain-sovellus")
    assert tulos.returncode == 1
    assert f"Palvelimen koodi on muuttunut asennetun version ({asennettu}) jälkeen" in tulos.stderr
    assert "Mitään ei muutettu" in tulos.stderr and "Aja täysi asennus" in tulos.stderr
    # mitään ei käännetty eikä vaihdettu
    assert kone.kutsut("docker") == [] and kone.kutsut("systemctl") == []
    assert (kone.kohde / "dist" / "index.html").read_text() == "vanha\n"
    assert (kone.kohde / "DEPLOYED").read_text().startswith(asennettu + " ")
    assert sorted(p.name for p in kone.kohde.iterdir()) == ["DEPLOYED", "dist", "palvelin"]
    # täysi asennus samasta commitista kelpaa
    assert kone.taysi().returncode == 0
    assert (kone.kohde / "palvelin" / "uusi").exists()


@pytest.mark.parametrize("polku", ["src/sovellus.ts", "palvelin/tests/test_x.py", "palvelin/pyproject.toml",
                                   "docs/ohje.md"])
def test_vain_sovellus_kelpaa_kun_palvelin_on_ennallaan(tmp_path: Path, polku: str):
    kone = Kone(tmp_path, python=False)
    _asennettu_commit(kone)
    _commitoi(kone, polku, "# muuttunut\n")
    tulos = kone.aja("--vain-sovellus")
    assert tulos.returncode == 0, tulos.stderr
    assert (kone.kohde / "dist" / "index.html").read_text() == "uusi\n"
    assert (kone.kohde / "palvelin" / "vanha").exists() and kone.kutsut("uv") == []


@pytest.mark.parametrize("merkinta", ["abcdef1 2026-11-24T00:22:00+02:00\n", "vanha 2026-11-24\n", "\n",
                                      "HEAD 2026-11-24\n", "--help x\n"])
def test_vain_sovellus_tuntemattomasta_asennuksesta_ei_voida_verrata(tmp_path: Path, merkinta: str):
    """DEPLOYED nimeää commitin, jota tässä repossa ei ole (tai ei commitia lainkaan): asennus etenee kuten ennen."""
    kone = Kone(tmp_path, python=False)
    _commitoi(kone, "palvelin/src/koodi.py", "muuttunut\n")
    (kone.kohde / "DEPLOYED").write_text(merkinta)
    tulos = kone.aja("--vain-sovellus")
    assert tulos.returncode == 0, tulos.stderr
    assert (kone.kohde / "dist" / "index.html").read_text() == "uusi\n"


@pytest.mark.parametrize("args, viesti", [
    ((), "Anna uv:n polku"),
    (("/olematon/uv",), "Anna uv:n polku"),
    (("--vain-sovellus", "ylimaarainen"), "Tuntematon argumentti: ylimaarainen"),
    (("UV", "ylimaarainen"), "Tuntematon argumentti: ylimaarainen"),
])
def test_vaarat_argumentit_hylataan(kone: Kone, args: tuple[str, ...], viesti: str):
    tulos = kone.aja(*[str(kone.bin / "uv") if a == "UV" else a for a in args])
    assert tulos.returncode == 1 and viesti in tulos.stderr
    kone.ennallaan()
    assert kone.kutsut("docker") == []


def test_likainen_tyopuu_pysayttaa(kone: Kone):
    (kone.repo / "uusi-tiedosto").write_text("x")
    tulos = kone.taysi()
    assert tulos.returncode == 1 and "tallentamattomia muutoksia" in tulos.stderr
    kone.ennallaan()
