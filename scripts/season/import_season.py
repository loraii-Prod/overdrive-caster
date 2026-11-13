"""Builds public/season/overdrive-2026.json, the official offline OverDrive 2026 dataset, from read-only exports of the two
verified Google Sheets (season-data/source/2026/). Nothing is guessed: a name that cannot be linked to a team record by
explicit evidence (same name, the sheet's own team_id, or the sheet's previous-name column) stays its own entry and
is listed in the report for a human decision. Run: python3 scripts/season/import_season.py  (writes the JSON + report)

Sources
  A. "OverDrive 2026 tinySheet"  1wvKS0QsGqGUXCM2upmuFVw4pKUPPwYGi-D1o21v62gU  (Split 1 league in full detail)
  B. overdrivegg.com data sheet   1SgnXorS23IvBM2dbie_QOc756wnOTjqCvx3U2ensfi4  (WEBSITE_* tabs: Split 2, Wildcard,
     Open Qualifiers, Continentals, teams, standings, Overpoints, articles)
Both were read on 13 Nov 2026 through the sheets' read-only query endpoint; the sheets were not modified.
"""
import csv, hashlib, json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'season-data', 'source', '2026')
OUT = os.path.join(ROOT, 'public', 'season', 'overdrive-2026.json')  # copied into dist/client by every build: offline, no Sheets/Render at runtime
REPORT = os.path.join(ROOT, 'season-data', 'IMPORT-REPORT-2026.md')
LOGO_DIR = os.path.join(ROOT, 'public', 'brand', 'overdrive', 'teams')

issues = defaultdict(list)  # section -> lines
def note(section, line): issues[section].append(line)

def rd(name): return os.path.join(SRC, name)
def csv_rows(name, skip=0):
    with open(rd(name), encoding='utf-8') as f:
        rows = list(csv.reader(f))[skip:]
    head, body = rows[0], rows[1:]
    return [dict(zip(head, r)) for r in body if any(c.strip() for c in r)]
def pipe_rows(name): return [l.rstrip('\n').split('|') for l in open(rd(name), encoding='utf-8') if l.strip()]
def date_iso(d):
    m = re.match(r'(\d{1,2})[./](\d{1,2})[./](\d{4})$', d.strip())
    return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}' if m else (d.strip() or None)
def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
def key(s): return re.sub(r'\s+', ' ', s.strip()).lower()

# ------------------------------------------------------------------ teams (source B, the only team registry with ids)
teams, by_key = {}, {}
for p in pipe_rows('teams.txt'):
    p += [''] * (14 - len(p))
    tid, name, tag, status, prev = p[:5]
    roster = []
    for i, role in ((5, 'player'), (7, 'player'), (9, 'sub'), (11, 'sub')):
        if p[i].strip(): roster.append({'name': p[i].strip(), 'nationality': p[i + 1].strip() or None, 'role': role})
    teams[tid] = {'id': tid, 'name': name, 'tag': tag or None, 'status': status, 'previousNames': [prev] if prev else [], 'roster': roster,
                  'notes': p[13].strip() or None, 'logo': None, 'aliases': []}
for t in teams.values():
    if key(t['name']) in by_key:
        o = teams[by_key[key(t['name'])]]
        note('Duplicates', f"Two team records named “{t['name']}”: {o['id']} ({o['status']}) and {t['id']} ({t['status']}), same players. Kept both as in the source; names resolve to the {o['status']} one.")
    else: by_key[key(t['name'])] = t['id']
prev_index = defaultdict(list)
for t in teams.values():
    for pn in t['previousNames']: prev_index[key(pn)].append(t['id'])

unresolved = Counter()
link_log = {}
# Split 1 entries whose names no team record carries (not even as a previous name). They get their own stable ids;
# a successor is only *suggested* (roster overlap) and must be confirmed by a human.
PROVISIONAL = {'fut': ('S1_FUT', 'FUT', 'TEAM_0004', 'Nayko (Split 1 FUT roster) plays for Weibo x FUT'),
               'navi': ('S1_NAVI', 'NAVI', 'TEAM_0006', 'mime (Split 1 Navi roster) plays for NAVI x Joel')}
