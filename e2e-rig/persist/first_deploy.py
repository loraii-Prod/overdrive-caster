"""Rehearsal of the production cut-over and rollback, on this machine, with the REAL 2.2.4 build (a9f6a24) as "live":
  1. live 2.2.4 with a show (talent, Wildcard portraits + map photo, media, music)
  2. backup: tar of DATA_DIR (what the Render shell gives us) + scripts/backup-live.ts (HTTP, read-only)
  3. scripts/migrate-live.ts --state → assets + encrypted show-state snapshot into the bucket
  4. "deploy" the new build on an EMPTY disk and EMPTY database → it boots with the live show, same addresses, same bytes
  5. a second deploy (disk wiped again) → still there (database + bucket)
  6. rollback: 2.2.4 + untar of the backup → exactly the pre-migration show
  7. 2.2.4 can also read a state.json written by the new build (extra fields ignored)
Needs: Postgres :5433, `npm run build` (new build in ./dist), the 2.2.4 build in /tmp/v224/dist, s3mock. Not real R2/Render.
    python3 e2e-rig/persist/first_deploy.py
"""
import hashlib, http.cookiejar, json, os, shutil, subprocess, sys, tarfile, time, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V224 = '/tmp/v224'; LIVE = 'http://localhost:8791'; NEW = 'http://localhost:8793'
DL, DN, S3D, BK = '/tmp/fd-live', '/tmp/fd-new', '/tmp/fd-s3', '/tmp/fd-backup'
DB = 'postgres://vote@127.0.0.1:5433/odstate3'; KEY = 'first-deploy-key-0123456789abcdef'
S3ENV = {'R2_ENDPOINT': 'http://127.0.0.1:4572', 'R2_BUCKET': 'overdrive-test', 'R2_ACCESS_KEY_ID': 'S3RVER', 'R2_SECRET_ACCESS_KEY': 'S3RVER'}
ok = bad = 0; procs = {}
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)
def up(name, cwd, port, data, **extra):
    e = {**os.environ, 'PORT': str(port), 'DATA_DIR': data, 'CONTROLLER_PASSWORD': 'testpw', 'ADMIN_PASSWORD': 'adminpw', **extra}
    procs[name] = subprocess.Popen(['node', 'dist/server.js'], cwd=cwd, env=e, stdout=open(f'/tmp/fd-{name}.log', 'a'), stderr=subprocess.STDOUT)
    for _ in range(100):
        try: urllib.request.urlopen(f'http://localhost:{port}/api/health', timeout=1); time.sleep(0.8); return
        except Exception: time.sleep(0.2)
    raise RuntimeError(name + ' did not start')
def down(name):
    p = procs.pop(name, None)
    if p: p.terminate(); p.wait(15)
def newenv(): return {**S3ENV, 'STATE_DATABASE_URL': DB, 'STATE_SNAPSHOT_KEY': KEY}
class C:
    def __init__(s, b):
        s.b = b; s.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        s.req('POST', '/api/login', json.dumps({'password': 'testpw'}).encode(), {'content-type': 'application/json'})
    def req(s, m, p, body=None, h=None):
        return s.o.open(urllib.request.Request(s.b + p, data=body, headers=h or {}, method=m)).read()
    def j(s, p): return json.loads(s.req('GET', p))
