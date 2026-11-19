"""Realistic Major show state for the Producer screenshots / e2e: teams, a live match (2–1 in maps), the veto, a
finished match with its MVP prepared, the current track in progress, a starter rundown, talent in seats, OBS on the
caster desk with Studio Mode. Run against a fresh server + mock OBS with the scenes built."""
import json, subprocess, urllib.request
R = __file__.rsplit('/e2e-rig/', 1)[0]
def probe(msgs): return json.loads(subprocess.run(['node', f'{R}/e2e-rig/mvp4/probe.mjs', json.dumps(msgs)], capture_output=True, text=True).stdout)
W = lambda **op: {'t': 'wc', 'op': op}
S = lambda mid, side: W(k='score', id=mid, side=side, delta=1)
C = lambda **c: {'t': 'cmd', 'cmd': c}
urllib.request.urlopen('http://127.0.0.1:4456/studio-mode?on=1')
d = probe([W(k='teams', teams=['BIG', 'FUT Esports', 'Airwalkers', 'COOK', 'Ragnarok', 'Natus Vincere', 'rnboi', 'All Gamers Global']),
  S('R1_UB2', 1), S('R1_UB2', 2), S('R1_UB2', 1), S('R1_UB2', 1), {'wait': 1200},
  W(k='cast', id='R1_UB1'), S('R1_UB1', 1), S('R1_UB1', 2), S('R1_UB1', 1),
  *[W(k='veto', map=m) for m in ['india', 'uk', 'czech', 'egypt']],
  W(k='track-new', teamA='BIG', teamB='FUT Esports', mapId='egypt', mapNumber=4, pickedBy='FUT Esports pick'),
  *[W(k='track-round', ptsA=a, ptsB=b) for a, b in [(2, 1), (0, 3), (3, 0), (1, 1), (2, 1)]],
  C(c='sp-starter'),
  C(c='rd-add', gfx='scoreboard', label='Scoreboard'), C(c='rd-add', gfx='track', label='Track 4 progression'), C(c='rd-add', gfx='bracket', label='Bracket after QF1'),
  C(c='talent-add', name='Kameto', role='caster', seat=1), C(c='talent-add', name='Wirtual', role='caster', seat=2),
  C(c='talent-add', name='Bren', role='analyst', seat=4), C(c='talent-add', name='Papou', role='analyst', seat=5),
  C(c='scene-take', target='g:caster-desk', transition='cut'), {'wait': 800}])
bad = [a for a in d['acks'] if not a.get('ok')]
print('acks', len(d['acks']), 'failed', bad, '| mvp', d['mvp']['match'], d['poll'] and d['poll']['status'], '| pgm', d['obsProgram'])
