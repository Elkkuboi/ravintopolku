#!/usr/bin/env bash
# =====================================================================
# asenna-tyoasema.sh: kääntää Ravintopolun päiväkirjan kertakäyttöisissä konteissa ja asentaa staattiset
# tiedostot hakemistoon /opt/ravintopolku/dist (aiops ADR-0014, vaihe R1).
#
# Käyttö repon juuresta:   sudo scripts/asenna-tyoasema.sh
#
#   - Vain commitoitu koodi (git archive HEAD). Likainen työpuu pysäyttää asennuksen.
#   - Kolme konttiajoa samasta tiivisteellä kiinnitetystä Node-imagesta, käyttäjänä 1000, ilman oikeuksia
#     (--cap-drop ALL, no-new-privileges, vain luku -juuri, muisti- ja prosessiraja):
#       1) npm ci --ignore-scripts verkon kanssa: vain lukitut riippuvuudet, ei asennusskriptejä,
#       2) npm test ilman verkkoa,
#       3) npm run build ilman verkkoa (tyyppitarkistus ja Vite-käännös).
#   - Tulos: vain dist/ hakemistoon /opt/ravintopolku/dist (root, 0755/0644) ja tiedosto DEPLOYED.
#   - Ei palvelinta, ei .env-tiedostoa, ei avaimia eikä Serve-muutosta. Tailscale Serve tarjoilee hakemiston
#     portissa 8443 erillisenä isäntämuutoksena (aiops-repon muutosloki).
# =====================================================================
set -euo pipefail

IMAGE="node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df"
TARGET=/opt/ravintopolku
REPO="$(cd "$(dirname "$0")/.." && pwd)"
GIT=(git -c "safe.directory=$REPO" -C "$REPO")

[ "$(id -u)" -eq 0 ] || { echo "Aja sudolla: sudo scripts/asenna-tyoasema.sh" >&2; exit 1; }
[ $# -eq 0 ] || { echo "Skripti ei ota argumentteja." >&2; exit 1; }
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
echo "$COMMIT $(date -Iseconds)" > "$TARGET/DEPLOYED"
chmod 0644 "$TARGET/DEPLOYED"
echo "Valmis: $(cat "$TARGET/DEPLOYED"), $(find "$TARGET/dist" -type f | wc -l) tiedostoa hakemistossa $TARGET/dist"
