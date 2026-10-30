#!/usr/bin/env bash
# =====================================================================
# asenna-tyoasema.sh: kääntää Ravintopolun päiväkirjan kertakäyttöisissä konteissa, asentaa staattiset tiedostot
# hakemistoon /opt/ravintopolku/dist (aiops ADR-0014) ja synkronointipalvelimen hakemistoon /opt/ravintopolku/palvelin
# sekä palvelutiedoston ravintopolku.service (aiops ADR-0016, R2).
#
# Käyttö repon juuresta:   sudo scripts/asenna-tyoasema.sh "$(command -v uv)"
#
#   - Vain commitoitu koodi (git archive HEAD). Likainen työpuu pysäyttää asennuksen.
#   - Kolme konttiajoa samasta tiivisteellä kiinnitetystä Node-imagesta, käyttäjänä 1000, ilman oikeuksia
#     (--cap-drop ALL, no-new-privileges, vain luku -juuri, muisti- ja prosessiraja):
#       1) npm ci --ignore-scripts verkon kanssa: vain lukitut riippuvuudet, ei asennusskriptejä,
#       2) npm test ilman verkkoa,
#       3) npm run build ilman verkkoa (tyyppitarkistus ja Vite-käännös).
#   - Tulos: vain dist/ hakemistoon /opt/ravintopolku/dist (root, 0755/0644) ja tiedosto DEPLOYED.
#   - Palvelin: vain commitoitu koodi, uv sync --frozen --no-dev, root omistaa koodin, palvelukäyttäjä ravintopolku.
#     Käynnissä ollut palvelu pysäytetään vaihdon ajaksi ja käynnistetään sen jälkeen; pysäytettyä ei käynnistetä.
#   - Skripti ei luo käyttäjää, hakemistoja, konfiguraatiota eikä Serve-ohjausta: ne ovat isäntämuutoksia
#     (aiops-repon muutosloki). Yksi poikkeus (31.10.2026): jos aiops-välittäjän soketti on olemassa eikä
#     /etc/ravintopolku/palvelin.toml vielä kerro sitä, [palvelin]-tauluun lisätään rivi
#     valittaja = "/run/aiops-valittaja/valittaja.sock" (kuvasta ateria, aiops ADR-0025/-0027). Rivi lisätään vain
#     kerran, kaikki tai ei mitään (TOML jäsennetään ennen tallennusta); peruminen: poista rivi ja käynnistä palvelu.
# =====================================================================
set -euo pipefail

IMAGE="node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df"
TARGET=/opt/ravintopolku
UNIT=ravintopolku.service
UV="${1:-}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
GIT=(git -c "safe.directory=$REPO" -C "$REPO")

[ "$(id -u)" -eq 0 ] || { echo "Aja sudolla: sudo scripts/asenna-tyoasema.sh" >&2; exit 1; }
[ -x "$UV" ] || { echo "Anna uv:n polku: sudo scripts/asenna-tyoasema.sh \"\$(command -v uv)\"" >&2; exit 1; }
[ $# -le 1 ] || { echo "Tuntematon argumentti: $2" >&2; exit 1; }
getent passwd ravintopolku >/dev/null || { echo "Käyttäjää ravintopolku ei ole (aiops-muutosloki, vaihe R2)." >&2; exit 1; }
if [ -n "$("${GIT[@]}" status --porcelain)" ]; then
  echo "Repossa on tallentamattomia muutoksia. Commitoi ensin: asennetaan vain commitoitu koodi." >&2
  "${GIT[@]}" status --short >&2
  exit 1
fi

COMMIT="$("${GIT[@]}" rev-parse --short HEAD)"
echo "Käännetään commit $COMMIT (image $IMAGE)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
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

install -d -o root -g root -m 0755 "$TARGET"
rm -rf "$TARGET/dist.uusi" "$TARGET/dist.vanha"
cp -r "$STAGE/dist" "$TARGET/dist.uusi"
chown -R root:root "$TARGET/dist.uusi"
chmod -R u=rwX,go=rX "$TARGET/dist.uusi"
if [ -d "$TARGET/dist" ]; then mv "$TARGET/dist" "$TARGET/dist.vanha"; fi
mv "$TARGET/dist.uusi" "$TARGET/dist"
rm -rf "$TARGET/dist.vanha"
WAS_ACTIVE=0
if systemctl is-active --quiet "$UNIT"; then
  WAS_ACTIVE=1
  echo "Pysäytetään $UNIT vaihdon ajaksi"
  systemctl stop "$UNIT"
fi
rm -rf "$TARGET/palvelin"
install -d -o root -g root -m 0755 "$TARGET/palvelin"
cp -r "$STAGE/palvelin/src" "$STAGE/palvelin/pyproject.toml" "$STAGE/palvelin/uv.lock" "$STAGE/palvelin/.python-version" "$TARGET/palvelin/"
(cd "$TARGET/palvelin" && "$UV" sync --frozen --no-dev --no-editable --python /usr/bin/python3.12 --quiet)
chown -R root:root "$TARGET/palvelin"
chmod -R u=rwX,go=rX "$TARGET/palvelin"
(cd / && sudo -u ravintopolku "$TARGET/palvelin/.venv/bin/ravintopolku-palvelin" --help >/dev/null)
echo "OK: ravintopolku pystyy käynnistämään palvelimen"
ASETUKSET=/etc/ravintopolku/palvelin.toml
VALITTAJA=/run/aiops-valittaja/valittaja.sock
if [ -f "$ASETUKSET" ] && [ -S "$VALITTAJA" ] && ! grep -Eq '^[[:space:]]*valittaja[[:space:]]*=' "$ASETUKSET"; then
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
install -o root -g root -m 0644 "$STAGE/config/systemd/$UNIT" "/etc/systemd/system/$UNIT"
systemctl daemon-reload
echo "$COMMIT $(date -Iseconds)" > "$TARGET/DEPLOYED"
chmod 0644 "$TARGET/DEPLOYED"
if [ "$WAS_ACTIVE" -eq 1 ]; then
  systemctl start "$UNIT"
  sleep 3
  systemctl is-active --quiet "$UNIT" || { echo "VIRHE: $UNIT ei käynnistynyt: sudo journalctl -u $UNIT -n 50" >&2; exit 1; }
  echo "OK: $UNIT käynnistetty uudelleen"
else
  echo "$UNIT ei ollut käynnissä, joten se jää pysäytetyksi. Käynnistys: sudo systemctl enable --now $UNIT"
fi
echo "Valmis: $(cat "$TARGET/DEPLOYED"), $(find "$TARGET/dist" -type f | wc -l) tiedostoa hakemistossa $TARGET/dist"
