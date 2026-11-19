#!/bin/bash
# Fresh server + mock OBS (with the six position audio sources, Discord and a mic), then the Talent e2e.
# Usage: bash e2e-rig/talent3/run.sh <build-dir with dist/>   (sandbox: /home/claude/build from e2e-rig/devshim/build.mjs)
D=${1:-/home/claude/build}; R=$(cd "$(dirname "$0")/../.." && pwd)
pkill -f "node dist/server.js"; pkill -f "mockobs.mjs"; sleep 0.8; rm -rf /tmp/oddata && mkdir -p /tmp/oddata
(cd $D && nohup node mockobs.mjs 4455 > /tmp/mockobs.log 2>&1 &); sleep 1
for n in 1 2 3 4 5 6; do curl -s "localhost:4456/add-audio?scene=Overdrive%20%C2%B7%20Caster%20audio&name=Overdrive%20Caster%20$n%20audio&kind=browser_source&url=http://localhost:8787/output/audio/$n" >/dev/null; done
curl -s "localhost:4456/add-audio?scene=Scene&name=Discord&kind=wasapi_process_output_capture" >/dev/null; curl -s "localhost:4456/add-audio?scene=Scene&name=Mic/Aux&kind=wasapi_input_capture" >/dev/null
(cd $D && PORT=8787 DATA_DIR=/tmp/oddata CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw OBS_WS_URL=ws://127.0.0.1:4455 nohup node dist/server.js > /tmp/server.log 2>&1 < /dev/null &)
for i in $(seq 1 50); do curl -sf localhost:8787/api/health >/dev/null && break; sleep 0.2; done; sleep 1
python3 -I -u "$R/e2e-rig/talent3/talent_e2e.py"
