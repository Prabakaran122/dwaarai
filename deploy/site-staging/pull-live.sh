#!/bin/bash
# Downloads the live marketing site, minus files owned by other deploys, so
# staging starts as an exact copy of dwaarai.com. Changes nothing on the box.
set -euo pipefail
KEY=/tmp/eic-pull-live; CFG=/tmp/eic-pull-live.cfg
OUT="$HOME/Downloads/dwaarai-site-$(date +%Y%m%d).tar.gz"
LIST=$(mktemp)
# Remove the key, config and listing on every exit; drop a partial tarball on failure.
trap 'rc=$?; rm -f "$KEY" "$KEY.pub" "$CFG" "$LIST"; if [ "$rc" -ne 0 ]; then rm -f "$OUT"; fi' EXIT
rm -f "$KEY" "$KEY.pub"; ssh-keygen -t ed25519 -N '' -f "$KEY" -q -C pull-live
aws ec2-instance-connect send-ssh-public-key --profile "${AWS_PROFILE:-pie-prod}" --region us-east-1 \
  --instance-id i-0cef4313a47d12e03 --instance-os-user ec2-user --ssh-public-key "file://$KEY.pub" >/dev/null
printf 'Host d\n  HostName 54.235.41.163\n  User ec2-user\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n  LogLevel ERROR\n' "$KEY" > "$CFG"
# find prunes the top-level exclusions and every hidden name at any depth (the root "." is kept),
# and tar reads the resulting list from stdin. --no-recursion stops tar re-adding the
# root "." tree (which would pull the excluded paths back in). GNU and BSD compatible.
ssh -F "$CFG" d "cd /opt/communitygate/landing && sudo find . \( -path ./apps -o -path ./scripts -o -path ./install.html -o -name '.*' \) ! -name . -prune -o -print0 | sudo tar --null --no-recursion -czf - -T -" > "$OUT"
rm -f "$KEY" "$KEY.pub" "$CFG"
ls -lh "$OUT"
tar tzf "$OUT" > "$LIST"
if ! grep -qxE '(\./)?index\.html' "$LIST"; then
  echo "index.html is missing from the tarball; refusing to report it as complete" >&2
  exit 1
fi
# Judge the listing with the promoter's own rules (policy.js), so this can never
# disagree with what a real promote would refuse. `tar tzvf` columns differ:
# BSD (this Mac): perms links owner group size "10 Nov 06:56" name
# GNU:            perms owner/group size 2026-11-10 06:56 name
# Directories and links are ignored; names may contain spaces.
POLICY="$(cd "$(dirname "$0")/../.." && pwd)/services/site-promoter/src/policy.js"
[ -f "$POLICY" ] || { echo "cannot find $POLICY" >&2; exit 1; }
CHECK=$(cat <<'JS'
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { checkPath, isProtected, LIMITS, validateManifest } = await import(pathToFileURL(process.env.POLICY).href);
const BSD = /^(\S+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s(.+)$/;
const GNU = /^(\S+)\s+\S+\s+(\d+)\s+\d{4}-\d\d-\d\d\s+\d\d:\d\d(?::\d\d)?\s(.+)$/;
const dummy = 'a'.repeat(64);
const files = [];
const unparsed = [];
for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const m = GNU.exec(line) || BSD.exec(line);
  if (!m) { unparsed.push(line); continue; }
  if (m[1][0] === 'd' || m[1][0] === 'l' || m[3].endsWith('/')) continue;
  files.push({ path: m[3].replace(/^\.\//, ''), size: Number(m[2]), sha256: dummy });
}
if (unparsed.length) { console.log(`could not read ${unparsed.length} tar line(s), e.g. ${unparsed[0]}`); }
const v = validateManifest(files);
for (const e of v.errors) console.log(e);
if (!v.ok || unparsed.length) console.log('^ these would block a promote: decide with the user whether to delete them on staging');
else console.log(`every file is promotable (${files.length} files)`);
JS
)
tar tzvf "$OUT" | POLICY="$POLICY" node --input-type=module -e "$CHECK"
