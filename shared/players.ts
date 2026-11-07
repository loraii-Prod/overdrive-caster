// Player database + curated stories (fun facts, rivalries…) for spotlight graphics.
// Seeded from the Benelux Pro League player sheet; editable in the controller.

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

const P = (name: string, input: string, camera: string, style: string, age: string, favPlayer = '', funFact = '', rival = ''): Player =>
  ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name, input, camera, style, age, favPlayer, funFact, rival, photo: '', ingame: '', vdo: '' });

export const BNL_PLAYERS: Player[] = [
  P('ThijnHD', 'Controller', 'Cam 1', 'Mixed', '16'),
  P('pedrobuddytm', 'Controller', 'Cam 2', 'Mixed / Tech', '16', 'Bren', 'The "buddy" part of my name is my dog\'s name'),
  P('RedTiger1512', 'Keyboard', 'Cam 1', 'Bobsleigh', '16', 'Wirtual'),
  P('Overtlion', 'Controller', 'Cam 1', 'Tech', '16', '', 'My favorite food is pizza', 'Darkest sentinel I guess, although he is just a bit too fast right now'),
  P('OwlsAreVeryCool', 'Keyboard', 'Cam 1', "I don't really have a favorite, probably ice", '17', 'NeoTako', 'I was born in England and lived there for the first 3 years of my life and 1 more when I was 7', 'Jortim or Treggeur'),
  P('SnappieTM', 'Controller', 'Cam 1', 'Mixed', '18', 'jdon', "I learned myself how to solve a Rubik's Cube in under a minute", 'Scrapie98'),
  P('Nieqtv', 'Wheel', 'Cam 1', 'Multiple: fullspeed, mixed, and of course altcar xd', '18', 'Granadyy', 'I used to be a keyboard player but switched to wheel around 1.5 years ago', 'The one and only rinte, who beat me in the race to get the snowb1 WR, which I ended up tying the day after'),
  P('lucasjande', 'Keyboard', 'Cam 1', '', '18', 'owlsareverycool', "I can solve a Rubik's cube", 'kebotm'),
  P('Gooddutchie', 'Controller', 'Cam 1', 'Dirt', '18', 'Spammiej', "It's my first time playing this kind of comp", 'Making div 2 :)'),
  P('yvbastel', 'Controller', 'Cam 1', 'Dirt', '18', 'Wirtual', '', 'First time playing so no rivals'),
  P('Tommie._', 'Keyboard', 'Cam 2', 'Tech', '19', 'Jan', "I go right on left turns more often than you'd think", 'Pug'),
  P('Yoshy-.', 'Keyboard', 'Cam 1', 'Old ice', '19'),
  P('FireLord.tm', 'Controller', 'Cam 1', 'Fullspeed', '19', 'Myself'),
  P('Beagle.3', 'Controller', 'Cam 1', 'Dirt / Mixed', '19'),
  P('RCinCHgamer02', 'Controller', 'Cam 1', 'Speedtech / Mixed', '20', '', "Dutch, yet doesn't even live in the Benelux area"),
  P('FootFungusTM', 'Controller', 'Cam 1', 'Dirt', '20'),
  P('CantEvenAim', 'Controller', 'Cam 1', 'Snowcar', '20', 'Myself', 'bla', 'balie'),
  P('DaniiiTM.', 'Controller', 'Cam 2', 'Mixed', '20', 'TIMMYS', 'I beat a 107 hour neoslide map and still suck at drifting', 'TIMMYS'),
  P('nolan.tm', 'Keyboard', 'Cam 1', 'Ice', '20', 'Epos or Mudda', "I'm getting a puppy in a month yayyyyyy", 'Cherry'),
  P('Flamyft', 'Keyboard', 'Cam 1', 'Tech', '21', 'Mime'),
  P('LeckSippi04', 'Controller', 'Cam 1', '', '21', 'Massa', 'I started a year ago from 0'),
  P('Bon.TM', 'Keyboard', 'Cam 1', 'Mixed', '21'),
  P('JTW..', 'Controller', 'Cam 1', 'Alles behalve ijs', '21'),
  P('Poepboer', 'Keyboard', 'Cam 2', 'Mixed', '21', 'Alex-w'),
  P('Rasg.', 'Controller', 'Cam 2', 'Mixed', '21', 'CarlJr', "I'm a teacher of maths"),
  P('Jortim', 'Keyboard', 'Cam 1', 'Desertcar', '21', 'CarlJr', '', 'Owlsareverycool'),
  P('Mitra-17', 'Controller', 'Cam 2', 'Ice', '21', 'Elconn', 'I make a banger chili con carne (my opinion)', 'ChiliConArne'),
  P('Luckyboi61', 'Controller', 'Cam 1', 'Mixed', '22', 'Spammiej', 'My name says Lucky, my finishes say otherwise...', 'Xertzy'),
  P('Alex-w.', 'Controller', 'Cam 2', 'Upside down desert car multilap ice reactor', '23', 'Poepboer', 'I am 1/2 Dutch, 1/4 Italian and 1/4 Polish', 'Timmys'),
  P('Pug_TM', 'Keyboard', 'Cam 1', 'Ice', '23', '', '', "Tommie, battle between who's the best in Utrecht"),
  P('Steeghos', 'Keyboard', 'Cam 1', 'Mixed', '23', 'ThijnHD', 'Speedrunning Lego Indiana Jones 2: The Adventure Continues', 'FlinkeJetsersTM'),
  P('Paardenvechter', 'Controller', 'Cam 2', 'Mixed', '24', 'HikoTM', 'I was previously called DikkeKut.', 'Alex-w'),
  P('DazzleAlec', 'Keyboard', 'Cam 1', 'Mixed ^_^ and also ice', '24', 'Alex-w', 'I have lost 4 LAN matches to Swordie, the pain must end', 'Swordie'),
  P('Eatify', 'Controller', 'Cam 2', 'Fullspeed', '24', 'Carljr', 'Ended 4th in the Limburgisch championship (of hoe je dat ook schrijft :) )', 'Steeghosaurs'),
  P('JanTM-', 'Controller', 'Cam 1', 'RPG', '25', '', 'wideBoink'),
  P('Javas..', 'Controller', 'Cam 2', 'Dirt', '26'),
  P('Javzo', 'Controller', 'Cam 1', 'Tech', '26', 'Tarpor', 'I like music a lot and sort the songs I enjoy in neat little playlists. I currently have 120+ playlists and counting.'),
  P('Kamielmonteur', 'Controller', 'Cam 2', 'Mixed', '26'),
  P('astronauttm', 'Keyboard', 'Cam 1', 'Mixed without plastic', '27', 'Alex-w', 'I started playing TM around when ThijnHD was born :waaa:', 'Marius89'),
  P('ChiliConArne.', 'Controller', 'Cam 1', 'Ice lekker glad', '27', 'Bobby4friends', "I actually don't fit in the car so it's very uncomfortable to drive", 'Timmys (smeerlap en kan ik hebben)'),
  P('markdeotter', 'Keyboard', 'Cam 1', 'Ice', '27', 'Spam', 'Been to Gammax while walking 200km over the 4 previous days', 'Swordie'),
  P('JussyDr', 'Controller', 'Cam 1', 'Speedtech', '27'),
  P('TIMMYS..', 'Controller', 'Cam 2', 'Mixed of loose', '28', '', '', 'ThijnHD & ChiliConArne'),
  P('Zeemuis', 'Keyboard', 'Cam 1', 'Patatje Belgische Mayo', '29', 'Pac', 'Was in a TMNF Fullspeed clan while not knowing about FS mechanics', 'Denniss'),
  P('Delet3..', 'Controller', 'Cam 1', 'Royal xdd en anders RPG', '29', 'Spammiej', 'Ik produceer (matige) hardstyle en een track waar ik aan mee heb gewerkt is op de mainstage van Defqon gedraaid.', 'Mijn motoriek. En iets serieuzer: ICY: Intellectrick, Clover en Youpikaii.'),
  P('Denniss..', 'Controller', 'Cam 1', 'Mixed', '29', '', 'Getting 9th place too often'),
  P('BVDDY.BW', 'Controller', 'Alt Cam 1', 'Mixed', '29', 'Gwen', '', 'Me'),
  P('CannonTM', 'Controller', 'Cam 1', 'Ice', '30', 'Pug', 'I really hate grass maps', 'markdeotter'),
  P('TarporTM', 'Controller', 'Cam 3', 'RPG', '31', 'Bren', '', 'Snappie'),
  P('Treggeur', 'Keyboard', 'Cam 1', 'Nascar', '', 'Jussy', 'I was rank 1 in the Netherlands on TMNF for 1 week.', 'ThijnHD'),
  P('B3gy', 'Keyboard', 'Cam 1', 'Dirt or mixed', ''),
];

