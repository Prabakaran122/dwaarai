#!/bin/bash
#
# Deploys the valet (Sarthi) surfaces onto the dwaarai.com host.
#
# Additive and idempotent: it never touches the existing api-gateway, landing
# site, or database contents. Re-running it is safe — every step either
# converges on the desired state or is a no-op.
#
#   sudo -u ec2-user bash deploy/deploy-valet.sh
#
# What it puts where:
#   valet-service   :3060   systemd  communitygate-valet.service
#   valet-guest     :3110   systemd  communitygate-valet-guest.service   (Next, basePath /valet)
#   admin-portal    :3100   rebuilt so /admin/valet exists               (existing unit restarted)
#   retention sweep         systemd timer, hourly, out of the web process
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/communitygate}"
RUN_USER="${RUN_USER:-ec2-user}"
PUBLIC_HOST="${PUBLIC_HOST:-dwaarai.com}"

# Read from the running api-gateway rather than guessed: valet-service verifies
# the tokens api-gateway issues, so a mismatched secret would reject every guard
# with a 401 that looks like a login bug.
API_UNIT=/etc/systemd/system/communitygate-api.service
JWT_SECRET="${JWT_SECRET:-$(sudo sed -n 's/^Environment=JWT_SECRET=//p' "$API_UNIT" 2>/dev/null)}"
DATABASE_URL="${DATABASE_URL:-$(sudo sed -n 's/^Environment=DATABASE_URL=//p' "$API_UNIT" 2>/dev/null)}"
[ -n "$JWT_SECRET" ]   || { echo "could not read JWT_SECRET from $API_UNIT"; exit 1; }
[ -n "$DATABASE_URL" ] || { echo "could not read DATABASE_URL from $API_UNIT"; exit 1; }

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

cd "$APP_DIR" || die "$APP_DIR not found"

# --------------------------------------------------------------------------
say "Preflight"
# --------------------------------------------------------------------------
command -v node >/dev/null || die "node not installed"
command -v pnpm >/dev/null || die "pnpm not installed"
docker ps -q -f name=postgres >/dev/null 2>&1 || die "postgres container not running"

# Refuse to proceed if the box is short on memory: two Next builds on a
# t3.medium will OOM and leave a half-built app being served.
AVAIL_MB=$(free -m | awk '/^Mem:/{print $7}')
echo "available memory: ${AVAIL_MB}MB"
if [ "$AVAIL_MB" -lt 900 ]; then
  echo "WARNING: low memory. Enabling a temporary swapfile for the builds."
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo "swap enabled"
  fi
fi

# --------------------------------------------------------------------------
say "Applying database migrations"
# --------------------------------------------------------------------------
# The runner records what it has applied, so this only runs 043_valet.sql on a
# box already carrying 001-041, and a second run prints "up to date".
pnpm install --filter api-gateway
DATABASE_URL="$DATABASE_URL" pnpm --filter api-gateway migrate

