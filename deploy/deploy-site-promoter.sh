#!/bin/bash
#
# Installs services/site-promoter on the dwaarai.com box. Idempotent.
#
# Secrets are never written by this script from nothing. Each value comes from,
# in order: this shell's forwarded file (/tmp/site-promoter.env, written by
# ship-site-promoter.sh), the root-only env file already on the box, or -- once,
# for a box installed by an older version of this script -- the old unit's own
# Environment= lines. So a deploy from a laptop that forgot a value cannot blank it.
set -euo pipefail

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

APP=/opt/communitygate/services/site-promoter
UNIT=/etc/systemd/system/dwaarai-site-promoter.service
ENV_FILE=/etc/dwaarai-site-promoter.env
NGINX_CONF=/etc/nginx/conf.d/communitygate.conf
FORWARDED=/tmp/site-promoter.env
SECRETS="SITE_PROMOTE_SECRET STAGING_USER STAGING_PASS"

# Values are written as NAME='value' lines, so refuse anything that cannot be
# represented that way. Names only in the message, never the value.
check_value() {
  case "$2" in
    *$'\n'*) die "$1 contains a newline" ;;
    *\'*|*\\*) die "$1 contains a single quote or backslash" ;;
  esac
}

# Forwarded values arrive in a file, never on a command line (ps, /proc).
# Read once, then removed on every exit path.
trap 'rm -f "$FORWARDED"' EXIT
if [ -f "$FORWARDED" ]; then
  set -a
  . "$FORWARDED"
  set +a
  rm -f "$FORWARDED"
fi

for v in $SECRETS; do
  if [ -z "${!v:-}" ] && [ -f "$ENV_FILE" ]; then
    printf -v "$v" '%s' "$(sudo sed -n "s/^$v='\(.*\)'\$/\1/p" "$ENV_FILE" | head -1)"
  fi
  if [ -z "${!v:-}" ] && [ -f "$UNIT" ]; then
    printf -v "$v" '%s' "$(sudo sed -n "s/^Environment=$v=//p" "$UNIT" | head -1)"
  fi
  [ -n "${!v:-}" ] || die "$v is not set and not on the box"
  check_value "$v" "${!v}"
done

say "Folders"
sudo mkdir -p /opt/communitygate/landing-backups /var/lib/site-promoter
test -f "$APP/src/index.js" || die "$APP/src/index.js missing"
test -d /opt/communitygate/landing || die "/opt/communitygate/landing is missing (the unit's ReadWritePaths needs it)"

say "Secrets file"
# Created 0600 before anything is written, so the values never sit in a
# world-readable file, not even for an instant.
sudo install -m 600 /dev/null "$ENV_FILE"
for v in $SECRETS; do
  printf "%s='%s'\n" "$v" "${!v}"
done | sudo tee "$ENV_FILE" >/dev/null
echo "  wrote $ENV_FILE (root-only)"

say "systemd unit"
sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=dwaarai.com website promoter (staging -> live)
After=network.target

[Service]
ExecStart=/usr/bin/node $APP/src/index.js
Restart=on-failure
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
Environment=PORT=3011
# Writes only the website, its backups and its own log.
ProtectSystem=strict
ReadWritePaths=/opt/communitygate/landing /opt/communitygate/landing-backups /var/lib/site-promoter
PrivateTmp=true
NoNewPrivileges=true
# Runs as root because the live site is root-owned (written by sudo in the
# existing deploys), so the hardening below narrows what root can touch.
ProtectHome=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0022
CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable dwaarai-site-promoter >/dev/null
sudo systemctl restart dwaarai-site-promoter
sleep 2
systemctl is-active dwaarai-site-promoter >/dev/null || die "site-promoter did not start: $(sudo journalctl -u dwaarai-site-promoter -n 20 --no-pager)"

say "nginx"
if ! grep -q 'location \^~ /_site/' "$NGINX_CONF"; then
  sudo cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%Y%m%d-%H%M%S)"
  sudo python3 - "$NGINX_CONF" <<'PYEOF'
import io, sys
path = sys.argv[1]
s = io.open(path, encoding='utf-8').read()
block = """# ---- Website promoter (staging.dwaarai.com -> this site) ----
    # Signed requests only; the service itself refuses anything unsigned.
    location ^~ /_site/ {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 16k;
        proxy_read_timeout 60s;
    }

    """
anchor = s.index('server_name dwaarai.com;')
admin = s.index('location ^~ /admin', anchor)
s = s[:admin] + block + s[admin:]
io.open(path, 'w', encoding='utf-8').write(s)
print('nginx /_site/ block inserted')
PYEOF
  if sudo nginx -t; then
    sudo systemctl reload nginx
  else
    LATEST=$(ls -t "$NGINX_CONF".bak.* | head -1)
    sudo cp "$LATEST" "$NGINX_CONF"
    die "nginx -t failed; restored $LATEST"
  fi
else
  echo "  already wired"
fi

say "Checks"
# || true: a refused connection makes curl exit non-zero, but -w still prints
# 000, and that code should reach the die message rather than abort silently.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://dwaarai.com/_site/status || true)
[ "$code" = "401" ] || die "/_site/status should refuse unsigned requests with 401, got $code"
echo "  /_site/ answers and refuses unsigned requests"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://dwaarai.com/ || true)
[ "$code" = "200" ] || die "landing page answered $code"
echo "  landing still up"
