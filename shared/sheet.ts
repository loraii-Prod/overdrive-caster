/** Read-only Google Sheet data (Overdrive-style master sheet). Nothing is ever written back. */
export interface SheetTeam { id: string; name: string; seed: number; players: string[]; logo: string }
export interface SheetMatch {
  id: string; bracket: string; side: 'winners' | 'losers' | 'grandfinal'; round: number;
  at: number | null; time: string;
  /** Start exactly as written in the sheet (e.g. "11/7/2026 15:00:00"), so clients can read it in their own time zone. */
  when?: string;
  t1: { id: string; name: string }; t2: { id: string; name: string };
  status: string; bo: number; s1: string; s2: string; winner: string;
}
export interface SheetState {
  /** Spreadsheet id + tab gid of the data tab; logos come from the "logos" tab when present. */
  id: string; gid: string; enabled: boolean;
  /** id is a "Publish to the web" id (docs.google.com/spreadsheets/d/e/<id>/pub…) rather than a document id. */
  pub?: boolean;
  featured: string | null;
  lastAt: number; error: string;
  title: string;
  teams: SheetTeam[]; matches: SheetMatch[];
}

export const emptySheet = (): SheetState => ({ id: '', gid: '', enabled: false, featured: null, lastAt: 0, error: '', title: '', teams: [], matches: [] });
/** OverDrive season sheet, off until the Major tab's link is pasted in (Tournament → Google Sheet). */
export const majorSheet = (): SheetState => ({ ...emptySheet(), id: '1wvKS0QsGqGUXCM2upmuFVw4pKUPPwYGi-D1o21v62gU', title: 'MAJOR' });

export function parseSheetUrl(url: string): { id: string; gid: string; pub: boolean } | null {
  const g = /[#&?]gid=(\d+)/.exec(url);
  // "File → Share → Publish to the web" link (what the standalone wildcard overlay used).
  const p = /\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,})/.exec(url);
  if (p) return { id: p[1], gid: g ? g[1] : '0', pub: true };
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(url);
  if (!m) return null;
  return { id: m[1], gid: g ? g[1] : '0', pub: false };
}

/** Link back to the sheet for the controller. */
export const sheetLink = (s: { id: string; gid: string; pub?: boolean }) =>
  !s.id ? '' : s.pub ? `https://docs.google.com/spreadsheets/d/e/${s.id}/pub?gid=${s.gid}&single=true&output=csv` : `https://docs.google.com/spreadsheets/d/${s.id}/edit#gid=${s.gid}`;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** "11/7/2026 15:00:00" (m/d/y) or "07.11.2026 15:00" (d.m.y) → local epoch ms. */