const S = (id: string, kind: StoryKind, title: string, text: string): Story => ({ id, kind, title, text });

export const BNL_STORIES: Story[] = [
  S('s-zeemuis', 'fun', 'Zeemuis', 'Zeemuis his favourite style is Patatje Belgische Mayo'),
  S('s-astronaut', 'fun', 'Astronaut', 'Astronaut started playing Trackmania around when Thijn was born'),
  S('s-paardenvechter', 'fun', 'Paardenvechter', 'Paardenvechter was previously known as DikkeKut.'),
  S('s-delete', 'fun', 'Delet3..', 'Delete produces hardstyle and a track which he collaborated on has been played on mainstage at Defqon.'),
  S('s-tommie-pug', 'rivalry', 'Tommie & Pug', 'Tommie and Pug are each others biggest rivals, they are also both from Utrecht.'),
  S('s-chili-timmys', 'rivalry', 'ChiliConArne & Timmys', 'ChiliConArne and Timmys are each others biggest rivals, they are also both from Limburg.'),
  S('s-owls-jortim', 'rivalry', 'OwlsAreVeryCool & Jortim', 'OwlsAreVeryCool and Jortim are each others biggest rivals, they are also both from Zuid-Holland.'),
  S('s-alex-poepboer', 'favourite', 'Alex & Poepboer', 'Alex and Poepboer are each others favourite players.'),
];

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
export function vdoCasterPushUrl(id: string, name: string, password = ''): string {
  return `${VDO_HOST}?push=${id}&webcam&label=${encodeURIComponent(name || 'Caster')}&quality=1&autostart${password ? `&password=${encodeURIComponent(password)}` : ''}`;
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
