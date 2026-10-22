#!/bin/bash
#
# Ships everything on feat/valet-sarthi to dwaarai.com and runs the repo's own
# deploy-valet.sh on the box.
#
# The box is not a git checkout -- it is a copied tree -- so the source is
# synced first and the repo's deploy script does the rest: migrations,
# valet-service, valet-guest, admin-portal, sweep timer.
set -euo pipefail

REPO="${REPO:-$HOME/Documents/DwaarAI/dwaarai}"
PROFILE="${AWS_PROFILE:-pie-prod}"
REGION="${REGION:-us-east-1}"
INSTANCE="${INSTANCE:-i-0cef4313a47d12e03}"
HOST="${HOST:-54.235.41.163}"
KEY=/tmp/eic-valet-full
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

say "Packing the source"
cd "$REPO"
rm -f /tmp/valet-full.tar.gz
# Whole directories, not a hand-written list of subdirectories.
#
# The list used to name app/ and lib/ for admin-portal and quietly omitted
# components/ -- so every change to Sidebar.tsx sat undeployed for three weeks
# while the deploy reported success, because nothing it checked was missing.
# A list of what to include only stays correct until somebody adds a
# directory; excluding what must never ship stays correct on its own.
tar czf /tmp/valet-full.tar.gz \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '*.log' --exclude .env --exclude '.env.*' \
  services/valet-service/src \
  services/valet-service/package.json \
  pnpm-lock.yaml \
  services/api-gateway/migrations \
  services/api-gateway/src \
  services/face-service \
  apps/valet-guest \
  apps/admin-portal \
  deploy
ls -lh /tmp/valet-full.tar.gz

say "Minting a 60-second key"
rm -f "$KEY" "$KEY.pub"
ssh-keygen -t ed25519 -N '' -f "$KEY" -q -C valet-full

push_key() {
  aws ec2-instance-connect send-ssh-public-key --profile "$PROFILE" --region "$REGION" \
    --instance-id "$INSTANCE" --instance-os-user ec2-user \
    --ssh-public-key "file://$KEY.pub" >/dev/null
}
CFG=/tmp/eic-full.cfg
cat > "$CFG" <<EOF
Host dwaarfull
  HostName $HOST
  User ec2-user
  IdentityFile $KEY
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
  ControlMaster auto
  ControlPath /tmp/eic-full-%C
  ControlPersist 30m
EOF
push_key
ssh -F "$CFG" -N -f dwaarfull
rsh() { ssh -F "$CFG" dwaarfull "$@"; }

say "Backing up what is about to be replaced"
rsh "cd /opt/communitygate && sudo tar czf backups/full-pre-$STAMP.tar.gz \
  services/valet-service/src services/api-gateway/migrations \
  apps/valet-guest apps/admin-portal deploy 2>/dev/null; \
  sudo ls -la backups/full-pre-$STAMP.tar.gz"

say "Uploading"
scp -F "$CFG" /tmp/valet-full.tar.gz dwaarfull:/tmp/valet-full.tar.gz

say "Extracting"
rsh "cd /opt/communitygate && tar xzf /tmp/valet-full.tar.gz && \
  test -f services/valet-service/src/routes/webhooks.js && \
  test -f services/api-gateway/migrations/050_valet_slots.sql && \
  test -d apps/admin-portal/app/valet/slots && \
  grep -q valetNav apps/admin-portal/components/Sidebar.tsx && \
  echo 'source in place'"

# The gateway's unit is not rewritten by any deploy -- it is only ever read
# from -- so an extra origin has to be patched in, idempotently, and survives
# on its own thereafter. Kept next to the valet equivalent because the two
# must agree: the app logs in against the gateway and then does everything
# else against valet-service, so one without the other is a login that works
# followed by an app that can do nothing.
#
# The value travels as an environment variable rather than being interpolated
# into the script text: the heredoc is quoted so the remote shell expands
# nothing, and an origin list is exactly the kind of string that would other-
# wise need escaping nobody gets right twice.
if [ -n "${CORS_EXTRA_ORIGINS:-}" ]; then
  say "Allowing extra CORS origins on api-gateway"
  rsh "sudo CORS_EXTRA_ORIGINS=$(printf %q "$CORS_EXTRA_ORIGINS") python3 - <<'PYEOF'
import os, re
PATH = '/etc/systemd/system/communitygate-api.service'
src = open(PATH).read()
extra = [o.strip() for o in os.environ['CORS_EXTRA_ORIGINS'].split(',') if o.strip()]

m = re.search(r'^Environment=CORS_ORIGINS=(.*)$', src, re.M)
current = [o.strip() for o in m.group(1).split(',') if o.strip()] if m else []

if '*' in current:
    # A wildcard already allows everything. Narrowing it here would be a
    # silent tightening nobody asked for.
    print('  gateway already allows *')
