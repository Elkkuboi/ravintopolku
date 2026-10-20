"""Päiväkirjan säilytys ja synkronointi (aiops ADR-0016 kohdat 1, 3 ja 4).

Palvelin antaa jokaiselle hyväksytylle muutokselle kasvavan järjestysnumeron (seq) saapumishetkellä. Laitteen kelloa ei
käytetä järjestykseen. Viimeisin palvelimelle saapunut voittaa sekä tunnisteen että luonnollisen avaimen (päivämäärä)
mukaan, ja poistot säilyvät poistomerkintöinä. Valokuvat (photos) eivät synkronoidu ensimmäisessä versiossa.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3

TAULUT = frozenset({"profiles", "goals", "foods", "meals", "templates", "weights", "lifestyles", "days", "settings"})
LUONNOLLISET_AVAIMET = {"goals": "effectiveDate", "weights": "date", "lifestyles": "date", "days": "date"}
ID_MAX = 100
MERKINTA_MAX = 64 * 1024
MUUTOKSIA_MAX = 500
HAKU_MAX = 500
VARMISTUS_PAIVAT = 30
VIENTI_VERSIO = "ravintopolku-paivakirja-v1"

SKEEMA = """
CREATE TABLE IF NOT EXISTS merkinnat (
  taulu TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  poistettu INTEGER NOT NULL CHECK (poistettu IN (0, 1)),
  seq INTEGER NOT NULL UNIQUE,
  saapunut TEXT NOT NULL,
  laite TEXT NOT NULL,
  PRIMARY KEY (taulu, id),
  CHECK ((poistettu = 1 AND data IS NULL) OR (poistettu = 0 AND data IS NOT NULL))
);
"""


class Hylatty(ValueError):
    """Pyyntö ei kelpaa; mitään ei tallennettu."""


def avaa(polku: Path | str) -> sqlite3.Connection:
    yhteys = sqlite3.connect(str(polku), isolation_level=None, timeout=10, check_same_thread=False)
    yhteys.execute("PRAGMA journal_mode=WAL")
    yhteys.execute("PRAGMA synchronous=FULL")
    yhteys.executescript(SKEEMA)
    return yhteys


def tarkista(muutos: object) -> tuple[str, str, str | None, bool]:
    if not isinstance(muutos, dict) or set(muutos) - {"taulu", "id", "data", "poistettu"}:
        raise Hylatty("muutos: olio, jossa vain taulu, id, data ja poistettu")
    taulu, tunniste, poistettu = muutos.get("taulu"), muutos.get("id"), muutos.get("poistettu", False)
    if taulu not in TAULUT:
        raise Hylatty(f"tuntematon taulu: {taulu!r}")
    if not isinstance(tunniste, str) or not 1 <= len(tunniste) <= ID_MAX:
        raise Hylatty("id: merkkijono, 1–100 merkkiä")
    if not isinstance(poistettu, bool):
        raise Hylatty("poistettu: totuusarvo")
    if poistettu:
        if muutos.get("data") is not None:
            raise Hylatty("poistetulla merkinnällä ei ole dataa")
        return taulu, tunniste, None, True
    data = muutos.get("data")
    if not isinstance(data, dict) or data.get("id") != tunniste:
        raise Hylatty("data: olio, jonka id on sama kuin muutoksen")
    avain = LUONNOLLISET_AVAIMET.get(taulu)
    if avain and not isinstance(data.get(avain), str):
        raise Hylatty(f"{taulu}: kenttä {avain} puuttuu")
    teksti = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if len(teksti.encode("utf-8")) > MERKINTA_MAX:
        raise Hylatty("merkintä on yli 64 KiB")
    return taulu, tunniste, teksti, False


def _seuraava(yhteys: sqlite3.Connection) -> int:
    return yhteys.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM merkinnat").fetchone()[0]


def suurin_seq(yhteys: sqlite3.Connection) -> int:
    return yhteys.execute("SELECT COALESCE(MAX(seq), 0) FROM merkinnat").fetchone()[0]


def sovella(yhteys: sqlite3.Connection, muutokset: object, laite: str, nyt: datetime | None = None) -> list[dict]:
    """Tallentaa muutokset saapumisjärjestyksessä. Kaikki tai ei mitään: yksikin kelvoton muutos hylkää pyynnön."""
    if not isinstance(muutokset, list) or len(muutokset) > MUUTOKSIA_MAX:
        raise Hylatty(f"muutokset: lista, enintään {MUUTOKSIA_MAX}")
    tarkistetut = [tarkista(m) for m in muutokset]
    aika = (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    kuitatut: list[dict] = []
    yhteys.execute("BEGIN IMMEDIATE")
    try:
        for taulu, tunniste, teksti, poistettu in tarkistetut:
            avain = LUONNOLLISET_AVAIMET.get(taulu)
            if not poistettu and avain:
                arvo = json.loads(teksti)[avain]
                vanhat = yhteys.execute(
                    "SELECT id FROM merkinnat WHERE taulu = ? AND poistettu = 0 AND id <> ? AND json_extract(data, ?) = ?",
                    (taulu, tunniste, f"$.{avain}", arvo)).fetchall()
                for (vanha,) in vanhat:  # sama päivä toisella tunnisteella: viimeisin saapunut voittaa
                    yhteys.execute(
                        "UPDATE merkinnat SET data = NULL, poistettu = 1, seq = ?, saapunut = ?, laite = ? "
                        "WHERE taulu = ? AND id = ?", (_seuraava(yhteys), aika, laite, taulu, vanha))
            seq = _seuraava(yhteys)
            yhteys.execute(
                "INSERT INTO merkinnat (taulu, id, data, poistettu, seq, saapunut, laite) VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (taulu, id) DO UPDATE SET data = excluded.data, poistettu = excluded.poistettu, "
                "seq = excluded.seq, saapunut = excluded.saapunut, laite = excluded.laite",
                (taulu, tunniste, teksti, int(poistettu), seq, aika, laite))
            kuitatut.append({"taulu": taulu, "id": tunniste, "seq": seq})
        yhteys.execute("COMMIT")
    except BaseException:
        yhteys.execute("ROLLBACK")
        raise
    return kuitatut


def hae(yhteys: sqlite3.Connection, jalkeen: object, raja: int = HAKU_MAX) -> tuple[list[dict], bool]:
    if not isinstance(jalkeen, int) or isinstance(jalkeen, bool) or jalkeen < 0:
        raise Hylatty("jalkeen: ei-negatiivinen kokonaisluku")
    rivit = yhteys.execute(
        "SELECT seq, taulu, id, data, poistettu FROM merkinnat WHERE seq > ? ORDER BY seq LIMIT ?",
        (jalkeen, raja + 1)).fetchall()
    muutokset = [{"seq": s, "taulu": t, "id": i, "data": json.loads(d) if d is not None else None,
                  "poistettu": bool(p)} for s, t, i, d, p in rivit[:raja]]
    return muutokset, len(rivit) > raja


def tilasto(yhteys: sqlite3.Connection) -> dict:
    elavat = yhteys.execute("SELECT COUNT(*) FROM merkinnat WHERE poistettu = 0").fetchone()[0]
    poistot = yhteys.execute("SELECT COUNT(*) FROM merkinnat WHERE poistettu = 1").fetchone()[0]
    return {"seq": suurin_seq(yhteys), "merkintoja": elavat, "poistomerkintoja": poistot}


def varmista(yhteys: sqlite3.Connection, hakemisto: Path, tanaan: date | None = None) -> Path | None:
    """Päivittäinen SQLite backup API -kopio eheystarkistuksella; säilytetään 30 päivää (tämä ja 29 edellistä)."""
    paiva = tanaan or datetime.now().date()
    kohde = hakemisto / f"paivakirja-{paiva.isoformat()}.sqlite"
    luotu = None
    if not kohde.exists():
        valiaikainen = hakemisto / f".{kohde.name}.tmp"
        valiaikainen.unlink(missing_ok=True)
        kopio = sqlite3.connect(str(valiaikainen))
        try:
            yhteys.backup(kopio)
            tulos = kopio.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            kopio.close()
        if tulos != "ok":
            valiaikainen.unlink(missing_ok=True)
            raise RuntimeError(f"varmistuksen eheystarkistus: {tulos}")
        os.chmod(valiaikainen, 0o600)
        os.replace(valiaikainen, kohde)
        luotu = kohde
    vanhin = paiva - timedelta(days=VARMISTUS_PAIVAT - 1)
    for polku in hakemisto.glob("paivakirja-*.sqlite"):
        try:
            paivays = date.fromisoformat(polku.stem.removeprefix("paivakirja-"))
        except ValueError:
            continue
        if paivays < vanhin:
            polku.unlink()
    return luotu


def vie(yhteys: sqlite3.Connection, kohde: Path, nyt: datetime | None = None) -> None:
    """Nykytila ilman poistomerkintöjä julkiseen datahakemistoon (ADR-0016 kohta 4), atominen uudelleennimeäminen."""
    taulut: dict[str, list] = {t: [] for t in sorted(TAULUT)}
    for taulu, data in yhteys.execute("SELECT taulu, data FROM merkinnat WHERE poistettu = 0 ORDER BY taulu, id"):
        taulut[taulu].append(json.loads(data))
    sisalto = {"versio": VIENTI_VERSIO,
               "paivitetty": (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
               "seq": suurin_seq(yhteys), "taulut": taulut}
    data = (json.dumps(sisalto, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    valiaikainen = kohde.with_name(f".{kohde.name}.tmp")
    fd = os.open(valiaikainen, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o640)
    try:
        jaljella = memoryview(data)
        while jaljella:
            jaljella = jaljella[os.write(fd, jaljella):]
        os.fchmod(fd, 0o640)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(valiaikainen, kohde)
