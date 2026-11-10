#!/bin/bash
#
# Ships services/site-promoter to the dwaarai.com box and installs it. Touches
# nothing else: no api-gateway restart, no valet deploy.
#
# First run needs SITE_PROMOTE_SECRET, STAGING_USER and STAGING_PASS in this
# shell. Later runs inherit them from the box. Names are echoed, never values.
# Values travel in a 0600 file, never on a command line (ps, /proc/*/cmdline).
set -euo pipefail

REPO="${REPO:-$HOME/Documents/DwaarAI/dwaarai}"
PROFILE="${AWS_PROFILE:-pie-prod}"
REGION="${REGION:-us-east-1}"
INSTANCE="${INSTANCE:-i-0cef4313a47d12e03}"
HOST="${HOST:-54.235.41.163}"
KEY=/tmp/eic-site-promoter
CFG=/tmp/eic-site-promoter.cfg
KNOWN_HOSTS="$HOME/.ssh/known_hosts_dwaarai"
SECRETS="SITE_PROMOTE_SECRET STAGING_USER STAGING_PASS"

umask 077
ENVFILE=$(mktemp)
cleanup() { rm -f "$ENVFILE" "$KEY" "$KEY.pub" "$CFG"; }
trap cleanup EXIT

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

# Values are written as NAME='value' lines, so refuse anything that cannot be
# represented that way. Names only in the message, never the value.
check_value() {
  case "$2" in
    *$'\n'*) die "$1 contains a newline" ;;
    *\'*|*\\*) die "$1 contains a single quote or backslash" ;;
  esac
}

say "Testing"
(cd "$REPO/services/site-promoter" && npm test)

say "Packing"
COPYFILE_DISABLE=1 tar czf /tmp/site-promoter.tar.gz -C "$REPO" \
  --exclude node_modules --exclude '*.test.js' \
  services/site-promoter deploy/deploy-site-promoter.sh

say "Connecting"
mkdir -p -m 700 "$HOME/.ssh"
rm -f "$KEY" "$KEY.pub"
ssh-keygen -t ed25519 -N '' -f "$KEY" -q -C site-promoter
aws ec2-instance-connect send-ssh-public-key --profile "$PROFILE" --region "$REGION" \
  --instance-id "$INSTANCE" --instance-os-user ec2-user --ssh-public-key "file://$KEY.pub" >/dev/null
cat > "$CFG" <<EOF
Host dwaarsp
  HostName $HOST
  User ec2-user
  IdentityFile $KEY
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
  UserKnownHostsFile $KNOWN_HOSTS
  LogLevel ERROR
EOF

say "Forwarding"
: > "$ENVFILE"
for v in $SECRETS; do
  if [ -n "${!v:-}" ]; then
    check_value "$v" "${!v}"
    printf "%s='%s'\n" "$v" "${!v}" >> "$ENVFILE"
    echo "  forwarding $v"
  fi
done

scp -F "$CFG" /tmp/site-promoter.tar.gz dwaarsp:/tmp/site-promoter.tar.gz
scp -F "$CFG" "$ENVFILE" dwaarsp:/tmp/site-promoter.env

say "Installing"
# The remote side reads and removes /tmp/site-promoter.env itself; the final
# rm is a backstop for a run that failed before the deploy script got to it.
ssh -F "$CFG" dwaarsp 'chmod 600 /tmp/site-promoter.env && cd /opt/communitygate && tar xzf /tmp/site-promoter.tar.gz && bash deploy/deploy-site-promoter.sh; rc=$?; rm -f /tmp/site-promoter.env; exit $rc'
