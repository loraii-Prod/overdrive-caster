#!/bin/bash
# Real vote service on a real PostgreSQL 16 (port 5433, trust auth) + mock OBS + Overdrive with VOTE_URL, then the
# online MVP e2e. Usage: bash e2e-rig/mvp4/run-online.sh <build dir with dist/ (incl. dist/vote.js) and mockobs.mjs>
D=${1:-/home/claude/build}; R=$(cd "$(dirname "$0")/../.." && pwd); PG=/usr/lib/postgresql/16/bin
pkill -f "node dist/server.js"; pkill -f "node dist/vote.js"; pkill -f "mockobs.mjs"; sleep 0.8; rm -rf /tmp/oddata && mkdir -p /tmp/oddata
if ! $PG/pg_isready -h 127.0.0.1 -p 5433 -q; then mkdir -p /tmp/pgdata && chown postgres /tmp/pgdata
  [ -f /tmp/pgdata/PG_VERSION ] || su postgres -c "$PG/initdb -D /tmp/pgdata -A trust -U postgres" >/dev/null
  su postgres -c "$PG/pg_ctl -D /tmp/pgdata -o '-p 5433 -k /tmp' -l /tmp/pg.log start" >/dev/null; sleep 2; fi
psql -h 127.0.0.1 -p 5433 -U postgres -qc "drop database if exists vote" ; psql -h 127.0.0.1 -p 5433 -U postgres -qc "do \$\$ begin if not exists (select from pg_roles where rolname='vote') then create role vote login; end if; end \$\$"
psql -h 127.0.0.1 -p 5433 -U postgres -qc "create database vote owner vote"
SECRET=e2e-secret-0123456789abcdefghij
(cd $D && DATABASE_URL=postgres://vote@127.0.0.1:5433/vote VOTE_SECRET=$SECRET VOTE_DEV_LOGIN=1 PORT=8790 setsid nohup node dist/vote.js > /tmp/vote.log 2>&1 < /dev/null &)
(cd $D && setsid nohup node mockobs.mjs 4455 > /tmp/mockobs.log 2>&1 < /dev/null &); sleep 1
(cd $D && PORT=8787 DATA_DIR=/tmp/oddata CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw OBS_WS_URL=ws://127.0.0.1:4455 VOTE_URL=http://127.0.0.1:8790 VOTE_SECRET=$SECRET VOTE_PUBLIC_URL=https://overdrive-vote.onrender.com/vote setsid nohup node dist/server.js > /tmp/server.log 2>&1 < /dev/null &)
for i in $(seq 1 50); do curl -sf localhost:8787/api/health >/dev/null && curl -sf localhost:8790/healthz >/dev/null && break; sleep 0.2; done; sleep 2
node "$R/e2e-rig/mvp3/obs-build.mjs" > /dev/null
python3 -I -u "$R/e2e-rig/mvp4/mvp_online_e2e.py"