for k, (pid, nm, succ, why) in PROVISIONAL.items():
    teams[pid] = {'id': pid, 'name': nm, 'tag': None, 'status': 'split1-only', 'previousNames': [], 'roster': [], 'notes': None, 'logo': None, 'aliases': [],
                  'suggestedSuccessor': {'team': succ, 'evidence': why, 'confirmed': False}}
    by_key[k] = pid
    note('Needs your decision', f'Split 1 “{nm}” has no team record in the site sheet: stored as {pid}. Suggested successor {succ} ({why}) — not linked until you confirm.')
id_evidence = {}  # name -> team_id, from rows of source B that carry both
def resolve(name, ctx):
    """Team id for a name as written in a source, or None (kept as written, reported)."""
    n = name.strip()
    if not n: return None
    k = key(n)
    if k in id_evidence:
        return id_evidence[k]
    if k in by_key:
        tid = by_key[k]
        if prev_index.get(k) and tid not in prev_index[k]:
            link_log.setdefault(n, f"“{n}” → {tid} {teams[tid]['name']} (current name) — but {', '.join(prev_index[k])} also lists “{n}” as a previous name: check which one played {ctx}")
        elif n != teams[tid]['name']:
            link_log.setdefault(n, f"“{n}” → {tid} {teams[tid]['name']} (same name, different capitalisation)")
        return tid
    if len(prev_index.get(k, [])) == 1:
        tid = prev_index[k][0]; link_log.setdefault(n, f"“{n}” → {tid} {teams[tid]['name']} (the sheet lists “{n}” as its previous name)")
        return tid
    unresolved[n] += 1
    return None

# ------------------------------------------------------------------ tournaments
tournaments = {}
def tour(tid, **kw):
    if tid not in tournaments: tournaments[tid] = {'id': tid, **kw}
    return tid
REG = {'oce': 'Oceasia', 'oceasia': 'Oceasia', 'am': 'Americas', 'americas': 'Americas', 'amercias': 'Americas', 'emea': 'EMEA'}
def circuit_tour(split, event):
    e = event.strip()
    m = re.match(r'(?:Open Qualifier|OQ)\s*(\d+)\s+(\w+)$', e)
    if m:
        reg = REG[m.group(2).lower()]
        if m.group(2).lower() == 'amercias': note('Corrections', f'“{e}” ({split}): spelled “Amercias” in the source, stored as Americas (original kept in sourceEvent)')
        return tour(f'od26-{split}-oq{m.group(1)}-{slug(reg)}', name=f'Open Qualifier {m.group(1)} {reg}', season=2026, split=split, kind='open-qualifier', region=reg)
    m = re.match(r'Continental (\w+) (Swiss Stage|Playoffs)$', e)
    if m:
        raw = m.group(1); reg = REG[raw.lower()]
        if raw.lower() == 'amercias': note('Corrections', f'“{e}” ({split}): spelled “Amercias” in the source, stored as Americas (original kept in sourceEvent)')
        return tour(f'od26-{split}-continental-{slug(reg)}-{slug(m.group(2))}', name=f'Continental {reg} {m.group(2)}', season=2026, split=split, kind='continental', region=reg, stage=m.group(2))
    note('Unsupported structures', f'Unrecognised circuit event “{e}” ({split}) — skipped'); return None