MIGRATION_CHECK=$(docker exec "$(docker ps -q -f name=postgres)" \
  psql -U cguser -d communitygate -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'valet_%'")
[ "$MIGRATION_CHECK" = "6" ] || die "expected 6 valet_* tables, found $MIGRATION_CHECK"
echo "valet tables present: $MIGRATION_CHECK"

# --------------------------------------------------------------------------
say "Installing and starting valet-service (:3060)"
# --------------------------------------------------------------------------
pnpm install --filter valet-service

sudo tee /etc/systemd/system/communitygate-valet.service > /dev/null <<EOF
[Unit]
Description=CommunityGate Valet Service
After=docker.service communitygate-api.service

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR/services/valet-service
Environment=NODE_ENV=production
Environment=PORT=3060
Environment=JWT_SECRET=$JWT_SECRET
Environment=DATABASE_URL=$DATABASE_URL
Environment=VALET_GUEST_BASE_URL=https://$PUBLIC_HOST/valet
Environment=VALET_STORAGE=local
Environment=VALET_UPLOAD_DIR=$APP_DIR/uploads/valet
Environment=ROTATING_TOKEN_TTL_SECONDS=18
Environment=PHOTO_RETENTION_HOURS=24
Environment=CORS_ORIGIN=https://$PUBLIC_HOST
# Off deliberately: the sweep runs from its own timer, below.
Environment=VALET_RUN_SWEEP_IN_PROCESS=false
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "$APP_DIR/uploads/valet"
sudo systemctl daemon-reload
sudo systemctl enable communitygate-valet
sudo systemctl restart communitygate-valet

# --------------------------------------------------------------------------
say "Building the guest app (:3110)"
# --------------------------------------------------------------------------
pnpm install --filter valet-guest
NEXT_PUBLIC_VALET_API_URL="https://$PUBLIC_HOST/valet-api" \
  pnpm --filter valet-guest build

sudo tee /etc/systemd/system/communitygate-valet-guest.service > /dev/null <<EOF
[Unit]
Description=CommunityGate Valet Guest Page
After=communitygate-valet.service

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR/apps/valet-guest
Environment=NODE_ENV=production
Environment=PORT=3110
Environment=NEXT_PUBLIC_VALET_API_URL=https://$PUBLIC_HOST/valet-api
ExecStart=/usr/bin/npx next start -p 3110
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable communitygate-valet-guest
sudo systemctl restart communitygate-valet-guest

# --------------------------------------------------------------------------
say "Rebuilding the admin portal so /admin/valet exists"
# --------------------------------------------------------------------------
pnpm install --filter admin-portal
# Preserve whatever API URL the existing build used; only add the valet one.
EXISTING_API_URL=$(grep -oP 'NEXT_PUBLIC_API_URL=\K\S+' /etc/systemd/system/communitygate-admin.service 2>/dev/null || true)
NEXT_PUBLIC_API_URL="${EXISTING_API_URL:-https://$PUBLIC_HOST/api/v1}" \
NEXT_PUBLIC_VALET_API_URL="https://$PUBLIC_HOST/valet-api" \
  pnpm --filter admin-portal build
sudo systemctl restart communitygate-admin

# --------------------------------------------------------------------------
say "Scheduling the retention sweep"
# --------------------------------------------------------------------------
# Deliberately not a setInterval inside the web process: that duplicates across
# instances and dies with the web process.
sudo tee /etc/systemd/system/communitygate-valet-sweep.service > /dev/null <<EOF
[Unit]
Description=CommunityGate Valet retention and expiry sweep

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$APP_DIR/services/valet-service
Environment=DATABASE_URL=$DATABASE_URL
Environment=VALET_STORAGE=local
Environment=VALET_UPLOAD_DIR=$APP_DIR/uploads/valet
Environment=PHOTO_RETENTION_HOURS=24
ExecStart=/usr/bin/node scripts/valet-sweep.js
EOF

sudo tee /etc/systemd/system/communitygate-valet-sweep.timer > /dev/null <<EOF
[Unit]
Description=Run the valet retention sweep hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now communitygate-valet-sweep.timer

# --------------------------------------------------------------------------
say "Wiring nginx"
# --------------------------------------------------------------------------
# Two new locations only. The existing server block, its TLS, the landing site
# and /admin are left exactly as they are.
# `location` blocks are only legal inside a server block, so they cannot go in
# conf.d/ (which nginx includes at the http level). Find a directory that the
# live server block actually includes — on Amazon Linux that is default.d — and
# never guess: if there is no such include, write nothing and say so.
NGINX_CONF=/etc/nginx/conf.d/communitygate.conf

if [ -f "$NGINX_CONF" ] && ! grep -q 'location \^~ /valet' "$NGINX_CONF"; then
  # Timestamped backup, matching the convention already used beside this file.
  sudo cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%Y%m%d-%H%M%S)"

  # NOTE the `^~`. This block already carries a regex location matching
  # \.(css|js|mjs|woff2?|...)$, and in nginx a regex location beats a plain
  # prefix one — so `location /valet` would lose every asset request under
  # /valet/_next/ to the landing site's static root and the guest page would
  # load with no CSS or JS. `^~` stops regex evaluation for this prefix, which
  # is exactly why the existing /admin block uses it too.
  sudo python3 - "$NGINX_CONF" <<'PYEOF'