export function parseSheetDate(s: string): number | null {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s.trim());
  if (m) return new Date(+m[3], +m[1] - 1, +m[2], +(m[4] ?? 0), +(m[5] ?? 0)).getTime();
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s.trim());
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0)).getTime();
  return null;
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export function sheetTimeLabel(at: number | null): string {
  if (!at) return '';
  const d = new Date(at);
  return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Placeholder like "W R3_LB1" → "Winner R3 LB1". */
export function slotLabel(s: string): string {
  const m = /^([WL])\s+R(\d+)_(\w+)$/.exec(s.trim());
  if (!m) return s === 'BYE' ? 'BYE' : s || 'TBD';
  return `${m[1] === 'W' ? 'Winner' : 'Loser'} R${m[2]} ${m[3].replace(/(\D+)(\d*)/, '$1 $2').trim()}`;
}

/**
 * Parse the event data tab: blocks TEAMS (team_id, team_name, seed, player1..sub2),
 * PLAYERS (player_id, player_name, nationality, device) and MATCHES (match_id …).
 */
export function parseEventTab(rows: string[][]) {
  const header = rows[0] ?? [];
  const at = (name: string, from = 0) => header.indexOf(name, from);
  const tId = at('team_id'), pId = at('player_id'), mId = at('match_id');
  const teams: SheetTeam[] = []; const players: { id: string; name: string; country: string; device: string }[] = []; const matches: SheetMatch[] = [];
  for (const r of rows.slice(1)) {
    const g = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    if (tId >= 0 && g(tId) && g(tId + 1)) {
      const ps = [g(tId + 7), g(tId + 8), g(tId + 9), g(tId + 10)].filter(Boolean);
      teams.push({ id: g(tId), name: g(tId + 1), seed: Number(g(tId + 2)) || teams.length + 1, players: ps, logo: '' });
    }
    if (pId >= 0 && g(pId) && g(pId + 1)) players.push({ id: g(pId), name: g(pId + 1), country: g(pId + 3), device: g(pId + 4) });
    if (mId >= 0 && g(mId)) {
      const side = g(mId + 2) as SheetMatch['side'];
      const time = g(mId + 4);
      const ts = parseSheetDate(time);
      matches.push({
        id: g(mId), bracket: g(mId + 1), side: side === 'losers' || side === 'grandfinal' ? side : 'winners', round: Number(g(mId + 3)) || 1,
        at: ts, time: sheetTimeLabel(ts), when: time,
        t1: { id: g(mId + 5), name: g(mId + 6) || slotLabel(g(mId + 5)) }, t2: { id: g(mId + 7), name: g(mId + 8) || slotLabel(g(mId + 7)) },
        status: g(mId + 9) || 'not played', bo: Number(g(mId + 11)) || 0, s1: g(mId + 13), s2: g(mId + 14), winner: g(mId + 15),
      });
    }
  }
  return { teams, players, matches };
}

/**
 * Major bracket tab ("26S3 Major" layout): one row per team slot, header row with
 * match · helper · bracket · round · position · condition · origin · match_id · datetime · round_seed · team · score.
 * The sheet's codes differ from the app's Major ids; same 8-team double elimination, mapped 1:1:
 */
export const SHEET_MAJOR_IDS: Record<string, string> = {
  R1_UB1: 'R1_UB1', R1_UB2: 'R1_UB2', R1_UB3: 'R1_UB3', R1_UB4: 'R1_UB4',
  R2_UB1: 'R2_UB1', R2_UB2: 'R2_UB2', R3_UBF: 'R3_UB1',
  R2_LB1: 'R1_LB1', R2_LB2: 'R1_LB2', R3_LB1: 'R2_LB1', R3_LB2: 'R2_LB2',
  R4_LBF: 'R3_LB1', R5_CF: 'R4_LB1', R6_GF: 'R5_GF1',
};
/** "TEAM_0001 | BIG" → { id, name }; a placeholder like "W R1_UB1" → TBD (the app resolves it from results). */
function slotTeam(cell: string): { id: string; name: string } {
  const c = cell.trim();
  const m = /^(TEAM_\w+)\s*\|\s*(.+)$/.exec(c);
  if (m) return { id: m[1], name: m[2].trim() };
  if (/^[WL]\s+R\d+_\w+$/.test(c)) return { id: c, name: slotLabel(c) };
  return { id: c, name: c || 'TBD' };
}
/**
 * Read by content, not by heading position: on the live tab the codes sit a column off their "match"
 * heading, "origin" is split over two cells and the bracket-tree drawing shares the same rows. Per row:
 * the sheet code (R1_UB1 … R6_GF), then its slot "<code>_1|_2", then MATCH_…, the date, the round seed,
 * the team cell ("TEAM_0001 | BIG" or "W R1_UB1") and the score right after it.
 */
export function parseMajorBracketTab(rows: string[][]): { teams: SheetTeam[]; matches: SheetMatch[] } | null {
  const by = new Map<string, SheetMatch>(), teams: SheetTeam[] = [];
  const isDate = (x: string) => /^\d{1,2}[./]\d{1,2}[./]\d{4}/.test(x);
  for (const r of rows) {
    const c = r.map(x => (x ?? '').trim());
    // the slot cell ("R1_UB1_1") names the match and the position; the bare code must sit just before it
    const si = c.findIndex(x => { const m = /^(R\d_[A-Z]+\d*)_([12])$/.exec(x); return !!m && !!SHEET_MAJOR_IDS[m[1]]; });
    if (si < 0) continue;
    const [, code, posS] = /^(R\d_[A-Z]+\d*)_([12])$/.exec(c[si])!;
    if (!c.slice(Math.max(0, si - 3), si).includes(code)) continue; // not the bracket table (e.g. a tree label)
    const app = SHEET_MAJOR_IDS[code], pos = posS === '2' ? 2 : 1;
    const rest = c.slice(si + 1, si + 16);
    const sideRaw = rest.find(x => /^(winners|losers|grandfinal)$/i.test(x)) ?? 'winners';
    const side = (sideRaw.toLowerCase() === 'losers' ? 'losers' : sideRaw.toLowerCase() === 'grandfinal' ? 'grandfinal' : 'winners') as SheetMatch['side'];
    const mi = rest.findIndex(x => /^MATCH_\w+$/i.test(x)), di = rest.findIndex(x => isDate(x));
    const when = di >= 0 ? rest[di] : '', at = parseSheetDate(when);
    // team: first cell after the date (skipping the numeric round seed) that is a team or a W/L placeholder
    let ti = -1, seed = 0;
    for (let k = (di >= 0 ? di : mi) + 1; k > 0 && k < rest.length && k < (di >= 0 ? di : mi) + 4; k++) {
      if (/^\d+$/.test(rest[k]) && ti < 0 && !seed) { seed = Number(rest[k]); continue; }
      if (rest[k]) { ti = k; break; }
    }
    const t = ti >= 0 ? slotTeam(rest[ti]) : { id: '', name: 'TBD' };
    const sc = ti >= 0 && /^\d+$/.test(rest[ti + 1] ?? '') ? rest[ti + 1] : '';
    const m = by.get(app) ?? { id: mi >= 0 ? rest[mi] : app, bracket: app, side, round: Number(code[1]) || 1, at, time: sheetTimeLabel(at), when,
      t1: { id: '', name: 'TBD' }, t2: { id: '', name: 'TBD' }, status: '', bo: 0, s1: '', s2: '', winner: '' };
    if (pos === 1) { m.t1 = t; m.s1 = sc; } else { m.t2 = t; m.s2 = sc; }
    by.set(app, m);
    if (/^R1_UB\d$/.test(code) && /^TEAM_/.test(t.id) && !teams.some(x => x.id === t.id)) teams.push({ id: t.id, name: t.name, seed: seed || teams.length + 1, players: [], logo: '' });
  }
  if (!by.size) return null;
  for (const m of by.values()) if (m.s1 && m.s2 && m.s1 !== m.s2 && (+m.s1 > 0 || +m.s2 > 0)) m.status = 'scored';
  return { teams, matches: [...by.values()] };
}

/** Logos tab: team_id + logo_url_git (or logo) columns. */
export function parseLogos(rows: string[][]): Record<string, string> {
  const h = rows[0] ?? [];
  const id = h.indexOf('team_id'), git = h.indexOf('logo_url_git'), logo = h.indexOf('logo');
  const out: Record<string, string> = {};
  for (const r of rows.slice(1)) {
    const u = (r[git] || r[logo] || '').trim();
    if (r[id] && /^https:\/\//.test(u)) out[r[id].trim()] = u;
  }
  return out;
}

export function sanitizeSheet(v: any): SheetState {
  const d = emptySheet();
  if (!v || typeof v !== 'object') return d;
  return {
    id: typeof v.id === 'string' ? v.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) : '',
    gid: typeof v.gid === 'string' ? v.gid.replace(/\D/g, '').slice(0, 20) : '',
    enabled: v.enabled === true,
    pub: v.pub === true,
    featured: typeof v.featured === 'string' ? v.featured.slice(0, 40) : null,
    lastAt: Number(v.lastAt) || 0, error: typeof v.error === 'string' ? v.error.slice(0, 300) : '',
    title: typeof v.title === 'string' ? v.title.slice(0, 80) : '',
    teams: Array.isArray(v.teams) ? v.teams.slice(0, 256) : [], matches: Array.isArray(v.matches) ? v.matches.slice(0, 512) : [],
  };
}