SPLIT = {'spring': 1, 'fall': 2, 'winter': 3}
tour('od26-s1-div1', name='Split 1 · Division 1', season=2026, split='s1', kind='league', division=1)
tour('od26-s1-div2', name='Split 1 · Division 2', season=2026, split='s1', kind='league', division=2)
tour('od26-s1-div1-playoffs', name='Split 1 · Division 1 Playoffs', season=2026, split='s1', kind='playoffs', division=1)
tour('od26-s1-promotion', name='Split 1 · Promotion', season=2026, split='s1', kind='promotion')
tour('od26-s1-barrage', name='Split 1 · Barrage', season=2026, split='s1', kind='barrage')
tour('od26-s2-div1', name='Split 2 · Division 1', season=2026, split='s2', kind='league', division=1)
tour('od26-s2-div2', name='Split 2 · Division 2', season=2026, split='s2', kind='league', division=2)
tour('od26-s2-div1-playoffs', name='Split 2 · Division 1 Playoffs', season=2026, split='s2', kind='playoffs', division=1)
tour('od26-s2-promotion-relegation', name='Split 2 · Promotion & Relegation', season=2026, split='s2', kind='promotion')
tour('od26-wildcard', name='Wildcard', season=2026, split='s3', kind='wildcard', dates=['2026-11-07', '2026-11-08'])
tour('od26-major', name='Major', season=2026, split='s3', kind='major', dates=['2026-11-21', '2026-11-22'], note='No Major teams or matches in either verified sheet yet (dates only).')
S1_STAGE = {'Div 1': 'od26-s1-div1', 'Div 2': 'od26-s1-div2', 'Div 1 Playoffs': 'od26-s1-div1-playoffs', 'Promo': 'od26-s1-promotion', 'Barrage': 'od26-s1-barrage'}
S2_EVENT = {'Division 1': 'od26-s2-div1', 'Division 2': 'od26-s2-div2', 'Division 1 Playoffs': 'od26-s2-div1-playoffs', 'Promotion & Relegation': 'od26-s2-promotion-relegation', 'Wildcard': 'od26-wildcard'}

# ------------------------------------------------------------------ matches
matches, seen_ids = [], Counter()
def side(name, ctx):
    return {'team': resolve(name, ctx), 'name': name.strip() or None}
def score(v):
    v = v.strip()
    return int(v) if v.isdigit() else (v or None)  # W / L / FF kept as written
def winner_of(a, b, sa, sb, explicit=''):
    if explicit:
        if key(explicit) == key(a): return 'a'
        if key(explicit) == key(b): return 'b'
    if isinstance(sa, int) and isinstance(sb, int): return None if sa == sb else ('a' if sa > sb else 'b')
    if sa == 'W' and sb != 'W': return 'a'
    if sb == 'W' and sa != 'W': return 'b'
    lost = ('L', 'FF')
    if sb in lost and sa not in lost and sa is not None: return 'a'
    if sa in lost and sb not in lost and sb is not None: return 'b'
    return None  # both forfeited / no result
def add_match(tid, src, a, b, sa, sb, date=None, time=None, status=None, winner='', code=None, tracks=None, extra=None):
    base = code or hashlib.sha1('|'.join([tid, date or '', a, b]).encode()).hexdigest()[:8]
    mid = f'{tid}:{base}'; seen_ids[mid] += 1
    if seen_ids[mid] > 1: mid = f'{mid}-{seen_ids[mid]}'  # same pairing twice on one day (brackets): order kept
    s_a, s_b = score(sa), score(sb)
    w = winner_of(a, b, s_a, s_b, winner)
    m = {'id': mid, 'tournament': tid, 'source': src, 'code': code, 'date': date_iso(date) if date else None, 'timeCest': time or None,
         'a': side(a, tid), 'b': side(b, tid), 'scoreA': s_a, 'scoreB': s_b, 'winner': w, 'status': status or None}
    if tracks: m['tracks'] = tracks
    if extra: m.update(extra)
    if not a.strip() or not b.strip(): m['emptySlot'] = True
    matches.append(m)

for p in pipe_rows('raw_fall_winter.txt'):
    for nm, i in ((p[4], p[2]), (p[5], p[3])):
        if i in teams and nm.strip():
            k = key(nm)
            if k in id_evidence and id_evidence[k] != i: note('Conflicts', f'Name “{nm}” carries two team_ids in the site sheet: {id_evidence[k]} and {i}')
            id_evidence.setdefault(k, i)
            if by_key.get(k) not in (None, i): link_log[nm] = f"“{nm}” → {i} {teams[i]['name']} (the site sheet's own team_id on Split 2 rows; the record named “{nm}” is {by_key[k]})"

# Split 1 league + playoffs (source A)
for r in csv_rows('split1_matches.csv'):
    tid = S1_STAGE.get(r['stage'])
    if not tid: note('Unsupported structures', f"Split 1 stage “{r['stage']}” not recognised — skipped"); continue
    trk = []
    for i in range(1, 6):
        v = r.get(f'track{i}', '').strip()
        if v:
            m = re.match(r'(\d+)-(\d+)$', v)
            trk.append({'n': i, 'pointsA': int(m.group(1)), 'pointsB': int(m.group(2))} if m else {'n': i, 'raw': v})
    add_match(tid, 'A', r['team_a'], r['team_b'], r['score_a'], r['score_b'], r['date'], r['time_cest'], 'completed' if r['winner'] else None, r['winner'], r['match_code'], trk,
              {'admin': r['admin'] or None, 'comment': r['comment'] or None, 'week': r['played_week'] or None, 'trackData': r['track_data'] or None})
