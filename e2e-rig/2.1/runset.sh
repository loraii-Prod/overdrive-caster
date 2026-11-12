#!/bin/bash
# runset.sh <dist-dir> <label-prefix> : starts that build on a fresh data dir and runs the capture scenarios
D=$1; P=$2
pkill -f "node .*dist/server.js"; sleep 1; rm -rf /tmp/oddata && mkdir /tmp/oddata
(cd $D && PORT=8787 DATA_DIR=/tmp/oddata CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw nohup node dist/server.js > /tmp/server.log 2>&1 &); sleep 2
cd /home/claude
S='{"c":"seat","seat":1,"talent":"t1"}'
python3 -I scripts/flashcap.py analyst-desk ${P}_panels '{"c":"gfx-set","id":"analyst-desk","patch":{"panel":"picks"}}' '{"c":"gfx-publish","id":"analyst-desk"}' '{"c":"gfx-set","id":"analyst-desk","patch":{"panel":"h2h"}}' '{"c":"gfx-publish","id":"analyst-desk"}' '{"c":"gfx-set","id":"analyst-desk","patch":{"panel":"player"}}' '{"c":"gfx-publish","id":"analyst-desk"}' '{"c":"gfx-set","id":"analyst-desk","patch":{"panel":"cams"}}' '{"c":"gfx-publish","id":"analyst-desk"}' > /dev/null 2>&1
python3 -I scripts/flashcap.py analyst-desk ${P}_desksolo '{"c":"seat","seat":4,"talent":"t4"}' '{"c":"seat","seat":5,"talent":"t5"}' '{"c":"gfx-set","id":"analyst-desk","patch":{"layout":"solo"}}' '{"c":"gfx-publish","id":"analyst-desk"}' '{"c":"gfx-set","id":"analyst-desk","patch":{"layout":"duo"}}' '{"c":"gfx-publish","id":"analyst-desk"}' > /dev/null 2>&1
python3 -I scripts/flashcap.py caster-desk ${P}_booth '{"c":"seat","seat":1,"talent":"t1"}' '{"c":"seat","seat":2,"talent":"t2"}' '{"c":"seat","seat":3,"talent":"t3"}' '{"c":"seat","seat":3,"talent":null}' '{"c":"seat","seat":2,"talent":null}' > /dev/null 2>&1
