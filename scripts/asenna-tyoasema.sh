#!/usr/bin/env bash
# =====================================================================
# asenna-tyoasema.sh: kääntää Ravintopolun päiväkirjan kertakäyttöisissä konteissa, asentaa staattiset tiedostot
# hakemistoon /opt/ravintopolku/dist (aiops ADR-0014) ja synkronointipalvelimen hakemistoon /opt/ravintopolku/palvelin
# sekä palvelutiedoston ravintopolku.service (aiops ADR-0016, R2). Nimi on historiaa: palvelu pyörii Louhilla
# (24.11.2026 alkaen), ja skripti asentaa sille koneelle, jolla se ajetaan.
#
# Käyttö repon juuresta:   sudo scripts/asenna-tyoasema.sh UV_POLKU        (Louhilla /opt/louhi-ravintopolku-runtime/uv)
#                          sudo scripts/asenna-tyoasema.sh --vain-sovellus
#
#   --vain-sovellus: kääntää ja testaa kuten aina, mutta vaihtaa vain hakemiston dist/ ja tiedoston DEPLOYED. Palvelinta,
#   palvelutiedostoa eikä asetuksia kosketa, eikä palvelua pysäytetä (palvelin lukee dist/:n jokaisella pyynnöllä).
#
#   - Vain commitoitu koodi (git archive HEAD). Likainen työpuu pysäyttää asennuksen.
#   - Kolme konttiajoa samasta tiivisteellä kiinnitetystä Node-imagesta, käyttäjänä 1000, ilman oikeuksia
#     (--cap-drop ALL, no-new-privileges, vain luku -juuri, muisti- ja prosessiraja):
#       1) npm ci --ignore-scripts verkon kanssa: vain lukitut riippuvuudet, ei asennusskriptejä,
#       2) npm test ilman verkkoa,
#       3) npm run build ilman verkkoa (tyyppitarkistus ja Vite-käännös).
#   - Tulos: vain dist/ hakemistoon /opt/ravintopolku/dist (root, 0755/0644) ja tiedosto DEPLOYED.
#   - Palvelin: vain commitoitu koodi, uv sync --frozen --no-dev koneen omalla Pythonilla /usr/bin/python3.14 (uv ei
#     lataa Pythonia: ladattu tulkki ei läpäissyt Louhilla palvelun kovennusta). Root omistaa koodin, palvelukäyttäjä
#     on ravintopolku. Käynnissä ollut palvelu pysäytetään vaihdon ajaksi ja käynnistetään sen jälkeen; pysäytettyä
#     ei käynnistetä.
#   - Kaikki tai ei mitään: jos mikään vaihe pettää sen jälkeen, kun ensimmäinen tiedosto on vaihdettu, edellinen
#     sovellus, palvelin, palvelutiedosto ja DEPLOYED palautetaan ja käynnissä ollut palvelu käynnistetään uudelleen.
#     Puuttuva Python tai uv pysäyttää asennuksen ennen kuin mihinkään kosketaan.
#   - Isännän oma lisäryhmä säilyy: jos asennetussa palvelutiedostossa on SupplementaryGroups-rivi, jota repon
#     tiedostossa ei ole, se siirretään kerran tiedostoon ravintopolku.service.d/isanta.conf, johon skripti ei sen
#     jälkeen koske. Louhilla rivi on SupplementaryGroups=aiops-ceo: välittäjän sokettihakemisto on siellä 0750
#     ryhmälle aiops-ceo, ja ilman riviä kuvasta ateria ei toimi.
#   - Skripti ei luo käyttäjää, hakemistoja, konfiguraatiota eikä Serve-ohjausta: ne ovat isäntämuutoksia
#     (aiops-repon muutosloki). Yksi poikkeus (31.10.2026): jos aiops-välittäjän soketti on olemassa eikä
#     /etc/ravintopolku/palvelin.toml vielä kerro sitä, [palvelin]-tauluun lisätään rivi
#     valittaja = "/run/aiops-valittaja/valittaja.sock" (kuvasta ateria, aiops ADR-0025/-0027). Rivi lisätään vain
#     kerran, kaikki tai ei mitään (TOML jäsennetään ennen tallennusta); peruminen: poista rivi ja käynnistä palvelu.
#   - Testit: palvelin/tests/test_asennus.py ajaa tämän skriptin väliaikaisessa juuressa (onnistunut asennus, paluu
#     virheestä, --vain-sovellus, puuttuva Python).
# =====================================================================
set -euo pipefail