# Split 2 + Wildcard (source B)
for p in pipe_rows('raw_fall_winter.txt'):
    p += [''] * (27 - len(p))
    split, ev, ida, idb, ta, tb, date, time, st, win, sa, sb = p[:12]
    tid = S2_EVENT.get(ev)
    if not tid: note('Unsupported structures', f'{split} event “{ev}” not recognised — skipped'); continue
    trk = []
    for i in range(5):
        n, x, y = p[12 + 3 * i: 15 + 3 * i]
        if n or x or y: trk.append({'n': i + 1, 'map': n or None, **({'pointsA': int(x), 'pointsB': int(y)} if x.isdigit() and y.isdigit() else {}), **({} if (x or y) else {'note': 'track named, no score in source'})})
    a = ta or ('BYE' if ida == 'BYE' else ''); b = tb or ('BYE' if idb == 'BYE' else '')
    m_a = ida if ida in teams else None; m_b = idb if idb in teams else None
    add_match(tid, 'B', a, b, sa, sb, date, time, st.lower() or None, win, None, trk)
    mm = matches[-1]
    for s, sid in (('a', m_a), ('b', m_b)):  # the sheet's own team_id wins over name matching
        if sid and mm[s]['team'] != sid:
            note('Conflicts', f"{mm['id']}: name “{mm[s]['name']}” resolves to {mm[s]['team']} but the sheet's team_id is {sid}; team_id used")
            mm[s]['team'] = sid
# Open Qualifiers + Continentals (source B)
for p in pipe_rows('raw_fall_circuit.txt'):
    sp, ev, a, b, d, st, sa, sb = p
    tid = circuit_tour('s2', ev)
    if tid: add_match(tid, 'B', a, b, sa, sb, d, None, st.lower() or None, '', None, None, {'sourceEvent': ev})
for p in pipe_rows('raw_spring_continentals.txt'):
    ev, a, b, d, sa, sb = p
    tid = circuit_tour('s1', ev)
    if tid: add_match(tid, 'B', a, b, sa, sb, d, None, None, '', None, None, {'sourceEvent': ev})
for p in pipe_rows('raw_spring_oq.txt'):
    ev, a, b, d, sa, sb = p
    tid = circuit_tour('s1', ev)
    if tid: add_match(tid, 'B', a, b, sa, sb, d, None, None, '', None, None, {'sourceEvent': ev})

# ------------------------------------------------------------------ standings, placements, ranking
standings = []
for r in csv_rows('standings.csv'):
    sp = 's1' if r['split'].startswith('spring') else 's2'
    tid = f"od26-{sp}-div{r['division'].split()[-1]}"
    standings.append({'tournament': tid, 'rank': int(r['rank']), 'team': resolve(r['team'], tid), 'name': r['team'], 'matches': int(r['matches']), 'w': int(r['w']), 'l': int(r['l']),
                      'tracksW': int(r['tracks_w']), 'tracksL': int(r['tracks_l']), 'diff': int(r['diff']), 'points': int(r['points']),
                      'playoffFinish': r['playoff_finish'] or None, 'overpoints': int(r['overpoints']) if r['overpoints'].isdigit() else None, 'source': 'B'})
weekly = []
for r in csv_rows('split1_standings.csv', skip=1):
    weekly.append({'tournament': f"od26-s1-div{r['division'].split()[-1]}", 'snapshot': r['snapshot'], 'rank': int(r['rank']), 'seed': int(r['seed']) if r['seed'].isdigit() else None,
                   'team': resolve(r['team'], 'Split 1'), 'name': r['team'], 'matches': int(r['matches']), 'w': int(r['w']), 'l': int(r['l']), 'tracksW': int(r['tracks_w']),
                   'tracksL': int(r['tracks_l']), 'diff': int(r['diff']), 'points': int(r['points']), 'source': 'A'})
