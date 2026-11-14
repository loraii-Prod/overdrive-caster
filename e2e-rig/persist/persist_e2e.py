"""Persistence end to end: show state survives a "Render deploy" (the data folder deleted), assets live in the
storage bucket, snapshots restore, validation, private delivery, outages. Uses the real server, real Postgres and an
S3-compatible stand-in for R2 (s3rver, e2e-rig/persist/s3mock.mjs). Not real Cloudflare R2.
    python3 e2e-rig/persist/persist_e2e.py
"""
import io, json, os, urllib.parse, shutil, signal, struct, subprocess, sys, time, urllib.error, urllib.request, zlib
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = 'http://localhost:8787'; D = '/tmp/oddata-persist'; S3DIR = '/tmp/s3mock-persist'
DB = 'postgres://vote@127.0.0.1:5433/odstate'
ok = bad = 0
def check(name, cond, extra=''):
    global ok, bad
    ok += bool(cond); bad += not cond
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''), flush=True)
procs = {}
def env(**kw):
    e = {**os.environ, 'PORT': '8787', 'DATA_DIR': D, 'CONTROLLER_PASSWORD': 'testpw', 'ADMIN_PASSWORD': 'adminpw',
         'R2_ENDPOINT': 'http://127.0.0.1:4570', 'R2_BUCKET': 'overdrive-test', 'R2_ACCESS_KEY_ID': 'S3RVER', 'R2_SECRET_ACCESS_KEY': 'S3RVER',
         'STATE_DATABASE_URL': DB, 'STATE_SNAPSHOT_KEY': 'test-snapshot-key-0123456789'}
    for k, v in kw.items():
        if v is None: e.pop(k, None)
        else: e[k] = v
    return e
def start(**kw):
    procs['srv'] = subprocess.Popen(['node', 'dist/server.js'], cwd=ROOT, env=env(**kw), stdout=open('/tmp/persist-srv.log', 'a'), stderr=subprocess.STDOUT)
    end = time.time() + 20
    while time.time() < end:
        try: urllib.request.urlopen(B + '/api/health', timeout=1); time.sleep(0.5); return
        except Exception: time.sleep(0.2)
    raise RuntimeError('server did not start')
def stop(sig=signal.SIGTERM):
    p = procs.pop('srv', None)
    if p: p.send_signal(sig); p.wait(15)
def s3(on):
    if on and 's3' not in procs:
        procs['s3'] = subprocess.Popen(['node', 'e2e-rig/persist/s3mock.mjs', '4570', S3DIR], cwd=ROOT, stdout=open('/tmp/persist-s3.log', 'a'), stderr=subprocess.STDOUT); time.sleep(1.5)
    if not on and 's3' in procs: procs.pop('s3').terminate(); time.sleep(0.5)
def sql(q): return subprocess.run(['psql', DB, '-tAc', q], capture_output=True, text=True).stdout.strip()

class Http:
    def __init__(self):
        import http.cookiejar
        self.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect())
    def login(self): return self.req('POST', '/api/login', json.dumps({'password': 'testpw'}).encode(), {'content-type': 'application/json'})
    def req(self, m, p, body=None, h=None):
        r = urllib.request.Request(B + p, data=body, headers=h or {}, method=m)
        try: x = self.o.open(r, timeout=30); return x.status, x.read(), dict(x.headers)
        except urllib.error.HTTPError as e: return e.code, e.read(), dict(e.headers)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

