#!/bin/bash
#
# The face recognition service: vectors in, comparisons out.
#
# Separate from deploy-valet.sh on purpose. This one installs a vision stack
# and downloads a model -- minutes, and a few hundred megabytes -- on a box
# with 2 vCPU and under 3GB of RAM shared with everything else. A valet
# release should never have to wait for it, and a failure here must not stop
# one going out.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/communitygate}"
SVC_DIR="$APP_DIR/services/face-service"
VENV="$SVC_DIR/.venv"
PORT="${FACE_PORT:-8090}"
RUN_USER="${RUN_USER:-ec2-user}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

say "Checking there is room for this"
# The model and the wheels together need roughly 2GB. Finding that out after
# a half-finished install is worse than not starting.
FREE_MB=$(df -Pm / | awk 'NR==2{print $4}')
if [ "$FREE_MB" -lt 3000 ]; then
  echo "Only ${FREE_MB}MB free on /. Need ~3000MB for the vision stack and model." >&2
  exit 1
fi
echo "  ${FREE_MB}MB free"

say "Python environment"
sudo dnf install -y python3.11 python3.11-pip >/dev/null 2>&1 || sudo yum install -y python3 python3-pip >/dev/null 2>&1 || true
PY=$(command -v python3.11 || command -v python3)
echo "  using $PY"
[ -d "$VENV" ] || "$PY" -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$SVC_DIR/requirements.txt"

say "Warming the model once, so the first request is not the one that waits"
# Also proves the install works before systemd is told to rely on it.
FACE_MODEL="${FACE_MODEL:-buffalo_l}" "$VENV/bin/python" - <<'PYWARM'
import os
from insightface.app import FaceAnalysis
m = FaceAnalysis(name=os.environ.get("FACE_MODEL", "buffalo_l"), providers=["CPUExecutionProvider"])
m.prepare(ctx_id=-1, det_size=(480, 480))
print("  model ready")
PYWARM

say "Service unit"
sudo tee /etc/systemd/system/communitygate-face.service > /dev/null <<UNIT
[Unit]
Description=DwaarAI Face Recognition Service
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$SVC_DIR
Environment=FACE_MODEL=${FACE_MODEL:-buffalo_l}
Environment=FACE_MATCH_THRESHOLD=${FACE_MATCH_THRESHOLD:-0.85}
# One worker. Two would double the resident model for no throughput a valet
# stand will ever ask for, on a box that cannot spare it.
ExecStart=$VENV/bin/uvicorn main:app --host 127.0.0.1 --port $PORT --workers 1
Restart=always
RestartSec=5
# Bounded so a leak here cannot take the gate and the valet service with it.
MemoryMax=1200M

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable communitygate-face >/dev/null 2>&1
sudo systemctl restart communitygate-face

say "Verifying"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 10 "http://127.0.0.1:$PORT/health" && echo
systemctl is-active communitygate-face
free -m | head -2