placements = []
for r in csv_rows('continentals_placements.csv'):
    sp = 's1' if r['split'] == 'spring' else 's2'
    placements.append({'tournament': circuit_tour(sp, r['event']), 'place': r['place'], 'team': r['team_id'] if r['team_id'] in teams else resolve(r['team'], r['event']), 'name': r['team'],
                       'overpoints': int(r['overpoints']) if r['overpoints'].isdigit() else None})
overpoints = [{'rank': int(r['rank']), 'team': r['team_id'] if r['team_id'] in teams else resolve(r['team'], 'Overpoints'), 'name': r['team'], 'overpoints': int(r['overpoints'])} for r in csv_rows('overpoints_ranking.csv')]

# ------------------------------------------------------------------ Split 1 rosters, player times, records (source A)
s1_rosters = []
for r in csv_rows('split1_rosters.csv'):
    s1_rosters.append({'tournament': f"od26-s1-div{r['division'].split()[-1]}", 'seed': int(r['seed']), 'team': resolve(r['team'], 'Split 1'), 'name': r['team'],
                       'players': [x for x in (r['player_1'], r['player_2']) if x], 'subs': [x for x in (r['sub_1'], r['sub_2']) if x]})
player_times = [{'match': f"{'od26-s1-div1' if r['match_code'].startswith('D1M') else 'od26-s1-div2' if r['match_code'].startswith('D2M') else ''}:{r['match_code']}", 'track': int(r['track_no']), 'map': r['track'],
                 'player': r['player'], 'bestMs': int(r['best_ms']) if r['best_ms'].isdigit() else None, 'avgMs': int(r['avg_ms']) if r['avg_ms'].isdigit() else None,
                 'rounds': int(r['rounds']) if r['rounds'].isdigit() else None, 'note': r['note'] or None} for r in csv_rows('split1_player_times.csv')]
track_records = [{'map': r['track'], 'record': r['record'], 'player': r['player'], 'match': r['match_code']} for r in csv_rows('split1_track_records.csv')]

# ------------------------------------------------------------------ players (unique by handle across both sources)
players = {}
def pkey(n): return re.sub(r'[^a-z0-9]', '', n.lower())
def add_player(name, nat, team, src, role):
    k = pkey(name)
    if not k: return
    p = players.setdefault(k, {'id': f'P_{k}', 'name': name, 'nationality': None, 'teams': []})
    if nat and not p['nationality']: p['nationality'] = nat
    elif nat and p['nationality'] != nat: note('Conflicts', f"Player {name}: nationality {p['nationality']} vs {nat}")
    e = {'team': team['id'] if isinstance(team, dict) else team, 'source': src, 'role': role}
    if e not in p['teams']: p['teams'].append(e)
for t in teams.values():
    for r in t['roster']: add_player(r['name'], r['nationality'], t, 'B: teams', r['role'])
for r in s1_rosters:
    for x in r['players']: add_player(x, None, r['team'] or f"name:{r['name']}", 'A: Split 1 roster', 'player')
    for x in r['subs']: add_player(x, None, r['team'] or f"name:{r['name']}", 'A: Split 1 roster', 'sub')

# ------------------------------------------------------------------ logos: only files that exist, linked by the Major list
major_ts = open(os.path.join(ROOT, 'shared', 'major.ts'), encoding='utf-8').read()
major_list = re.findall(r"\{ name: '([^']+)', how: '[^']*', logo: '([^']+)' \}", major_ts)
# display names used by Overdrive's Major list → team ids, with the evidence in the repo (shared/season.ts) or an exact name
MAJOR_ALIAS = {'FUT Esports': ('TEAM_0004', 'shared/season.ts: Split 2 "Runner-up (Weibo x FUT)"'), 'Natus Vincere': ('TEAM_0006', 'shared/season.ts: Split 2 "Div 2 · Champions" = NAVI x Joel in the site standings'),
               'All Gamers Global': ('TEAM_0002', 'shared/season.ts: Split 1 "Div 1 · 3rd (8–1)" = All Gamers in the site standings')}