IMAGE="node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df"
# Vain testeille: etuliite kaikille isännän poluille. sudo tyhjentää ympäristön, joten oikeassa ajossa se on tyhjä.
JUURI="${RAVINTOPOLKU_ASENNUSJUURI:-}"
TARGET="$JUURI/opt/ravintopolku"
UNIT=ravintopolku.service
UNITDIR="$JUURI/etc/systemd/system"
LISA="$UNITDIR/$UNIT.d/isanta.conf"
PYTHON="$JUURI/usr/bin/python3.14"
SOKETTI="$JUURI/run/ravintopolku/palvelin.sock"
ASETUKSET="$JUURI/etc/ravintopolku/palvelin.toml"
VALITTAJA=/run/aiops-valittaja/valittaja.sock

VAIN_SOVELLUS=0
if [ "${1:-}" = "--vain-sovellus" ]; then
  VAIN_SOVELLUS=1
  shift
fi
UV="${1:-}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
GIT=(git -c "safe.directory=$REPO" -C "$REPO")

# --- Tarkistukset ennen kuin mihinkään kosketaan --------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || { echo "Aja sudolla: sudo scripts/asenna-tyoasema.sh" >&2; exit 1; }
if [ "$VAIN_SOVELLUS" -eq 1 ]; then
  [ $# -eq 0 ] || { echo "Tuntematon argumentti: $1 (--vain-sovellus ei tarvitse uv:ta)" >&2; exit 1; }
else
  [ -x "$UV" ] || { echo "Anna uv:n polku: sudo scripts/asenna-tyoasema.sh UV_POLKU" >&2; exit 1; }
  [ $# -le 1 ] || { echo "Tuntematon argumentti: $2" >&2; exit 1; }
  [ -x "$PYTHON" ] || { echo "Palvelin tarvitsee koneen oman Pythonin $PYTHON, jota ei ole. Mitään ei muutettu. Pelkkä sovellus: --vain-sovellus." >&2; exit 1; }
fi
getent passwd ravintopolku >/dev/null || { echo "Käyttäjää ravintopolku ei ole (aiops-muutosloki, vaihe R2)." >&2; exit 1; }
if [ -n "$("${GIT[@]}" status --porcelain)" ]; then
  echo "Repossa on tallentamattomia muutoksia. Commitoi ensin: asennetaan vain commitoitu koodi." >&2
  "${GIT[@]}" status --short >&2
  exit 1
fi

COMMIT="$("${GIT[@]}" rev-parse --short HEAD)"
echo "Käännetään commit $COMMIT (image $IMAGE)"

STAGE="$(mktemp -d)"
VARA="$(mktemp -d)"   # edellinen palvelutiedosto ja DEPLOYED paluuta varten, uv:n välimuisti
VAIHE=0               # 0 ei muutoksia, 1 jotain vaihdettu, 2 valmis
OLI_KAYNNISSA=0
LUOTU_LISA=0

palauta() {
  # Kesken jäänyt asennus: edellinen versio takaisin. Jokainen askel on turvallinen myös, jos vaihtoa ei ehditty tehdä.
  set +e
  echo "VIRHE: asennus keskeytyi. Palautetaan edellinen versio." >&2
  if [ -e "$TARGET/dist.vanha" ]; then rm -rf "$TARGET/dist"; mv "$TARGET/dist.vanha" "$TARGET/dist"; fi
  rm -rf "$TARGET/dist.uusi"
  if [ -e "$TARGET/palvelin.vanha" ]; then rm -rf "$TARGET/palvelin"; mv "$TARGET/palvelin.vanha" "$TARGET/palvelin"; fi
  if [ "$LUOTU_LISA" -eq 1 ]; then rm -f "$LISA"; rmdir "$UNITDIR/$UNIT.d" 2>/dev/null; fi
  if [ -f "$VARA/unit" ]; then cp -p "$VARA/unit" "$UNITDIR/$UNIT"; systemctl daemon-reload; fi
  if [ -f "$VARA/DEPLOYED" ]; then cp -p "$VARA/DEPLOYED" "$TARGET/DEPLOYED"; fi
  if [ "$OLI_KAYNNISSA" -eq 1 ]; then
    if systemctl start "$UNIT"; then
      echo "Edellinen versio on palautettu ja $UNIT käynnistetty." >&2
    else
      echo "Edellinen versio on palautettu, mutta $UNIT ei käynnistynyt: sudo journalctl -u $UNIT -n 50" >&2
    fi
  else
    echo "Edellinen versio on palautettu." >&2
  fi
}
lopuksi() {
  local koodi=$?
  [ "$VAIHE" -ne 1 ] || palauta
  rm -rf "$STAGE" "$VARA"
  exit "$koodi"
}
trap lopuksi EXIT
trap 'exit 130' INT TERM HUP   # keskeytys on tavallinen lopetus: sama paluu kuin virheessä

"${GIT[@]}" archive HEAD | tar -x -C "$STAGE"
chown -R 1000:1000 "$STAGE"

kontti() {
  local verkko="$1"
  shift
  docker run --rm --network "$verkko" --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
    --read-only --tmpfs /tmp:rw,exec,size=1g --memory 4g --pids-limit 512 \
    -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -e npm_config_update_notifier=false -e CI=1 \
    -v "$STAGE:/src" -w /src "$IMAGE" "$@"
}

echo "1/3 riippuvuudet (verkko, ei asennusskriptejä)"
kontti bridge npm ci --ignore-scripts --no-audit --no-fund
echo "2/3 testit (ei verkkoa)"
kontti none npm test
echo "3/3 käännös (ei verkkoa)"
kontti none npm run build

for f in index.html manifest.webmanifest sw.js; do
  [ -f "$STAGE/dist/$f" ] || { echo "VIRHE: käännöksestä puuttuu $f" >&2; exit 1; }
done

# --- Sovellus --------------------------------------------------------------------------------------------------
install -d -o root -g root -m 0755 "$TARGET"
rm -rf "$TARGET/dist.uusi" "$TARGET/dist.vanha" "$TARGET/palvelin.vanha"
cp -r "$STAGE/dist" "$TARGET/dist.uusi"
chown -R root:root "$TARGET/dist.uusi"
chmod -R u=rwX,go=rX "$TARGET/dist.uusi"
if [ -f "$TARGET/DEPLOYED" ]; then cp -p "$TARGET/DEPLOYED" "$VARA/DEPLOYED"; fi
VAIHE=1
if [ -d "$TARGET/dist" ]; then mv "$TARGET/dist" "$TARGET/dist.vanha"; fi
mv "$TARGET/dist.uusi" "$TARGET/dist"

merkitse_valmiiksi() {
  echo "$COMMIT $(date -Iseconds)" > "$TARGET/DEPLOYED"
  chmod 0644 "$TARGET/DEPLOYED"
}

if [ "$VAIN_SOVELLUS" -eq 1 ]; then
  merkitse_valmiiksi
  VAIHE=2
  rm -rf "$TARGET/dist.vanha"
  echo "Valmis (vain sovellus, palvelin ennallaan): $(cat "$TARGET/DEPLOYED"), $(find "$TARGET/dist" -type f | wc -l) tiedostoa hakemistossa $TARGET/dist"
  exit 0
fi

# --- Palvelin --------------------------------------------------------------------------------------------------
if systemctl is-active --quiet "$UNIT"; then
  OLI_KAYNNISSA=1
  echo "Pysäytetään $UNIT vaihdon ajaksi"
  systemctl stop "$UNIT"
fi
if [ -d "$TARGET/palvelin" ]; then mv "$TARGET/palvelin" "$TARGET/palvelin.vanha"; fi
install -d -o root -g root -m 0755 "$TARGET/palvelin"
cp -r "$STAGE/palvelin/src" "$STAGE/palvelin/pyproject.toml" "$STAGE/palvelin/uv.lock" "$STAGE/palvelin/.python-version" "$TARGET/palvelin/"
(cd "$TARGET/palvelin" && UV_PYTHON_DOWNLOADS=never UV_CACHE_DIR="$VARA/uv" \
  "$UV" sync --frozen --no-dev --no-editable --python "$PYTHON" --quiet)
chown -R root:root "$TARGET/palvelin"
chmod -R u=rwX,go=rX "$TARGET/palvelin"
(cd / && sudo -u ravintopolku "$TARGET/palvelin/.venv/bin/ravintopolku-palvelin" --help >/dev/null)
echo "OK: ravintopolku pystyy käynnistämään palvelimen"

if [ -f "$ASETUKSET" ] && [ -S "$JUURI$VALITTAJA" ] && ! grep -Eq '^[[:space:]]*valittaja[[:space:]]*=' "$ASETUKSET"; then
  if python3 - "$ASETUKSET" "$VALITTAJA" <<'PY'
import os, pathlib, sys, tomllib
polku, soketti = pathlib.Path(sys.argv[1]), sys.argv[2]
rivit = polku.read_text(encoding="utf-8").split("\n")
kohta = next((i for i, r in enumerate(rivit) if r.strip() == "[palvelin]"), None)
if kohta is None:
    sys.exit("[palvelin]-taulua ei löydy")
rivit.insert(kohta + 1, f'valittaja = "{soketti}"')
uusi = "\n".join(rivit)
tomllib.loads(uusi)  # kaikki tai ei mitään: kelvoton tulos ei korvaa tiedostoa
tila = polku.stat()
tmp = polku.with_name(polku.name + ".uusi")
tmp.write_text(uusi, encoding="utf-8")
os.chmod(tmp, tila.st_mode & 0o777)
os.chown(tmp, tila.st_uid, tila.st_gid)
tmp.replace(polku)
PY
  then
    echo "OK: $ASETUKSET sai rivin valittaja = \"$VALITTAJA\" (kuvasta ateria välittäjän kautta)"
  else
    echo "VAROITUS: valittaja-riviä ei lisätty tiedostoon $ASETUKSET; lisää se käsin [palvelin]-tauluun" >&2
  fi
fi

# --- Palvelutiedosto -------------------------------------------------------------------------------------------
if [ -f "$UNITDIR/$UNIT" ]; then
  cp -p "$UNITDIR/$UNIT" "$VARA/unit"
  RYHMAT="$(grep -E '^SupplementaryGroups=' "$UNITDIR/$UNIT" || true)"
  if [ -n "$RYHMAT" ] && [ ! -e "$LISA" ] && ! grep -Eq '^SupplementaryGroups=' "$STAGE/config/systemd/$UNIT"; then
    install -d -o root -g root -m 0755 "$UNITDIR/$UNIT.d"
    LUOTU_LISA=1
    printf '%s\n' "# Isännän oma lisäys palveluun $UNIT. scripts/asenna-tyoasema.sh siirsi rivin tähän palvelutiedostosta" \
      "# eikä koske tähän tiedostoon sen jälkeen." "[Service]" "$RYHMAT" > "$LISA"
    chmod 0644 "$LISA"
    echo "Isännän lisäryhmä säilyy tiedostossa $LISA: $RYHMAT"
  fi
fi
install -o root -g root -m 0644 "$STAGE/config/systemd/$UNIT" "$UNITDIR/$UNIT"
systemctl daemon-reload
merkitse_valmiiksi

# --- Käynnistys ja tarkistus -----------------------------------------------------------------------------------
if [ "$OLI_KAYNNISSA" -eq 1 ]; then
  systemctl start "$UNIT"
  KAYNNISSA=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 1
    if systemctl is-active --quiet "$UNIT" && [ -S "$SOKETTI" ]; then KAYNNISSA=$((KAYNNISSA + 1)); else KAYNNISSA=0; fi
    # kolme peräkkäistä sekuntia käynnissä ja soketti auki: ei heti kaatuva palvelu
    [ "$KAYNNISSA" -lt 3 ] || break
  done
  if [ "$KAYNNISSA" -lt 3 ]; then
    echo "VIRHE: $UNIT ei pysynyt käynnissä uudella versiolla: sudo journalctl -u $UNIT -n 50" >&2
    systemctl stop "$UNIT" || true
    exit 1
  fi
  echo "OK: $UNIT käynnistetty uudelleen"
else
  echo "$UNIT ei ollut käynnissä, joten se jää pysäytetyksi. Käynnistys: sudo systemctl enable --now $UNIT"
fi
VAIHE=2
rm -rf "$TARGET/dist.vanha" "$TARGET/palvelin.vanha"
echo "Valmis: $(cat "$TARGET/DEPLOYED"), $(find "$TARGET/dist" -type f | wc -l) tiedostoa hakemistossa $TARGET/dist"
