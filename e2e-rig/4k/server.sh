# fresh server on :8787 from the given dist folder; prints nothing
pkill -f "node dist/server.js" 2>/dev/null; sleep 1; rm -rf /tmp/od4k; mkdir -p /tmp/od4k
cd ${1:-/home/claude/overdrive-caster} && (PORT=8787 DATA_DIR=/tmp/od4k CONTROLLER_PASSWORD=testpw ADMIN_PASSWORD=adminpw nohup node dist/server.js > /tmp/od4k.log 2>&1 < /dev/null &)
for i in $(seq 1 50); do curl -sf localhost:8787/api/health >/dev/null && break; sleep 0.2; done
