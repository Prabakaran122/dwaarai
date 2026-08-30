#!/bin/bash
#
# Publishes a built Sarthi APK to dwaarai.com/install.
#
# Run this only AFTER `eas build` has produced an APK — it uploads the file
# first and patches install.html second, so the download card can never appear
# on the page before the file it links to exists.
#
#   deploy/publish-valet-apk.sh ~/Downloads/sarthi-valet.apk
#
# Idempotent: re-running replaces the APK and leaves the card alone if it is
# already there.
#
set -euo pipefail

APK="${1:-}"
SSH_HOST="${SSH_HOST:-dwaar}"
SSH_CFG="${SSH_CFG:-}"
LANDING=/opt/communitygate/landing
REMOTE_APK="$LANDING/apps/sarthi-valet.apk"

ssh_cmd() { ssh ${SSH_CFG:+-F "$SSH_CFG"} "$SSH_HOST" "$@"; }
scp_cmd() { scp ${SSH_CFG:+-F "$SSH_CFG"} "$@"; }

[ -n "$APK" ] || { echo "usage: $0 <path-to-sarthi-valet.apk>"; exit 2; }
[ -f "$APK" ] || { echo "not found: $APK"; exit 2; }

# An APK is a zip; a truncated or HTML-error download is the common failure and
# would otherwise be published as a working link.
file "$APK" | grep -qiE 'zip|android' || { echo "not an APK: $APK"; exit 1; }
SIZE_MB=$(( $(wc -c < "$APK") / 1024 / 1024 ))
[ "$SIZE_MB" -gt 10 ] || { echo "suspiciously small (${SIZE_MB}MB) — did the build finish?"; exit 1; }
echo "publishing ${SIZE_MB}MB APK"

echo "==> uploading"
scp_cmd "$APK" "$SSH_HOST:/tmp/sarthi-valet.apk"
ssh_cmd "sudo mv /tmp/sarthi-valet.apk $REMOTE_APK && sudo chmod 644 $REMOTE_APK"

echo "==> verifying it serves"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -r 0-1023 https://dwaarai.com/apps/sarthi-valet.apk --max-time 30)
[ "$CODE" = "206" ] || [ "$CODE" = "200" ] || { echo "APK not served (HTTP $CODE)"; exit 1; }

echo "==> adding the install card"
scp_cmd "$(dirname "$0")/valet-install-card.html" "$SSH_HOST:/tmp/valet-card.html"
ssh_cmd "sudo python3 - <<'PY'
import io
path = '$LANDING/install.html'
s = io.open(path, encoding='utf-8').read()

if 'sarthi-valet.apk' in s:
    print('card already present, leaving install.html alone')
    raise SystemExit(0)

card = io.open('/tmp/valet-card.html', encoding='utf-8').read()

# The three app cards sit in one <section>; append before it closes so Sarthi
# lands beside Nazar and Resident rather than outside the grid.
idx = s.rindex('</section>')
s = s[:idx] + card + s[idx:]

io.open(path + '.bak.valet', 'w', encoding='utf-8').write(io.open(path, encoding='utf-8').read())
io.open(path, 'w', encoding='utf-8').write(s)
print('install card added')
PY"

echo "==> verifying the page"
curl -s https://dwaarai.com/install --max-time 20 | grep -q 'sarthi-valet.apk' \
  && echo "  install page lists Sarthi" \
  || { echo "  install page does NOT list Sarthi"; exit 1; }

echo
echo "Done: https://dwaarai.com/install"