else:
    merged = current + [o for o in extra if o not in current]
    if merged == current:
        print('  gateway origins unchanged:', ','.join(current))
    else:
        line = 'Environment=CORS_ORIGINS=' + ','.join(merged)
        if m:
            src = src[:m.start()] + line + src[m.end():]
        else:
            src = src.replace('[Service]', '[Service]\n' + line, 1)
        open(PATH, 'w').write(src)
        print('  gateway origins:', ','.join(merged))
PYEOF
  sudo systemctl daemon-reload"
fi

say "Restarting api-gateway (entitlements now carries modules)"
# The core service, so this is the one restart with blast radius beyond valet.
# Done before the valet script so a failure here stops everything, rather than
# leaving valet on new code talking to an old gateway.
rsh "sudo systemctl restart communitygate-api && sleep 5 && systemctl is-active communitygate-api"
curl -fsS --max-time 20 https://dwaarai.com/health >/dev/null \
  && echo "  api-gateway answering" || die "api-gateway not answering after restart"

# The webhook is the one integration nothing else here touches, and a blanked
# secret makes it 401 every inbound message while every health check stays
# green. Asserted after the deploy, with the value read back off the box rather
# than from this shell, so it catches the case where it was never supplied.
say "Checking the WhatsApp webhook still authenticates"
LIVE_SECRET=$(rsh "sudo sed -n 's/^Environment=WHATSAPP_WEBHOOK_SECRET=//p' /etc/systemd/system/communitygate-valet.service | head -1")
if [ -z "$LIVE_SECRET" ]; then
  die "WHATSAPP_WEBHOOK_SECRET is empty on the box - every inbound message would 401"
fi
WH=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "https://dwaarai.com/valet-api/webhooks/whatsapp?token=$LIVE_SECRET" \
  -H 'Content-Type: application/json' -d '{"ping":true}' --max-time 20)
[ "$WH" = "200" ] || die "webhook rejected its own secret (HTTP $WH)"
echo "  webhook authenticating"

say "Running the repo's deploy script"
# Forwarded explicitly. Environment set for this script lives on the laptop;
# the deploy runs over ssh, so without this the remote script sees none of it,
# writes empty Environment= lines, and reports a clean success with the
# integration switched off -- which is exactly what it did once.
#
# Only names, never values, are echoed: these are credentials.
FORWARD=""
for v in WHATSAPP_PROVIDER WHATSAPP_NUMBER WHATSAPP_COUNTRY_CODE \
         AUTHKEY_API_KEY MSG91_AUTH_KEY WHATSAPP_WEBHOOK_SECRET \
         WHATSAPP_TEMPLATE_CAR_READY WHATSAPP_TEMPLATE_CHECKED_IN WHATSAPP_TEMPLATE_ON_THE_WAY WHATSAPP_TEMPLATE_REQUESTED WHATSAPP_DEBUG_INBOUND ANPR_SERVICE_URL FACE_RECOGNITION_URL \
         CORS_EXTRA_ORIGINS WHATSAPP_NOTIFY_STAGES; do
  if [ -n "${!v:-}" ]; then
    FORWARD="$FORWARD $v=$(printf %q "${!v}")"
    echo "  forwarding $v"
  fi
done

rsh "cd /opt/communitygate && sudo -u ec2-user env$FORWARD bash deploy/deploy-valet.sh 2>&1 | tail -40"

# The certificate expired once with nothing saying so: renewal had been failing
# for weeks on a dead name (dwaarai.in) on the same cert, and every request to
# dwaarai.com -- website, admin, guest pages, the valet app -- then failed TLS
# for two days. Every deploy now reads the live expiry and says so out loud.
say "Checking the TLS certificate"
END=$(echo | openssl s_client -connect dwaarai.com:443 -servername dwaarai.com 2>/dev/null \
  | openssl x509 -noout -enddate | cut -d= -f2)
DAYS=$(( ( $(date -j -f '%b %d %T %Y %Z' "$END" +%s 2>/dev/null || date -d "$END" +%s) - $(date +%s) ) / 86400 ))
echo "  expires $END ($DAYS days)"
[ "$DAYS" -ge 21 ] || printf '\033[1;31m  WARNING: certificate expires in %s days - check certbot renewal on the box\033[0m\n' "$DAYS"

say "Verifying"
curl -fsS --max-time 20 https://dwaarai.com/valet-api/health && echo
for u in /valet /admin/valet/slots /admin/valet/branding; do
  printf '%-28s ' "$u"
  curl -s -o /dev/null -L -w '%{http_code}\n' --max-time 25 "https://dwaarai.com$u"
done
echo
echo "Rollback:  cd /opt/communitygate && sudo tar xzf backups/full-pre-$STAMP.tar.gz && sudo -u ec2-user bash deploy/deploy-valet.sh"