import io, re, sys
path = sys.argv[1]
s = io.open(path, encoding='utf-8').read()

block = """
    # ---- Valet (Sarthi) ----
    # `^~` so the css/js regex location above cannot steal /valet/_next/ assets.
    location ^~ /valet-api/ {
        proxy_pass http://127.0.0.1:3060/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20m;
    }

    location ^~ /valet {
        proxy_pass http://127.0.0.1:3110;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
"""

# Anchor on the canonical HTTPS block's /admin location, which is unique to it,
# so the block lands in the dwaarai.com server and not a redirect stanza.
anchor = s.index('server_name dwaarai.com;')
admin = s.index('location ^~ /admin', anchor)
s = s[:admin] + block.lstrip('\n') + '\n    ' + s[admin:]
io.open(path, 'w', encoding='utf-8').write(s)
print('nginx block inserted')
PYEOF

  if sudo nginx -t; then
    sudo systemctl reload nginx
    echo "nginx reloaded"
  else
    NEWEST_BAK=$(sudo ls -t "$NGINX_CONF".bak.* | head -1)
    sudo cp "$NEWEST_BAK" "$NGINX_CONF"
    die "nginx config test failed — restored $NEWEST_BAK, nginx left as it was"
  fi
elif [ -f "$NGINX_CONF" ]; then
  echo "valet locations already present — leaving nginx alone"
else
  echo "$NGINX_CONF not found; route /valet -> :3110 and /valet-api/ -> :3060 by hand"
  NGINX_MANUAL=1
fi

# --------------------------------------------------------------------------
say "Verifying"
# --------------------------------------------------------------------------
sleep 4
FAILED=0
check() {
  local label="$1" url="$2" expect="$3"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)
  if [ "$code" = "$expect" ]; then
    printf '  ok   %-28s %s\n' "$label" "$code"
  else
    printf '  FAIL %-28s %s (expected %s)\n' "$label" "$code" "$expect"
    FAILED=1
  fi
}

check "valet-service health"  "http://127.0.0.1:3060/health"          200
check "guest app (local)"     "http://127.0.0.1:3110/valet"           200
check "admin portal (local)"  "http://127.0.0.1:3100/admin/valet"     200
check "existing api-gateway"  "http://127.0.0.1:3000/health"          200
check "landing still up"      "https://$PUBLIC_HOST/"                 200
if [ "${NGINX_MANUAL:-0}" = "1" ]; then
  echo "  skip guest app (public)       — nginx still needs the manual route above"
else
  check "guest app (public)"    "https://$PUBLIC_HOST/valet"            200
fi

echo
systemctl is-active --quiet communitygate-valet       && echo "  valet-service:  active"      || { echo "  valet-service:  DEAD"; FAILED=1; }
systemctl is-active --quiet communitygate-valet-guest && echo "  valet-guest:    active"      || { echo "  valet-guest:    DEAD"; FAILED=1; }
systemctl is-active --quiet communitygate-api         && echo "  api-gateway:    still active" || { echo "  api-gateway:    DEAD"; FAILED=1; }

if [ "$FAILED" -ne 0 ]; then
  echo
  echo "Something is not healthy. Logs:"
  echo "  journalctl -u communitygate-valet -n 50 --no-pager"
  echo "  journalctl -u communitygate-valet-guest -n 50 --no-pager"
  exit 1
fi

say "Valet deployed"
echo "  guest page   https://$PUBLIC_HOST/valet/v/<session token>"
echo "  ops queue    https://$PUBLIC_HOST/admin/valet"
echo "  service      https://$PUBLIC_HOST/valet-api/health"
