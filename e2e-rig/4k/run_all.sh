#!/bin/bash
# Full regression for the native-4K release candidate. Builds once, then runs every suite with its own fresh server.
#   bash e2e-rig/4k/run_all.sh            (needs Postgres-free setup; headless Chrome + the OBS protocol mock)
# Prints one line per suite and exits 1 if any suite fails. Logs in /tmp/4k/run/.
cd "$(dirname "$0")/../.." || exit 1
R=$(pwd); L=/tmp/4k/run; mkdir -p $L; FAIL=0
stop_all() { pkill -f "node dist/server""\.js" 2>/dev/null; pkill -f "node dist/vote""\.js" 2>/dev/null; pkill -f "mockObsServer""\.ts" 2>/dev/null; sleep 1; }
fresh() { stop_all; rm -rf "$1"; mkdir -p "$1"; (PORT=8787 DATA_DIR="$1" CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw nohup node dist/server.js > "$L/server.log" 2>&1 < /dev/null &)
  for i in $(seq 1 60); do curl -sf localhost:8787/api/health >/dev/null && break; sleep 0.25; done; }
run() { local name=$1; shift; local out="$L/$name.log"; "$@" < /dev/null > "$out" 2>&1; local rc=$?
  local sum=$(grep -E "[0-9]+ passed, [0-9]+ failed|^# (pass|fail)|scenes pass|PASS: [0-9]+/" "$out" | tail -1)
  [ -z "$sum" ] && sum="$(grep -c '^PASS' "$out") PASS lines, $(grep -c '^FAIL' "$out") FAIL lines"
  if [ $rc -ne 0 ] || grep -q '^FAIL' "$out"; then FAIL=1; echo "FAIL  $name  ($sum)  → $out"; else echo "ok    $name  ($sum)"; fi; }

echo "== build"; npm run build > $L/build.log 2>&1 || { echo "BUILD FAILED → $L/build.log"; exit 1; }
echo "== unit"
for t in tests/*.test.ts; do run "unit-$(basename $t .test.ts)" npx tsx $t; done
echo "== 4K suites"
fresh /tmp/od4k; run vis-capture env OD_STATE=/tmp/od4k/state.json python3 e2e-rig/4k/vis.py capture rc both
run vis-1080-and-4k-vs-original python3 e2e-rig/4k/vis.py compare base rc both
run vis-layout-equivalence python3 e2e-rig/4k/vis.py equiv rc
fresh /tmp/od4k; run output-basics env OD_STATE=/tmp/od4k/state.json python3 e2e-rig/4k/output_e2e.py
fresh /tmp/od4k; run gpu-artifacts env OD_STATE=/tmp/od4k/state.json python3 e2e-rig/4k/gpu_artifacts.py
bash e2e-rig/4k/fixture.sh "$R" >/dev/null 2>&1; run scene-audit-30 env OD_STATE=/tmp/od4k/state.json python3 e2e-rig/4k/scene_audit.py --doc
bash e2e-rig/4k/fixture.sh "$R" >/dev/null 2>&1; run transient-sizes env OD_STATE=/tmp/od4k/state.json python3 e2e-rig/4k/transient_sizes.py
run asset-report python3 e2e-rig/4k/asset_report.py
bash e2e-rig/4k/fixture.sh "$R" >/dev/null 2>&1; run camera-quality env OD_STATE=/tmp/od4k/state.json python3 e2e-rig/4k/camera_e2e.py
bash e2e-rig/4k/fixture.sh "$R" >/dev/null 2>&1; run rerender env OD_STATE=/tmp/od4k/state.json python3 e2e-rig/4k/rerender_check.py
stop_all; run off-air-pausing python3 e2e-rig/4k/suspend_e2e.py
stop_all; run obs-4k-canvas python3 e2e-rig/4k/obs4k_e2e.py
stop_all; run asset-replacements python3 e2e-rig/4k/replace_e2e.py
stop_all; run perf-bench python3 e2e-rig/4k/perf_bench.py --json /tmp/4k/perf-rc.json
echo "== bracket + audience (2.0 polish)"
bash e2e-rig/4k/fixture.sh "$R" >/dev/null 2>&1; run bracket-transitions env OD_STATE=/tmp/od4k/state.json python3 e2e-rig/bracket/bracket_e2e.py /tmp/4k/bracket
bash e2e-rig/4k/fixture.sh "$R" >/dev/null 2>&1; run bracket-sheet-sizes python3 e2e-rig/bracket/sheet_e2e.py /tmp/4k/bracket
if pg_isready -q -h 127.0.0.1 -p 5433; then
  stop_all; run audience-workflow python3 e2e-rig/audience/aud_e2e.py
  stop_all; run mvp-render python3 e2e-rig/audience/mvp_render.py
  stop_all; run mvp-modes python3 e2e-rig/audience/mvp_modes_e2e.py
  stop_all; run durable-storage python3 e2e-rig/persist/persist_e2e.py
else echo "skip  audience suites (no Postgres on 127.0.0.1:5433)"; fi
echo "== existing suites"
fresh /tmp/oddata; run broadcast-workflow-e2e_ws python3 e2e-rig/2.1/e2e_ws.py
fresh /tmp/oddata; run camera-sync python3 e2e-rig/cams/camsync.py regress
# OBS UI + docks against the mock (port 4460, password obspw)
stop_all; rm -rf /tmp/oddata-obs; mkdir -p /tmp/oddata-obs
(PORT=8787 DATA_DIR=/tmp/oddata-obs CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw nohup node dist/server.js > $L/obs-srv.log 2>&1 < /dev/null &); sleep 3; stop_all
python3 -c "import json;p='/tmp/oddata-obs/state.json';s=json.load(open(p));s['obsUrl']='ws://127.0.0.1:4460';s['obsPassword']='obspw';json.dump(s,open(p,'w'))"
(nohup npx tsx e2e-rig/obs/mockObsServer.ts 4460 obspw > $L/mock.log 2>&1 < /dev/null &); sleep 4
(PORT=8787 DATA_DIR=/tmp/oddata-obs CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw nohup node dist/server.js > $L/obs-srv.log 2>&1 < /dev/null &); sleep 3
run obs-ui python3 e2e-rig/obs/ui_e2e.py
run obs-docks python3 e2e-rig/obs/dock_e2e.py
stop_all
echo; [ $FAIL -eq 0 ] && echo "ALL SUITES PASS" || echo "SOME SUITES FAILED"
exit $FAIL
