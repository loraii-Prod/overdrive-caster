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
