// Player database + curated stories (fun facts, rivalries…) for spotlight graphics.
// Filled from the event's Google Sheet or the player table in the controller.

export interface Player {
  id: string;
  name: string;
  input: string; // Controller / Keyboard / Wheel
  camera: string; // Cam 1 / Cam 2 / Alt Cam 1 …
  style: string; // favourite map style
  age: string;
  favPlayer: string;
  funFact: string;
  rival: string;
  photo: string; // optional image URL
  /** In-game Trackmania name or login, if different from `name` (for cam auto-follow). */
  ingame: string;
  /** VDO.Ninja stream ID for this player's camera. */
  vdo: string;
}

export type StoryKind = 'fun' | 'rivalry' | 'favourite' | 'custom';

export interface Story {
  id: string;
  kind: StoryKind;
  title: string; // e.g. "Tommie & Pug"
  text: string;
}

export const STORY_LABELS: Record<StoryKind, string> = { fun: 'Fun fact', rivalry: 'Rivalry', favourite: 'Favourite players', custom: 'Did you know' };

/** What the spotlight graphic is showing right now (instant, not part of TAKE). */
export interface Spotlight {
  kind: 'player' | 'story';
  id: string;
  /** Epoch ms when it auto-hides, or null to stay until hidden. */
  until: number | null;
  at: number;
}



// ---------- validation ----------
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function sanitizePlayers(v: unknown): Player[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.slice(0, 500).map((x: any, i) => {
    let id = str(x?.id, 60) || `p${i}-${Date.now().toString(36)}`;
    while (seen.has(id)) id += '-';
    seen.add(id);
    const photo = str(x?.photo, 2000);
    return {
      id, name: str(x?.name, 40), input: str(x?.input, 30), camera: str(x?.camera, 30), style: str(x?.style, 80), age: str(x?.age, 8),
      favPlayer: str(x?.favPlayer, 60), funFact: str(x?.funFact, 240), rival: str(x?.rival, 160), photo: /^(https?:\/\/|\/)/.test(photo) ? photo : '', ingame: str(x?.ingame, 80), vdo: str(x?.vdo, 60).replace(/[^A-Za-z0-9_]/g, ''),
    };
  }).filter(p => p.name);
}

export function sanitizeStories(v: unknown): Story[] {
  if (!Array.isArray(v)) return [];
  const kinds: StoryKind[] = ['fun', 'rivalry', 'favourite', 'custom'];
  return v.slice(0, 200).map((x: any, i) => ({
    id: str(x?.id, 60) || `s${i}-${Date.now().toString(36)}`,
    kind: kinds.includes(x?.kind) ? x.kind : 'custom',
    title: str(x?.title, 60),
    text: str(x?.text, 240),
  })).filter(s => s.title || s.text);
}

/** Parse CSV pasted from Google Sheets (File → Download → CSV, or copy as TSV). */
export function parsePlayersTable(text: string): Player[] {
  const sep = text.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = (rows.shift() ?? []).map(h => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex(h => names.some(n => h.includes(n)));
  const c = { name: col('name'), input: col('input'), camera: col('camera'), style: col('style'), age: col('age'), fav: col('favourite player', 'favorite player'), fun: col('fun'), rival: col('rival') };
  if (c.name < 0) return [];
  return sanitizePlayers(rows.filter(r => r[c.name]?.trim()).map(r => {
    const g = (i: number) => (i >= 0 ? (r[i] ?? '').replace(/\s+/g, ' ').trim() : '');
    const name = g(c.name);
    return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, input: g(c.input), camera: g(c.camera), style: g(c.style), age: g(c.age), favPlayer: g(c.fav), funFact: g(c.fun), rival: g(c.rival), photo: '', ingame: '', vdo: '' };
  }));
}

/** Normalise a Trackmania name: strip $-formatting codes, punctuation, case and a trailing "tm". */
export function normName(s: string): string {
  return s
    .replace(/\$(\$|[0-9a-fA-F]{3}|[0-9a-fA-F]{1,2}|[lLhHpP]\[[^\]]*\]|[a-zA-Z<>])/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/tm$/, '');
}

/** Find the database player for an in-game name/login. */
export function matchPlayer(players: Player[], name: string, login = ''): Player | null {
  if (login) {
    const byLogin = players.find(p => p.ingame && p.ingame === login);
    if (byLogin) return byLogin;
  }
  const n = normName(name);
  if (!n) return null;
  const keys = (p: Player) => [p.ingame, p.name].filter(Boolean).map(normName).filter(Boolean);
  return players.find(p => keys(p).includes(n))
    ?? (n.length >= 4 ? players.find(p => keys(p).some(k => k.length >= 4 && (k.startsWith(n) || n.startsWith(k)))) ?? null : null);
}

/** VDO.Ninja links. Stream IDs are generated per player (letters/digits/_ only). */
export const VDO_HOST = 'https://vdo.ninja/';
export function newStreamId(p: Pick<Player, 'name'>): string {
  const base = p.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'player';
  return `bnl_${base}_${Math.random().toString(36).slice(2, 8)}`;
}
export function vdoPushUrl(p: Player, password = ''): string {
  return `${VDO_HOST}?push=${p.vdo}&webcam&label=${encodeURIComponent(p.name)}${password ? `&password=${encodeURIComponent(password)}` : ''}`;
}
/** Camera + mic link for a caster (they open it, pick devices, press Start). */
export function vdoCasterPushUrl(id: string, name: string, password = '', room = ''): string {
  // In a room: the talent see and hear each other (lighter video between guests: roombitrate), OBS views stay full quality.
  const r = room ? `&room=${encodeURIComponent(room)}&roombitrate=500` : '&autostart';
  return `${VDO_HOST}?push=${id}&webcam&label=${encodeURIComponent(name || 'Caster')}&quality=1${r}${password ? `&password=${encodeURIComponent(password)}` : ''}`;
}
export const newCasterStreamId = (slot: number) => `bnlcast${slot}_${Math.random().toString(36).slice(2, 8)}`;

export function vdoViewUrl(p: Pick<Player, 'vdo'>, password = '', params = ''): string {
  return `${VDO_HOST}?view=${p.vdo}${password ? `&password=${encodeURIComponent(password)}` : ''}${params}`;
}
/** Give every player a stream ID (keeps existing ones). */
export function ensureStreamIds(players: Player[]): Player[] {
  const used = new Set(players.map(p => p.vdo).filter(Boolean));
  return players.map(p => {
    if (p.vdo) return p;
    let id = newStreamId(p);
    while (used.has(id)) id = newStreamId(p);
    used.add(id);
    return { ...p, vdo: id };
  });
}