def tok(d): return json.load(open(f'{d}/state.json'))['apiToken']
def post(b, d, path, body): return urllib.request.urlopen(urllib.request.Request(f'{b}{path}?token={tok(d)}', data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')).read()
def sha(b): return hashlib.sha256(b).hexdigest()
sys.path.insert(0, os.path.join(ROOT, 'e2e-rig/persist'))
from persist_e2e import png

def show(base, d):
    """What must survive: names, seats, Wildcard portraits/map photos/teams, media playlist, music."""
    s = json.load(open(f'{d}/state.json'))
    return {'talent': [t['name'] for t in s['talent']], 'seats': json.dumps(s.get('seats')), 'photos': s['wildcard']['showcase']['photos'],
            'maps': s['wildcard']['mapPhotos'], 'teams': s['wildcard']['teams'], 'matches': json.dumps(s['wildcard']['matches'])[:4000],
            'events': [e['id'] for e in s['events']], 'playlist': s['media']['playlist'], 'apiToken': s['apiToken']}

def main():
    for d in (DL, DN, S3D, BK): shutil.rmtree(d, ignore_errors=True)
    subprocess.run(['psql', 'postgres://vote@127.0.0.1:5433/postgres', '-qc', 'create database odstate3'], capture_output=True)
    subprocess.run(['psql', DB, '-qc', 'drop table if exists od_state, od_state_history'], capture_output=True)
    procs['s3'] = subprocess.Popen(['node', 'e2e-rig/persist/s3mock.mjs', '4572', S3D], cwd=ROOT, stdout=open('/tmp/fd-s3.log', 'a'), stderr=subprocess.STDOUT); time.sleep(1.5)

    # 1. live 2.2.4 with a show
    up('live', V224, 8791, DL); os.makedirs(f'{DL}/music/events/overdrive/analysis', exist_ok=True)  # 2.2.4 bug: fresh music folder
    c = C(LIVE)
    p1 = json.loads(c.req('POST', '/api/upload', png(600, 800), {'content-type': 'image/png'}))['url']
    p2 = json.loads(c.req('POST', '/api/upload', png(500, 700), {'content-type': 'image/png'}))['url']
    mp = json.loads(c.req('POST', '/api/upload', png(1280, 720, False), {'content-type': 'image/png'}))['url']
    med = json.loads(c.req('POST', '/api/media', b'\x1aE\xdf\xa3' + os.urandom(400000), {'X-Filename': 'Opener.webm'}))['items'][0]['url']
    c.req('POST', '/api/music/analysis', b'ID3\x03\x00\x00\x00\x00\x00\x00' + os.urandom(90000), {'x-filename': 'Desk bed.mp3'})
    for op in ({'k': 'photo', 'player': 'GranaDy', 'url': p1}, {'k': 'photo', 'player': 'nabla', 'url': p2}, {'k': 'map-photo', 'id': 'india', 'url': mp}):
        post(LIVE, DL, '/api/v1/msg', {'t': 'wc', 'op': op})
    t = json.load(open(f'{DL}/state.json'))['talent']
    post(LIVE, DL, '/api/v1/engine', {'c': 'talent-edit', 'id': t[0]['id'], 'name': 'Live Caster One'})
    post(LIVE, DL, '/api/v1/engine', {'c': 'seat', 'seat': 2, 'talent': t[0]['id']})
    post(LIVE, DL, '/api/v1/engine', {'c': 'media-set', 'playlist': [med]})
    time.sleep(2)
    before = show(LIVE, DL)
    files = {}
    for root, _, fs_ in os.walk(DL):
        for f in fs_:
            rel = os.path.relpath(os.path.join(root, f), DL)
            if rel != 'state.json': files['/' + urllib.parse.quote(rel)] = sha(open(os.path.join(root, f), 'rb').read())
    check('live 2.2.4 show prepared (2 portraits, map photo, media, music, talent, seat, playlist)', len(files) == 5 and before['photos'] and before['maps'], (files, before['photos']))

    # 2. backups
    os.makedirs(BK)
    with tarfile.open(f'{BK}/data.tgz', 'w:gz') as tf: tf.add(DL, arcname='.')   # = `tar czf - -C $DATA_DIR .` in the Render shell
    r = subprocess.run(['npx', 'tsx', 'scripts/backup-live.ts', f'{BK}/http'], cwd=ROOT, env={**os.environ, 'OD_URL': LIVE, 'OD_PASSWORD': 'testpw'}, capture_output=True, text=True)
    man = json.load(open(f'{BK}/http/manifest.json'))
    check('backup-live.ts (read-only HTTP): every file byte-exact + state messages', r.returncode == 0 and {f['url']: f['sha256'] for f in man['files']} == files and 'wildcard' in man['messages'], (r.stderr[-300:], len(man['files'])))
    check('backup never contains the producer password', 'testpw' not in open(f'{BK}/http/messages.json').read() + open(f'{BK}/http/manifest.json').read())
    os.makedirs(f'{BK}/x'); tarfile.open(f'{BK}/data.tgz').extract('./state.json', f'{BK}/x')

    # 3. migrate (live stays up and unchanged)
    r = subprocess.run(['npx', 'tsx', 'scripts/migrate-live.ts', '--state', f'{BK}/x/state.json'], cwd=ROOT,
                       env={**os.environ, 'OD_URL': LIVE, 'OD_PASSWORD': 'testpw', 'STATE_SNAPSHOT_KEY': KEY, **S3ENV}, capture_output=True, text=True)
    check('migrate-live --state: assets + encrypted state snapshot written', r.returncode == 0 and 'show state seeded' in r.stdout, (r.stdout[-300:], r.stderr[-500:]))
    check('live server unchanged by backup + migration', show(LIVE, DL) == before)

    # 4. first deploy of the new build: empty disk, empty database
    up('new', ROOT, 8793, DN, **newenv())
    n = C(NEW)
    p = n.j('/api/persist')['status']
    after = show(NEW, DN)
    check('first deploy: show state restored from the seeded snapshot', p.get('restoredFrom') == 'snapshot' and after == before, (p.get('restoredFrom'), {k: (before[k], after[k]) for k in before if before[k] != after[k]}))
    time.sleep(3)
    reg = {a['path']: a for a in n.j('/api/assets')['assets']}
    check('first deploy: every uploaded file registered + durable', set(reg) >= set(files) and all(reg[u]['state'] == 'stored' for u in files), {u: reg.get(u, {}).get('state') for u in files})
    check('first deploy: same addresses serve the same bytes', all(sha(urllib.request.urlopen(NEW + u).read()) == h for u, h in files.items()))
    check('first deploy: portraits linked to stable ids (nabla provisional)', reg[p1]['ref'] == 'P_granady' and reg[p2]['ref'] == 'P_nabla', (reg[p1]['ref'], reg[p2]['ref']))
    check('first deploy: OBS/Stream Deck token unchanged (no re-pairing)', after['apiToken'] == before['apiToken'])
    # change something on the new build, then a second deploy
    post(NEW, DN, '/api/v1/engine', {'c': 'talent-edit', 'id': t[1]['id'], 'name': 'Added After Migration'})
    p3 = json.loads(n.req('POST', '/api/upload?role=portrait', png(640, 800), {'content-type': 'image/png'}))['url']
    post(NEW, DN, '/api/v1/msg', {'t': 'wc', 'op': {'k': 'photo', 'player': 'ZywOo', 'url': p3}})
    time.sleep(2.5); down('new'); shutil.rmtree(DN)

    # 5. second deploy
    up('new', ROOT, 8793, DN, **newenv())
    s2 = show(NEW, DN)
    check('second deploy: changes made after the migration survived (database)', 'Added After Migration' in s2['talent'] and s2['photos'].get('zywoo') == p3, s2['talent'][:3])
    check('second deploy: new upload served from the bucket', urllib.request.urlopen(NEW + p3).status == 200)
    down('new')

    # 6. rollback: 2.2.4 + untar of the pre-migration backup
    down('live'); shutil.rmtree(DL); os.makedirs(DL)
    tarfile.open(f'{BK}/data.tgz').extractall(DL)
    up('live', V224, 8791, DL)
    check('rollback: 2.2.4 + backup restore = exactly the pre-migration show', show(LIVE, DL) == before)
    check('rollback: every file back, byte-exact', all(sha(urllib.request.urlopen(LIVE + u).read()) == h for u, h in files.items()))
    down('live')

    # 7. 2.2.4 reading a state.json written by the new build (if someone rolls back with the newer file)
    shutil.rmtree(DL); shutil.copytree(DN, DL)
    up('live', V224, 8791, DL)
    s7 = show(LIVE, DL)
    check('2.2.4 boots on a state.json written by the new build (extra fields ignored, show kept)', 'Added After Migration' in s7['talent'] and s7['photos'].get('granady') == p1)
    down('live')
    print(f'{ok} passed, {bad} failed')

try: main()
finally:
    for k in list(procs): down(k) if k != 's3' else procs.pop(k).terminate()
sys.exit(1 if bad else 0)