logo_map = {}
for disp, logo in major_list:
    tid = by_key.get(key(disp)) or MAJOR_ALIAS.get(disp, (None,))[0]
    f = os.path.join(LOGO_DIR, f'{logo}.png')
    if not tid: note('Unmatched logos', f'Major team “{disp}” ({logo}.png) has no team record'); continue
    teams[tid]['logo'] = f'/brand/overdrive/teams/{logo}.png' if os.path.exists(f) else None
    if disp != teams[tid]['name']: teams[tid]['aliases'].append(disp)
    logo_map[disp] = tid
    if disp in MAJOR_ALIAS: link_log.setdefault(disp, f"Major list name “{disp}” → {tid} {teams[tid]['name']} ({MAJOR_ALIAS[disp][1]})")
digest = defaultdict(list)
for f in sorted(os.listdir(LOGO_DIR)):
    if f.endswith('.png'): digest[hashlib.md5(open(os.path.join(LOGO_DIR, f), 'rb').read()).hexdigest()].append(f)
for fs in digest.values():
    if len(fs) > 1: note('Unmatched logos', f"Identical image files: {', '.join(fs)} (the OverDrive mark) — COOK and FUT Esports show the OverDrive logo, not their own")
for t in teams.values():
    if t['logo'] and any(t['logo'].endswith(x) for x in ('cook.png', 'weiboxfut.png')): t['logoIsPlaceholder'] = True
unused = sorted(set(f[:-4] for f in os.listdir(LOGO_DIR) if f.endswith('.png')) - {l for _, l in major_list})
note('Unmatched logos', f"Logo files not linked to any team by the data or the code: {', '.join(unused)} (left unlinked: no source names a file)")

# ------------------------------------------------------------------ meta + write
articles = csv_rows('articles.csv'); socials = csv_rows('socials.csv')
broadcasts = csv_rows('split1_broadcasts.csv'); viewership = csv_rows('split1_viewership.csv')
data = {
    'schema': 'overdrive-dataset/1', 'season': 2026,
    'sources': {'A': {'title': 'OverDrive 2026 tinySheet', 'sheet': '1wvKS0QsGqGUXCM2upmuFVw4pKUPPwYGi-D1o21v62gU', 'read': '2026-11-13'},
                'B': {'title': 'overdrivegg.com data sheet (WEBSITE_* tabs)', 'sheet': '1SgnXorS23IvBM2dbie_QOc756wnOTjqCvx3U2ensfi4', 'read': '2026-11-13'}},
    'tournaments': list(tournaments.values()), 'teams': list(teams.values()), 'players': sorted(players.values(), key=lambda p: p['id']),
    'matches': matches, 'standings': standings, 'split1WeeklyStandings': weekly, 'split1Rosters': s1_rosters, 'continentalPlacements': placements,
    'overpoints': overpoints, 'split1PlayerTimes': player_times, 'split1TrackRecords': track_records,
    'split1Broadcasts': broadcasts, 'split1Viewership': viewership, 'articles': articles, 'socials': socials,
    'unresolvedNames': sorted(unresolved), 'majorDisplayNames': logo_map,
}
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ------------------------------------------------------------------ report
regions = sorted({t.get('region') for t in tournaments.values() if t.get('region')})
missing = Counter()
for m in matches:
    if m.get('emptySlot'): missing['matches with an empty team slot (bracket byes / unfilled)'] += 1
    if m['scoreA'] is None and m['scoreB'] is None: missing['matches without a score'] += 1
    if m['winner'] is None and not m.get('emptySlot'): missing['matches without a determinable winner'] += 1
    if not m['date']: missing['matches without a date'] += 1
    if m.get('trackData') == 'missing': missing['Split 1 matches whose track scores the sheet marks “missing”'] += 1
    for t in m.get('tracks', []):
        if t.get('note'): missing['tracks named without a score'] += 1
for t in teams.values():
    if not t['roster']: missing['teams without a roster in source B'] += 1
for p in players.values():
    if not p['nationality']: missing['players without a nationality'] += 1
