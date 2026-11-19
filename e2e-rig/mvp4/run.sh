#!/bin/bash
# Fresh server + mock OBS (every Overdrive scene built by the Scene Builder), then the MVP integration e2e.
# Usage: bash e2e-rig/mvp4/run.sh <build dir with dist/ and mockobs.mjs>
D=${1:-/home/claude/build}; R=$(cd "$(dirname "$0")/../.." && pwd)
pkill -f "node dist/server.js"; pkill -f "node mockobs"; sleep 0.8; rm -rf /tmp/oddata && mkdir -p /tmp/oddata
(cd $D && nohup node mockobs.mjs 4455 > /tmp/mockobs.log 2>&1 &); sleep 0.8
(cd $D && PORT=8787 DATA_DIR=/tmp/oddata CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw OBS_WS_URL=ws://127.0.0.1:4455 setsid nohup node dist/server.js > /tmp/server.log 2>&1 < /dev/null &)
for i in $(seq 1 50); do curl -sf localhost:8787/api/health >/dev/null && break; sleep 0.2; done; sleep 2
node "$R/e2e-rig/mvp3/obs-build.mjs" | grep -v "^scenes"
python3 -I -u "$R/e2e-rig/mvp4/mvp_sync_e2e.py"
