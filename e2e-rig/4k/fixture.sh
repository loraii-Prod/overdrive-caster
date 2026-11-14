#!/bin/bash
# Fresh Overdrive server on :8787 (DATA_DIR=/tmp/od4k) with the 4K test fixture: a player card and a story (for the
# spotlight scene). Everything else is seeded through the API by scene_audit.py.  Usage: e2e-rig/4k/fixture.sh [repo]
R=${1:-/home/claude/overdrive-caster}
bash "$(dirname "$0")/server.sh" "$R" && true || {
  pkill -f "node dist/server.js"; sleep 1; rm -rf /tmp/od4k; mkdir -p /tmp/od4k
  (cd $R && PORT=8787 DATA_DIR=/tmp/od4k CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw nohup node dist/server.js > /tmp/od4k.log 2>&1 &); sleep 3; }
pkill -f "node dist/server.js"; sleep 1.5
python3 - <<'PY'
import json
p = '/tmp/od4k/state.json'; s = json.load(open(p))
s['players'] = [{'id': 'p-fixture', 'name': 'Matías "Tornado" Ferreira', 'input': 'Keyboard', 'camera': 'Cam 1', 'style': 'Tech', 'age': '22',
                 'favPlayer': 'GranaDy', 'funFact': 'Has finished every Cup of the Day since 2021', 'rival': 'Kenji Watanabe', 'photo': '', 'ingame': 'Tornado', 'vdo': ''}]
s['stories'] = [{'id': 's-fixture', 'kind': 'rivalry', 'title': 'Third final in a row', 'text': 'Both teams met in the last two Major finals; each won one.'}]
s['wildcard']['teams'] = ['Solary', 'Nexus Esports', 'Karmine Corp', 'BIG', 'Team Vitality', 'Elevate', 'Sinners', 'Joka Esports']
json.dump(s, open(p, 'w'))
PY
(cd $R && PORT=8787 DATA_DIR=/tmp/od4k CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw nohup node dist/server.js >> /tmp/od4k.log 2>&1 &)
for i in $(seq 1 50); do curl -sf localhost:8787/api/health >/dev/null && break; sleep 0.2; done
