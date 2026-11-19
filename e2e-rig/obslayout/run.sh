#!/bin/bash
# Fresh server + empty mock OBS (Studio Mode), then the 3.2 main-scenes layout e2e: a 3.1 collection is built, migrated
# to the nine main scenes, cleaned up with the dry-run report + typed confirmation, then driven from Producer Mode.
# Usage: bash e2e-rig/obslayout/run.sh <build dir>
D=${1:-/home/claude/build}; R=$(cd "$(dirname "$0")/../.." && pwd)
pkill -f "node dist/server.js"; pkill -f "node mockobs"; sleep 0.8; rm -rf /tmp/oddata && mkdir -p /tmp/oddata
(cd $D && setsid nohup node mockobs.mjs 4455 > /tmp/mockobs.log 2>&1 < /dev/null &); sleep 0.8
(cd $D && PORT=8787 DATA_DIR=/tmp/oddata CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw OBS_WS_URL=ws://127.0.0.1:4455 setsid nohup node dist/server.js > /tmp/server.log 2>&1 < /dev/null &)
for i in $(seq 1 50); do curl -sf localhost:8787/api/health >/dev/null && break; sleep 0.2; done; sleep 2
curl -s "localhost:4456/studio-mode?on=1" > /dev/null
python3 -I -u "$R/e2e-rig/obslayout/layout_e2e.py"