by_t = Counter(m['tournament'] for m in matches)
L = ['# OverDrive 2026 dataset: import report', '', 'Built by `scripts/season/import_season.py` into `public/season/overdrive-2026.json` (served as /season/overdrive-2026.json and part of every build) from `season-data/source/2026/` (read-only exports of the two verified sheets, read 13 Nov 2026).', '',
     '## Counts', '', '| | |', '|---|---|',
     f'| Tournaments / stages | {len(tournaments)} |', f'| Regions | {len(regions)} ({", ".join(regions)}) |', f'| Teams (records with ids) | {len(teams)} |',
     f'| Players | {len(players)} |', f'| Matches | {len(matches)} |', f'| Standings rows | {len(standings)} (+{len(weekly)} Split 1 weekly snapshots) |',
     f'| Continental placements | {len(placements)} |', f'| Overpoints ranking | {len(overpoints)} |', f'| Split 1 player times / track records | {len(player_times)} / {len(track_records)} |', '',
     '## Matches per tournament', '', '| Tournament | Matches |', '|---|---|'] + [f"| {tournaments[k]['split'].upper()} · {tournaments[k]['name']} | {by_t.get(k, 0)} |" for k in sorted(tournaments, key=lambda k: (tournaments[k]['split'], tournaments[k]['kind'] not in ('league','playoffs','promotion','barrage','wildcard','major'), tournaments[k]['name']))] + [
     '', '## Name links made (evidence)', ''] + [f'- {v}' for v in sorted(link_log.values())] + [
     '', '## Names not linked to a team record (kept exactly as written)', '', f'{len(unresolved)} names, {sum(unresolved.values())} occurrences. No team record has this name or lists it as a previous name. BYE is a bracket bye, not a team.', '',
     ', '.join(f'{n} ({c})' for n, c in sorted(unresolved.items(), key=lambda x: (-x[1], x[0]))), '',
     '## Missing fields', ''] + [f'- {k}: {v}' for k, v in sorted(missing.items())] + ['']
if any(m['tournament'].startswith('od26-s1') and 'Rex Regum Qeon' in (m['a']['name'], m['b']['name']) for m in matches):
    note('Needs your decision', 'Split 1 Promotion “Rex Regum Qeon” (PRM03 vs Loading) is linked to TEAM_0023 BOMBO because the site sheet gives that name team_id TEAM_0023 on its Split 2 rows; TEAM_0073 is also named “Rex Regum Qeon” (retired, previously F11). Confirm.')
issues['Corrections'].append('“Amercias” (fall Open Qualifier / Continental event names in the site sheet) was normalised to “Americas” when the tab was exported on 13 Nov 2026.')
for sec in ('Needs your decision', 'Conflicts', 'Duplicates', 'Corrections', 'Unmatched logos', 'Unsupported structures'):
    L += [f'## {sec}', ''] + ([f'- {x}' for x in issues[sec]] or ['- none']) + ['']
open(REPORT, 'w', encoding='utf-8').write('\n'.join(L))
print(f'{len(tournaments)} tournaments, {len(regions)} regions, {len(teams)} teams, {len(players)} players, {len(matches)} matches, {len(unresolved)} unresolved names')

# ------------------------------------------------------------------ season lines for the Major teams (shared/seasonVerified.ts)
# Curated lines in shared/season.ts stay as they are; this only fills empty fields and replaces a line whose rank or
# record contradicts the verified standings. Every change is listed in the report.
season_ts = open(os.path.join(ROOT, 'shared', 'season.ts'), encoding='utf-8').read()
curated = {m.group(1): dict(re.findall(r"(split1|split2|wildcards|road): '([^']*)'", m.group(2))) for m in re.finditer(r"^\s*'?([^':]+?)'?: \{ (split1: .*?) \},$", season_ts, re.M)}
ORD = lambda n: f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
PO = {'1': 'Playoffs champions', '2': 'Playoffs runner-up', '3': 'Playoffs 3rd', '4': 'Playoffs 4th'}
def league_line(tid, split):
    for r in standings:
        if r['team'] == tid and r['tournament'].startswith(f'od26-{split}-div'):
            div = r['tournament'][-1]
            s = f"Div {div} · {ORD(r['rank'])} in the league ({r['w']}–{r['l']})"
            if r['playoffFinish'] in PO: s += f" · {PO[r['playoffFinish']]}"
            return s, r
    return None, None