def png(w, h, alpha=True):
    raw = b''.join(b'\x00' + bytes([200, 80, 20, 0 if (x < 4 and alpha) else 255] * 1)[:4] * 1 for x in range(h) for _ in [0]) if False else b''
    rows = b''.join(b'\x00' + b''.join(bytes([200, 80, 20, 0 if (alpha and (x + y) % 7 == 0) else 255]) for x in range(w)) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
def tok(): return json.load(open(f'{D}/state.json'))['apiToken']
def engine(cmd):
    r = urllib.request.Request(f'{B}/api/v1/engine?token={tok()}&source=manual', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(r).read())
def wcop(op):
    r = urllib.request.Request(f'{B}/api/v1/msg?token={tok()}', data=json.dumps({'t': 'wc', 'op': op}).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(r).read())
def state(): return json.load(open(f'{D}/state.json'))

def main():
    sql('drop table if exists od_state, od_state_history')
    shutil.rmtree(D, ignore_errors=True); shutil.rmtree(S3DIR, ignore_errors=True)
    s3(True); start()
    h = Http(); h.login()

    # ---- make a show: graphics, rundown, talent, portrait, media, music
    engine({'c': 'gfx-set', 'id': 'pickem', 'patch': {'title': 'Persisted title', 'step': 'd2'}}); engine({'c': 'gfx-publish', 'id': 'pickem'})
    engine({'c': 'rd-add', 'gfx': 'scoreboard', 'label': 'Persisted rundown item', 'preset': None})
    t1 = state()['talent'][0]['id']
    engine({'c': 'talent-edit', 'id': t1, 'name': 'Persisted Caster'}); engine({'c': 'seat', 'seat': 2, 'talent': t1})
    portrait = png(900, 1200)
    c, b, _ = h.req('POST', '/api/upload?role=portrait', portrait, {'content-type': 'image/png'})
    up = json.loads(b)
    check('portrait upload accepted, copied to storage, size read', c == 200 and up.get('stored') is True and up.get('w') == 900 and up.get('h') == 1200 and up.get('alpha') is True, (c, up))
    wcop({'k': 'photo', 'player': 'GranaDy', 'url': up['url']})
    mp4 = b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom' + os.urandom(200000)
    c, b, _ = h.req('POST', '/api/media', mp4, {'X-Filename': 'Intro reel.mp4', 'content-type': 'video/mp4'})
    media_url = json.loads(b)['items'][0]['url']
    check('media upload accepted', c == 200)
    mp3 = b'ID3\x03\x00\x00\x00\x00\x00\x00' + os.urandom(50000)
    c, b, _ = h.req('POST', '/api/music/analysis', mp3, {'x-filename': 'Desk bed.mp3', 'content-type': 'audio/mpeg'})
    check('music upload accepted', c == 200)
    time.sleep(2.5)
    reg = json.loads(h.req('GET', '/api/assets')[1])
    pr = next((a for a in reg['assets'] if a['path'] == up['url']), None)
    check('registry: portrait linked to the stable player id P_granady', pr and pr['role'] == 'portrait' and pr['ref'] == 'P_granady', pr)
    check('registry: storage keys are never sent to the browser', 'key' not in json.dumps(reg['assets'][0]) or all('key' not in a for a in reg['assets']))
    check('database mirror has the current state', 'Persisted title' in sql("select data::text from od_state where id='main'"))

    # ---- validation
    c, b, _ = h.req('POST', '/api/upload?role=portrait', b'not really a png at all' * 10, {'content-type': 'image/png'})
    check('validation: a file that only claims to be PNG is refused', c == 400, (c, b[:80]))
    c, b, _ = h.req('POST', '/api/upload?role=portrait', b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>x</script></svg>', {'content-type': 'image/svg+xml'})
    check('validation: SVG with script refused', c == 400, b[:80])
    c, b, _ = h.req('POST', '/api/upload?role=portrait', b'\x89PNG\r\n\x1a\n' + os.urandom(9 * 1024 * 1024), {'content-type': 'image/png'})
    check('validation: image over 8 MB refused (413)', c == 413, (c, b[:80]))
    c, b, _ = h.req('POST', '/api/music/analysis', portrait, {'x-filename': 'x.mp3', 'content-type': 'audio/mpeg'})
    check('validation: a PNG renamed .mp3 is refused as music', c == 400, (c, b[:80]))
    c, b, _ = Http().req('POST', '/api/upload', portrait, {'content-type': 'image/png'})
    check('uploads need a producer/admin sign-in', c == 401)

    # ---- simulated Render deploy: SIGTERM, data folder gone, new instance
    c, b, _ = h.req('POST', '/api/persist/snapshot')
    snap1 = json.loads(b).get('key', '')
    check('manual snapshot written to storage (encrypted)', c == 200 and snap1.endswith('.enc'), b[:120])
    stop(); shutil.rmtree(D); start()
    st = state()
    check('deploy: graphics configuration restored from the database', next(g for g in st['graphics'] if g['id'] == 'pickem')['config']['title'] == 'Persisted title')
    check('deploy: rundown restored', any(i['label'] == 'Persisted rundown item' for i in st['rundown']['items']))
    check('deploy: talent name + seat restored', st['talent'][0]['name'] == 'Persisted Caster' and st['seats'].get('2') == t1, st['seats'])
    check('deploy: portrait association kept (nickname key)', st['wildcard']['showcase']['photos'].get('granady') == up['url'])
    check('deploy: the local disk really was empty (no uploads folder content)', not os.path.exists(f"{D}/uploads/{up['url'].split('/')[-1]}"))
    anon = Http()
    c, b, hd = anon.req('GET', up['url'])
    check('deploy: the same portrait address still works (served from storage)', c == 200 and b == portrait and hd.get('Content-Type') == 'image/png', (c, len(b)))
    check('…and is cached back on disk for the next request', os.path.exists(f"{D}/uploads/{up['url'].split('/')[-1]}"))
    h = Http(); h.login()
    items = json.loads(h.req('GET', '/api/media')[1])['items']
    check('deploy: media library still lists the reel', any(i['url'] == media_url for i in items), items)
    c, b, hd = anon.req('GET', media_url, None, {'Range': 'bytes=100-199'})
    check('deploy: video streamed by the server with byte ranges (no expiring link, bucket private)', c == 206 and b == mp4[100:200] and 'location' not in {k.lower() for k in hd} and {k.lower(): v for k, v in hd.items()}.get('content-range', '').startswith('bytes 100-199/'), (c, len(b), hd))
    c, b, hd = anon.req('GET', media_url)
    check('…full file = the exact uploaded bytes', c == 200 and b == mp4, (c, len(b)))
    time.sleep(1.5)
    check('…and cached to disk in the background (keeps playing if storage goes away)', os.path.exists(f"{D}/media/{urllib.parse.unquote(media_url.split('/')[-1])}"))
    secs = json.loads(urllib.request.urlopen(B + '/api/music').read())['sections']
    check('deploy: music section still lists the bed', any('Desk bed' in t['name'] for t in secs['analysis']), secs['analysis'])
    check('unknown asset address: 404, nothing proxied', anon.req('GET', '/uploads/does-not-exist.png')[0] == 404)
    # draft assets stay private
    h.req('POST', '/api/assets/status', json.dumps({'path': up['url'], 'status': 'draft'}).encode(), {'content-type': 'application/json'})
    os.remove(f"{D}/uploads/{up['url'].split('/')[-1]}")
    check('draft asset: not served to the public', anon.req('GET', up['url'])[0] == 404)
    check('draft asset: still visible to a signed-in producer', h.req('GET', up['url'])[0] == 200)
    h.req('POST', '/api/assets/status', json.dumps({'path': up['url'], 'status': 'approved'}).encode(), {'content-type': 'application/json'})

    # ---- replace a portrait live (no rebuild / redeploy): new upload, same player
    p2 = png(600, 800, alpha=False)
    up2 = json.loads(h.req('POST', '/api/upload?role=portrait', p2, {'content-type': 'image/png'})[1])
    wcop({'k': 'photo', 'player': 'GranaDy', 'url': up2['url']}); time.sleep(0.5)
    check('replace: the player now points at the new portrait', state()['wildcard']['showcase']['photos']['granady'] == up2['url'])
    check('replace: no restart needed, served at once', anon.req('GET', up2['url'])[1] == p2)

    # ---- recovery from snapshot when the database is not there
    time.sleep(1.5)
    stop(); shutil.rmtree(D); start(STATE_DATABASE_URL=None)
    st = state()
    check('no database + wiped disk: restored from the latest storage snapshot', next(g for g in st['graphics'] if g['id'] == 'pickem')['config']['title'] == 'Persisted title')
    stop(); shutil.rmtree(D); start(STATE_DATABASE_URL=None, STATE_SNAPSHOT_KEY='wrong-key')
    check('wrong snapshot key: does not load garbage, starts clean', next(g for g in state()['graphics'] if g['id'] == 'pickem')['config']['title'] != 'Persisted title')
    stop(); shutil.rmtree(D); start()

    # ---- restore an older snapshot through the API
    h = Http(); h.login()
    engine({'c': 'gfx-set', 'id': 'pickem', 'patch': {'title': 'Changed after snapshot'}}); engine({'c': 'gfx-publish', 'id': 'pickem'}); time.sleep(1.5)
    c, b, _ = h.req('POST', '/api/persist/restore', json.dumps({'key': snap1, 'confirm': 'nope'}).encode(), {'content-type': 'application/json'})
    check('restore needs typed confirmation', c == 400)
    c, b, _ = h.req('POST', '/api/persist/restore', json.dumps({'key': snap1, 'confirm': 'RESTORE'}).encode(), {'content-type': 'application/json'})
    check('restore accepted', c == 200, b[:120])
    procs['srv'].wait(10); procs.pop('srv'); start()
    check('restore: the server came back with the snapshot state', next(g for g in state()['graphics'] if g['id'] == 'pickem')['config']['title'] == 'Persisted title')
    hist = sql("select string_agg(reason, ',') from od_state_history")
    check('history keeps a restore record and the shutdown copies', 'restore:' in hist and 'shutdown' in hist, hist[:200])

    # ---- outages
    s3(False)
    h = Http(); h.login()
    c, b, _ = h.req('POST', '/api/upload?role=logo', png(256, 256), {'content-type': 'image/png'})
    j = json.loads(b) if c == 200 else {}
    check('storage down: upload accepted but reported NOT durable (pending, with a warning)', c == 200 and j.get('durable') is False and j.get('state') == 'pending' and 'NOT yet in durable storage' in j.get('warning', ''), (c, b[:200]))
    hl = json.loads(h.req('GET', '/api/assets/health')[1])
    check('storage down: health shows it pending + the storage error (banner)', hl['pending'] >= 1 and hl['health']['ok'] is False, hl)
    c, b, _ = h.req('POST', '/api/upload?role=logo', png(128, 128), {'content-type': 'image/png'})
    lost_url = json.loads(b)['url']
    s3(True); time.sleep(50)
    reg = json.loads(h.req('GET', '/api/assets')[1])
    check('storage back: queued uploads copied automatically (backoff retry), now durable', all(next(a for a in reg['assets'] if a['path'] == u)['state'] == 'stored' for u in (j.get('url'), lost_url)))
    # lost: storage down, upload, then a deploy before it could be stored
    s3(False)
    c, b, _ = h.req('POST', '/api/upload?role=logo', png(96, 96), {'content-type': 'image/png'})
    gone = json.loads(b)['url']
    stop(); shutil.rmtree(f'{D}/uploads'); start()
    time.sleep(17)
    h = Http(); h.login()
    hl = json.loads(h.req('GET', '/api/assets/health')[1])
    rec = next((a for a in hl['attention'] if a['path'] == gone), None)
    check('deploy before storage came back: the upload is marked LOST (never shown as saved)', rec and rec['state'] == 'lost' and 'upload it again' in (rec.get('lastError') or ''), hl)
    check('…and its address answers 404, not a broken image', Http().req('GET', gone)[0] == 404)
    s3(True)
    c, b, _ = h.req('POST', '/api/assets/retry')
    check('manual retry: answered, lost stays lost (needs a new upload)', c == 200 and json.loads(b)['lost'] >= 1)
    stop(); start(STATE_DATABASE_URL='postgres://vote@127.0.0.1:5999/none')
    pr = json.loads(Http().req('GET', '/api/health')[1])
    h = Http(); h.login()
    stt = json.loads(h.req('GET', '/api/persist')[1])['status']
    check('database down at boot: the show still starts from the local copy', pr['ok'] and stt['database'] == 'error' and stt['restoredFrom'] == 'local', stt)
    check('…and reports it', 'database' in (stt.get('error') or ''))
    stop(); s3(False)
    print(f'\n{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)

if __name__ == '__main__':
    try: main()
    finally:
        stop()
        for k in list(procs): procs.pop(k).terminate()
