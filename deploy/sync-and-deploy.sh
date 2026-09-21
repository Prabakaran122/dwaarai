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

say "Restarting api-gateway (entitlements now carries modules)"
# The core service, so this is the one restart with blast radius beyond valet.
# Done before the valet script so a failure here stops everything, rather than
# leaving valet on new code talking to an old gateway.
rsh "sudo systemctl restart communitygate-api && sleep 5 && systemctl is-active communitygate-api"
curl -fsS --max-time 20 https://dwaarai.com/api/v1/health >/dev/null && echo "  api-gateway answering"

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
         WHATSAPP_TEMPLATE_CAR_READY WHATSAPP_DEBUG_INBOUND ANPR_SERVICE_URL FACE_RECOGNITION_URL; do
  if [ -n "${!v:-}" ]; then
    FORWARD="$FORWARD $v=$(printf %q "${!v}")"
    echo "  forwarding $v"
  fi
done

rsh "cd /opt/communitygate && sudo -u ec2-user env$FORWARD bash deploy/deploy-valet.sh 2>&1 | tail -40"

say "Verifying"
curl -fsS --max-time 20 https://dwaarai.com/valet-api/health && echo
for u in /valet /admin/valet/slots /admin/valet/branding; do
  printf '%-28s ' "$u"
  curl -s -o /dev/null -L -w '%{http_code}\n' --max-time 25 "https://dwaarai.com$u"
done
echo
echo "Rollback:  cd /opt/communitygate && sudo tar xzf backups/full-pre-$STAMP.tar.gz && sudo -u ec2-user bash deploy/deploy-valet.sh"