def wildcard_line(tid):
    out = []
    for m in [m for m in matches if m['tournament'] == 'od26-wildcard']:
        for me, op in (('a', 'b'), ('b', 'a')):
            if m[me]['team'] == tid and m[op]['name'] not in (None, 'BYE'):
                f, a = m['score' + me.upper()], m['score' + op.upper()]
                res = 'W' if m['winner'] == me else 'L' if m['winner'] else '?'
                out.append(f"{res} {f}–{a} {m[op]['name']}" if isinstance(f, int) else f"{res} ({f}) {m[op]['name']}")
    return ' · '.join(out) or None
season_out, season_log = {}, []
for disp, tid in logo_map.items():
    cur = curated.get(disp, {})
    upd = {}
    for field, split in (('split1', 's1'), ('split2', 's2')):
        line, r = league_line(tid, split)
        if not line: continue
        if split == 's1' and any(t.get('suggestedSuccessor', {}).get('team') == tid for t in teams.values()):
            season_log.append(f"{disp} · {field}: left as curated (“{cur.get(field, '')}”) — which Split 1 team is its predecessor is not confirmed (see Needs your decision; the sheet's previous-name column gives {r['name']} {ORD(r['rank'])} ({r['w']}–{r['l']}))"); continue
        c = cur.get(field, '')
        if not c:
            upd[field] = line; season_log.append(f"{disp} · {field}: empty → “{line}” (verified standings{'' if r['name'] == teams[tid]['name'] else ', listed there as ' + r['name']})")
        else:
            rk = re.search(r'(\d+)(?:st|nd|rd|th)', c); wl = re.search(r'\((\d+)[–-](\d+)\)', c)
            bad = (rk and int(rk.group(1)) != r['rank']) or (wl and (int(wl.group(1)), int(wl.group(2))) != (r['w'], r['l']))
            if bad:
                upd[field] = line; season_log.append(f'{disp} · {field}: “{c}” contradicts the verified standings → “{line}”')
    wl_line = wildcard_line(tid)
    if wl_line and not cur.get('wildcards'):
        upd['wildcards'] = wl_line; season_log.append(f'{disp} · wildcards: empty → “{wl_line}” (from the verified Wildcard results)')
    if upd: season_out[disp] = upd
ts = ['// GENERATED by scripts/season/import_season.py from the verified OverDrive 2026 sheets (public/season/overdrive-2026.json). Do not edit by hand.',
      '// Only fields that were empty in shared/season.ts, or contradicted the verified standings, are listed here.',
      'import type { SeasonLine } from \'./season\';', '',
      'export const SEASON_VERIFIED: Record<string, Partial<SeasonLine>> = ' + json.dumps(season_out, ensure_ascii=False, indent=2) + ';', '']
open(os.path.join(ROOT, 'shared', 'seasonVerified.ts'), 'w', encoding='utf-8').write('\n'.join(ts))
rep = open(REPORT, encoding='utf-8').read()
rep += '\n## Season lines applied to the graphics (analyst desk “Head to head”, match intro roads)\n\n' + ('\n'.join(f'- {x}' for x in season_log) or '- none') + '\n'
open(REPORT, 'w', encoding='utf-8').write(rep)

# ------------------------------------------------------------------ player showcase rosters vs the verified rosters (report only)
prof = re.findall(r'handle: "([^"]+)", team: "([^"]+)"', major_ts)
lines = []
for disp, tid in logo_map.items():
    shown = sorted(h for h, t in prof if t == disp)
    verified = sorted(r['name'] for r in teams[tid]['roster'])
    s_k = {pkey(x) for x in shown}; v_k = {pkey(x) for x in verified}
    if s_k - v_k or (v_k - s_k and not s_k <= v_k):
        lines.append(f"{disp}: showcase profiles {', '.join(shown) or '—'} · verified roster ({teams[tid]['name']}) {', '.join(verified) or '—'}")
    else:
        extra = sorted(set(verified) - {x for x in verified if pkey(x) in s_k})
        lines.append(f"{disp}: showcase matches the verified roster" + (f" (roster also lists {', '.join(extra)}, no profile)" if extra else ''))
rep = open(REPORT, encoding='utf-8').read()
rep += '\n## Player showcase (shared/major.ts) vs verified rosters — not changed, for your review\n\n' + '\n'.join(f'- {x}' for x in lines) + '\n'
open(REPORT, 'w', encoding='utf-8').write(rep)
