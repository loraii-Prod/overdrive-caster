#!/bin/bash
# Fresh server (sheet = local fixture CSVs) + mock OBS with every scene built, then the Track Progression e2e.
# Usage: bash e2e-rig/track/run.sh <build dir with dist/ and mockobs.mjs>
D=${1:-/home/claude/build}; R=$(cd "$(dirname "$0")/../.." && pwd)
pkill -f "node dist/server.js"; pkill -f "mockobs.mjs"; sleep 0.8; rm -rf /tmp/oddata /tmp/trackfx && mkdir -p /tmp/oddata && cp -r "$R/tests/fixtures/track" /tmp/trackfx
(cd $D && setsid nohup node mockobs.mjs 4455 > /tmp/mockobs.log 2>&1 < /dev/null &); sleep 0.8
(cd $D && SHEET_FIXTURE_DIR=/tmp/trackfx PORT=8787 DATA_DIR=/tmp/oddata CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw OBS_WS_URL=ws://127.0.0.1:4455 setsid nohup node dist/server.js > /tmp/server.log 2>&1 < /dev/null &)
for i in $(seq 1 50); do curl -sf localhost:8787/api/health >/dev/null && break; sleep 0.2; done; sleep 2
node "$R/e2e-rig/mvp3/obs-build.mjs" > /dev/null
