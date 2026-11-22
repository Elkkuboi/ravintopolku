"""Päiväkirjan säilytys ja synkronointi (aiops ADR-0016 kohdat 1, 3 ja 4).

Palvelin antaa jokaiselle hyväksytylle muutokselle kasvavan järjestysnumeron (seq) saapumishetkellä. Laitteen kelloa ei
käytetä järjestykseen. Viimeisin palvelimelle saapunut voittaa sekä tunnisteen että luonnollisen avaimen (päivämäärä)
mukaan, ja poistot säilyvät poistomerkintöinä. Valokuvat (photos) eivät synkronoidu ensimmäisessä versiossa.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import hashlib
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
LUONNOKSIA_MAX = 100  # odottavia Ilmari-luonnoksia enintään (kuten Node-palvelimen laatikossa)
LUONNOS_PAIVAT = 7  # odottava luonnos vanhenee seitsemässä päivässä
ETONIIMI_MAX = 100
ETONIIMI_ALKU = "rp_"  # avaimen etoniimi: etoniimi ei paljasta hashia eikä tunnistaa laitetta

OLETUS_KAYTTAJA = "elias"  # olematon tai vanha kanta: koko data siirretään täälle
OLETUS_PROFIILI = "Elias"

SKEEMA = """
CREATE TABLE IF NOT EXISTS merkinnat (
  taulu TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  poistettu INTEGER NOT NULL CHECK (poistettu IN (0, 1)),
  seq INTEGER NOT NULL UNIQUE,
  saapunut TEXT NOT NULL,
  laite TEXT NOT NULL,
  kayttaja_id INTEGER REFERENCES kayttajat(id),
  profiili_id INTEGER REFERENCES profiilit(id),
  PRIMARY KEY (taulu, id),
  CHECK ((poistettu = 1 AND data IS NULL) OR (poistettu = 0 AND data IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS luonnokset (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL,
  source TEXT NOT NULL,
  data TEXT,
  saapunut TEXT NOT NULL,
  tila TEXT NOT NULL CHECK (tila IN ('pending', 'done')),
  kayttaja_id INTEGER REFERENCES kayttajat(id),
  profiili_id INTEGER REFERENCES profiilit(id),
  UNIQUE (source, external_id),
  CHECK ((tila = 'pending' AND data IS NOT NULL) OR tila = 'done')
);
CREATE TABLE IF NOT EXISTS kayttajat (
  id INTEGER PRIMARY KEY,
  nimi TEXT UNIQUE,
  luotu TEXT
);
CREATE TABLE IF NOT EXISTS api_avaimet (
  id INTEGER PRIMARY KEY,
  kayttaja_id INTEGER REFERENCES kayttajat(id),
  avain_hash TEXT,
  etoniimi TEXT,
  luotu TEXT,
  viimeisin_kaytto TEXT,
  voimassa BOOLEAN DEFAULT 1
);
CREATE TABLE IF NOT EXISTS profiilit (
  id INTEGER PRIMARY KEY,
  kayttaja_id INTEGER REFERENCES kayttajat(id),
  nimi TEXT,
  luotu TEXT,
  aktiivinen BOOLEAN DEFAULT 1,
  UNIQUE (kayttaja_id, nimi)
);
"""

# Indexit luodaan vasta migraation lopuksi: vanhan kannan tauluissa ei vielä ole omistussarakkeita.
INDEKSIT = """
CREATE INDEX IF NOT EXISTS idx_merkinnat_omistus ON merkinnat (kayttaja_id, profiili_id);
CREATE INDEX IF NOT EXISTS idx_luonnokset_omistus ON luonnokset (kayttaja_id, profiili_id);
"""


class Hylatty(ValueError):
    """Pyyntö ei kelpaa; mitään ei tallennettu."""


def _sarakkeet(yhteys: sqlite3.Connection, taulu: str) -> set[str]:
    return {rivi[1] for rivi in yhteys.execute(f"PRAGMA table_info({taulu})")}


def migraatio(yhteys: sqlite3.Connection, nyt: datetime | None = None) -> None:
    """Idempotentti monikäyttäjätuen migraatio: luo taulut kayttajat, api_avaimet ja profiilit, laajentaa
    olemassa olevat taulut (merkinnat, luonnokset) sarakkeilla kayttaja_id ja profiili_id ja siirtää
    olemassa olevan datan käyttäjälle "elias" ja profiilille "Elias" (id 1). Uusi kanta on valmis suoraan."""
    aika = (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    yhteys.executescript(SKEEMA)
    for taulu in ("merkinnat", "luonnokset"):
        nykyiset = _sarakkeet(yhteys, taulu)
        for sark, sql in (("kayttaja_id", "ALTER TABLE {t} ADD COLUMN kayttaja_id INTEGER REFERENCES kayttajat(id)"),
                          ("profiili_id", "ALTER TABLE {t} ADD COLUMN profiili_id INTEGER REFERENCES profiilit(id)")):
            if sark not in nykyiset:
                yhteys.execute(sql.format(t=taulu))
    yhteys.execute("INSERT OR IGNORE INTO kayttajat (id, nimi, luotu) VALUES (1, ?, ?)", (OLETUS_KAYTTAJA, aika))
    yhteys.execute("INSERT OR IGNORE INTO profiilit (id, kayttaja_id, nimi, luotu, aktiivinen) VALUES (1, 1, ?, ?, 1)",
                   (OLETUS_PROFIILI, aika))
    yhteys.execute("UPDATE merkinnat SET kayttaja_id = 1 WHERE kayttaja_id IS NULL")
    yhteys.execute("UPDATE merkinnat SET profiili_id = 1 WHERE profiili_id IS NULL")
    yhteys.execute("UPDATE luonnokset SET kayttaja_id = 1 WHERE kayttaja_id IS NULL")
    yhteys.execute("UPDATE luonnokset SET profiili_id = 1 WHERE profiili_id IS NULL")
    yhteys.executescript(INDEKSIT)


def avaa(polku: Path | str) -> sqlite3.Connection:
    yhteys = sqlite3.connect(str(polku), isolation_level=None, timeout=10, check_same_thread=False)
    yhteys.execute("PRAGMA journal_mode=WAL")
    yhteys.execute("PRAGMA synchronous=FULL")
    migraatio(yhteys)
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


def _omistus(kayttaja_id: object, profiili_id: object) -> tuple[int, int]:
    """Tarkistettu omistus: kokonaisluku, vähintään 1. Palautetaan (kayttaja_id, profiili_id)."""
    for arvo, nimi in ((kayttaja_id, "kayttaja_id"), (profiili_id, "profiili_id")):
        if not isinstance(arvo, int) or isinstance(arvo, bool) or arvo < 1:
            raise Hylatty(f"{nimi}: ei-negatiivinen kokonaisluku, vähintään 1")
    return kayttaja_id, profiili_id


def suurin_seq(yhteys: sqlite3.Connection, kayttaja_id: object = None, profiili_id: object = None) -> int:
    if kayttaja_id is None and profiili_id is None:
        return yhteys.execute("SELECT COALESCE(MAX(seq), 0) FROM merkinnat").fetchone()[0]
    k, p = _omistus(kayttaja_id, profiili_id)
    return yhteys.execute("SELECT COALESCE(MAX(seq), 0) FROM merkinnat WHERE kayttaja_id = ? AND profiili_id = ?",
                          (k, p)).fetchone()[0]


def sovella(yhteys: sqlite3.Connection, muutokset: object, laite: str, nyt: datetime | None = None,
            kayttaja_id: object = 1, profiili_id: object = 1) -> list[dict]:
    """Tallentaa muutokset saapumisjärjestyksessä käyttäjän ja profiilin nimissä. Kaikki tai ei mitään:
    yksikin kelvoton muutos hylkää pyynnön. Järjestysnumerot ja luonnollisten avainten päällekkäisyys
    on omistakohtainen: eri käyttäjät tai profiilit eivät poista toistensa merkintöjä."""
    if not isinstance(muutokset, list) or len(muutokset) > MUUTOKSIA_MAX:
        raise Hylatty(f"muutokset: lista, enintään {MUUTOKSIA_MAX}")
    k, p = _omistus(kayttaja_id, profiili_id)
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
                    "SELECT id FROM merkinnat WHERE taulu = ? AND poistettu = 0 AND id <> ? AND kayttaja_id = ? "
                    "AND profiili_id = ? AND json_extract(data, ?) = ?",
                    (taulu, tunniste, k, p, f"$.{avain}", arvo)).fetchall()
                for (vanha,) in vanhat:  # sama päivä toisella tunnisteella: viimeisin saapunut voittaa
                    yhteys.execute(
                        "UPDATE merkinnat SET data = NULL, poistettu = 1, seq = ?, saapunut = ?, laite = ? "
                        "WHERE taulu = ? AND id = ?", (_seuraava(yhteys), aika, laite, taulu, vanha))
            seq = _seuraava(yhteys)
            yhteys.execute(
                "INSERT INTO merkinnat (taulu, id, data, poistettu, seq, saapunut, laite, kayttaja_id, profiili_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (taulu, id) DO UPDATE SET data = excluded.data, poistettu = excluded.poistettu, "
                "seq = excluded.seq, saapunut = excluded.saapunut, laite = excluded.laite, "
                "kayttaja_id = excluded.kayttaja_id, profiili_id = excluded.profiili_id",
                (taulu, tunniste, teksti, int(poistettu), seq, aika, laite, k, p))
            kuitatut.append({"taulu": taulu, "id": tunniste, "seq": seq})
        yhteys.execute("COMMIT")
    except BaseException:
        yhteys.execute("ROLLBACK")
        raise
    return kuitatut


def hae(yhteys: sqlite3.Connection, jalkeen: object, raja: int = HAKU_MAX,
        kayttaja_id: object = None, profiili_id: object = None) -> tuple[list[dict], bool]:
    """Palauttaa merkinnät omistajakohtain: parametrit kayttaja_id ja profiili_id filtteröivät niiden
    mukaan; molemmat puuttuessa luetaan koko kanta (huolto- ja vientikäyttö)."""
    if not isinstance(jalkeen, int) or isinstance(jalkeen, bool) or jalkeen < 0:
        raise Hylatty("jalkeen: ei-negatiivinen kokonaisluku")
    ehdot, parametrit = [], []
    if kayttaja_id is not None or profiili_id is not None:
        k, p = _omistus(kayttaja_id, profiili_id)
        ehdot += ["kayttaja_id = ?", "profiili_id = ?"]
        parametrit += [k, p]
    ehdot += ["seq > ?"]
    parametrit.append(jalkeen)
    rivit = yhteys.execute(
        f"SELECT seq, taulu, id, data, poistettu FROM merkinnat WHERE {' AND '.join(ehdot)} "
        "ORDER BY seq LIMIT ?", parametrit + [raja + 1]).fetchall()
    muutokset = [{"seq": s, "taulu": t, "id": i, "data": json.loads(d) if d is not None else None,
                  "poistettu": bool(p)} for s, t, i, d, p in rivit[:raja]]
    return muutokset, len(rivit) > raja


def tilasto(yhteys: sqlite3.Connection, kayttaja_id: object = None, profiili_id: object = None) -> dict:
    """Synkronointitila omistajakohtain; omistaja puuttuessa koko kanta."""
    ehdot, parametrit = [], []
    if kayttaja_id is not None or profiili_id is not None:
        k, p = _omistus(kayttaja_id, profiili_id)
        ehdot += ["kayttaja_id = ?", "profiili_id = ?"]
        parametrit += [k, p]
    ehdoissa = ["poistettu = ?"] + ehdot
    pohja = f"SELECT COUNT(*) FROM merkinnat WHERE {' AND '.join(ehdoissa)}"
    elavat = yhteys.execute(pohja, [0] + parametrit).fetchone()[0]
    poistot = yhteys.execute(pohja, [1] + parametrit).fetchone()[0]
    return {"seq": suurin_seq(yhteys, kayttaja_id, profiili_id), "merkintoja": elavat, "poistomerkintoja": poistot}


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


def vie(yhteys: sqlite3.Connection, kohde: Path, nyt: datetime | None = None,
        kayttaja_id: object = None, profiili_id: object = None) -> None:
    """Nykytila ilman poistomerkintöjä julkiseen datahakemistoon (ADR-0016 kohta 4), atominen
    uudelleennimeäminen; omistaja puuttuessa vie koko kanta (huoltokäyttö)."""
    ehdot, parametrit = [], []
    if kayttaja_id is not None or profiili_id is not None:
        k, p = _omistus(kayttaja_id, profiili_id)
        ehdot += ["kayttaja_id = ?", "profiili_id = ?"]
        parametrit += [k, p]
    ehdot.append("poistettu = 0")
    taulut: dict[str, list] = {t: [] for t in sorted(TAULUT)}
    for taulu, data in yhteys.execute(
            f"SELECT taulu, data FROM merkinnat WHERE {' AND '.join(ehdot)} ORDER BY taulu, id", parametrit):
        taulut[taulu].append(json.loads(data))
    sisalto = {"versio": VIENTI_VERSIO,
               "paivitetty": (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
               "seq": suurin_seq(yhteys, kayttaja_id, profiili_id), "taulut": taulut}
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


def _luonnos_ehdot(kayttaja_id: object, profiili_id: object) -> tuple[list[str], list]:
    if kayttaja_id is None and profiili_id is None:
        return [], []
    k, p = _omistus(kayttaja_id, profiili_id)
    return ["kayttaja_id = ?", "profiili_id = ?"], [k, p]


def luonnos_lisaa(yhteys: sqlite3.Connection, kuori: dict, nyt: datetime | None = None,
                  kayttaja_id: object = 1, profiili_id: object = 1) -> int | None:
    """Tallentaa Ilmarin tuloskuoren odottavaksi luonnokseksi (aiops ADR-0026) käyttäjän ja profiilin
    nimissä. Sama source + externalId otetaan vastaan vain kerran: toistosta palautetaan None, eikä
    mitään tallenneta. Korjattu tulos tarvitsee uuden tunnisteen."""
    k, p = _omistus(kayttaja_id, profiili_id)
    aika = (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    teksti = json.dumps(kuori, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    kursori = yhteys.execute(
        "INSERT INTO luonnokset (external_id, source, data, saapunut, tila, kayttaja_id, profiili_id) "
        "VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT (source, external_id) DO NOTHING",
        (kuori["externalId"], kuori["source"], teksti, aika, k, p))
    return kursori.lastrowid if kursori.rowcount == 1 else None


def luonnos_on_vastaanotettu(yhteys: sqlite3.Connection, source: str, external_id: str,
                             kayttaja_id: object = 1, profiili_id: object = 1) -> bool:
    ehdot, parametrit = _luonnos_ehdot(kayttaja_id, profiili_id)
    ehdot += ["source = ?", "external_id = ?"]
    parametrit += [source, external_id]
    return yhteys.execute(
        f"SELECT 1 FROM luonnokset WHERE {' AND '.join(ehdot)}", parametrit).fetchone() is not None


def luonnoksia_odottaa(yhteys: sqlite3.Connection, kayttaja_id: object = None, profiili_id: object = None) -> int:
    """Odottavien luonnosten lukumäärä; omistaja puuttuessa huoltolaskuri (koko laatikko)."""
    ehdot, parametrit = _luonnos_ehdot(kayttaja_id, profiili_id)
    ehdot.append("tila = 'pending'")
    return yhteys.execute(f"SELECT COUNT(*) FROM luonnokset WHERE {' AND '.join(ehdot)}",
                          parametrit).fetchone()[0]


def luonnokset_odottavat(yhteys: sqlite3.Connection, kayttaja_id: object = None,
                         profiili_id: object = None) -> list[dict]:
    """Omistajan odottavat luonnokset uusin ensin: id, externalId, source, saapunut ja itse luonnos
    (ei koko kuorta); omistaja puuttuessa koko laatikko (huolto)."""
    ehdot, parametrit = _luonnos_ehdot(kayttaja_id, profiili_id)
    ehdot.append("tila = 'pending'")
    rivit = yhteys.execute(
        f"SELECT id, external_id, source, saapunut, data FROM luonnokset WHERE {' AND '.join(ehdot)} "
        "ORDER BY id DESC", parametrit).fetchall()
    return [{"id": i, "externalId": e, "source": s, "saapunut": a, "draft": json.loads(d)["draft"]}
            for i, e, s, a, d in rivit]


def luonnos_valmis(yhteys: sqlite3.Connection, tunniste: int) -> bool:
    """Merkitsee luonnoksen käsitellyksi ja poistaa sen sisällön; tunniste jää toistojen torjuntaan."""
    kursori = yhteys.execute("UPDATE luonnokset SET tila = 'done', data = NULL WHERE id = ? AND tila = 'pending'",
                             (tunniste,))
    return kursori.rowcount == 1


def luonnokset_vanhenna(yhteys: sqlite3.Connection, nyt: datetime | None = None,
                        kayttaja_id: object = None, profiili_id: object = None) -> int:
    """Seitsemän päivää odottaneet luonnokset merkitään käsitellyiksi ja niiden sisältö poistetaan;
    omistaja puuttuessa koko laatikko (huolto)."""
    ehdot, parametrit = _luonnos_ehdot(kayttaja_id, profiili_id)
    ehdot += ["tila = 'pending'", "saapunut < ?"]
    parametrit.append(((nyt or datetime.now(timezone.utc)) - timedelta(days=LUONNOS_PAIVAT)).isoformat(timespec="seconds"))
    return yhteys.execute(f"UPDATE luonnokset SET tila = 'done', data = NULL WHERE {' AND '.join(ehdot)}",
                          parametrit).rowcount


def kayttaja_lisaa(yhteys: sqlite3.Connection, nimi: str, nyt: datetime | None = None) -> int:
    """Lisää käyttäjän; samannimisen käyttäjän toistosta palautetaan sen id eikä mitään tallenneta."""
    if not isinstance(nimi, str) or not 1 <= len(nimi) <= ID_MAX:
        raise Hylatty("nimi: merkkijono, 1–100 merkkiä")
    aika = (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    kursori = yhteys.execute("INSERT OR IGNORE INTO kayttajat (nimi, luotu) VALUES (?, ?)", (nimi, aika))
    if kursori.rowcount == 1:
        return kursori.lastrowid
    return yhteys.execute("SELECT id FROM kayttajat WHERE nimi = ?", (nimi,)).fetchone()[0]


def profiili_lisaa(yhteys: sqlite3.Connection, kayttaja_id: object, nimi: str, nyt: datetime | None = None) -> int:
    """Lisää profiilin käyttäjälle; olemassa oleva samanniminen profiili palautuu eikä luoda uutta."""
    k, _ = _omistus(kayttaja_id, 1)
    if not isinstance(nimi, str) or not 1 <= len(nimi) <= ID_MAX:
        raise Hylatty("nimi: merkkijono, 1–100 merkkiä")
    if not yhteys.execute("SELECT 1 FROM kayttajat WHERE id = ?", (k,)).fetchone():
        raise Hylatty("kayttaja_id: käyttäjää ei ole olemassa")
    aika = (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    kursori = yhteys.execute(
        "INSERT OR IGNORE INTO profiilit (kayttaja_id, nimi, luotu, aktiivinen) VALUES (?, ?, ?, 1)", (k, nimi, aika))
    if kursori.rowcount == 1:
        return kursori.lastrowid
    return yhteys.execute("SELECT id FROM profiilit WHERE kayttaja_id = ? AND nimi = ?", (k, nimi)).fetchone()[0]


def avain_luotu_hash(avain: str) -> str:
    """Avaimen sha256-hash: kantaan tallennetaan vain hash, ei avain itse."""
    if not isinstance(avain, str) or not 16 <= len(avain) <= 256:
        raise Hylatty("avain: merkkijono, 16–256 merkkiä")
    return hashlib.sha256(avain.encode("utf-8")).hexdigest()


def avain_lisaa(yhteys: sqlite3.Connection, kayttaja_id: object, avain: str, etoniimi: str,
                nyt: datetime | None = None) -> int:
    """Luo API-avaimen: kantaan tallennetaan vain sha256-hash ja lyhyt etoniimi, ei itse avain."""
    k, _ = _omistus(kayttaja_id, 1)
    if not yhteys.execute("SELECT 1 FROM kayttajat WHERE id = ?", (k,)).fetchone():
        raise Hylatty("kayttaja_id: käyttäjää ei ole olemassa")
    if not isinstance(etoniimi, str) or not 1 <= len(etoniimi) <= ETONIIMI_MAX:
        raise Hylatty("etoniimi: merkkijono, 1–100 merkkiä")
    aika = (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    kursori = yhteys.execute(
        "INSERT INTO api_avaimet (kayttaja_id, avain_hash, etoniimi, luotu, voimassa) VALUES (?, ?, ?, ?, 1)",
        (k, avain_luotu_hash(avain), etoniimi, aika))
    return kursori.lastrowid


def avain_vastaanota(yhteys: sqlite3.Connection, avain: str, nyt: datetime | None = None) -> int | None:
    """Tunnistaa API-avaimen hashin perusteella ja päivittää viimeisimmän käytön; palauttaa käyttäjän id,
    tuntemattomasta tai kielletystä avaimesta None."""
    aika = (nyt or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    kursori = yhteys.execute(
        "UPDATE api_avaimet SET viimeisin_kaytto = ? WHERE avain_hash = ? AND voimassa = 1",
        (aika, avain_luotu_hash(avain)))
    if kursori.rowcount != 1:
        return None
    return yhteys.execute("SELECT kayttaja_id FROM api_avaimet WHERE avain_hash = ?",
                          (avain_luotu_hash(avain),)).fetchone()[0]


def avaimet_listaa(yhteys: sqlite3.Connection, kayttaja_id: object) -> list[dict]:
    """Käyttäjän API-avaimet id:n mukaisessa järjestyksessä: id, etoniimi, luotu, viimeisinKaytto, voimassa."""
    k, _ = _omistus(kayttaja_id, 1)
    rivit = yhteys.execute("SELECT id, etoniimi, luotu, viimeisin_kaytto, voimassa "
                           "FROM api_avaimet WHERE kayttaja_id = ? ORDER BY id", (k,)).fetchall()
    return [{"id": i, "etoniimi": e, "luotu": l, "viimeisinKaytto": v, "voimassa": bool(f)}
            for i, e, l, v, f in rivit]


def avain_kielta(yhteys: sqlite3.Connection, tunniste: int, kayttaja_id: object) -> bool:
    """Kieltää käyttäjän API-avaimen; kielto on peruuttamaton tässä versiossa."""
    k, _ = _omistus(kayttaja_id, 1)
    kursori = yhteys.execute("UPDATE api_avaimet SET voimassa = 0 WHERE id = ? AND kayttaja_id = ? AND voimassa = 1",
                             (tunniste, k))
    return kursori.rowcount == 1
