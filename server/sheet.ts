import { db, save } from './store';
import { parseCsv, parseEventTab, parseLogos, type SheetMatch } from '../shared/sheet';
import { ensureStreamIds, normName } from '../shared/players';

const BASE = 'https://docs.google.com/spreadsheets/d/';

async function get(url: string): Promise<string> {
  // Offline testing: SHEET_FIXTURE_DIR/<gid or tab>.csv instead of the network.
  const fx = process.env.SHEET_FIXTURE_DIR;
  if (fx) {
    const key = /gid=(\d+)/.exec(url)?.[1] ?? /sheet=(\w+)/.exec(url)?.[1] ?? 'x';
    const { readFileSync } = await import('node:fs');
    return readFileSync(`${fx}/${key}.csv`, 'utf8');
  }
  // Plain GET of a CSV export: read-only, cannot modify the sheet.
  const r = await fetch(url, { redirect: 'follow', headers: { Accept: 'text/csv' } });
  if (!r.ok) throw new Error(`Sheet returned HTTP ${r.status}${r.status === 401 || r.status === 403 || r.status === 404 ? ' (share it as “Anyone with the link can view”)' : ''}`);
  const t = await r.text();
  if (/^\s*<!DOCTYPE html/i.test(t)) throw new Error('Got a web page instead of CSV: share the sheet as “Anyone with the link can view”.');
  return t;
}

const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : 0);

/** Pull teams / players / matches (+ logos) from the event's sheet. */
export async function syncSheet(): Promise<void> {
  const sh = db.sheet;
  if (!sh.id) return;
  try {
    const csv = await get(sh.pub ? `${BASE}e/${sh.id}/pub?gid=${sh.gid || '0'}&single=true&output=csv` : `${BASE}${sh.id}/export?format=csv&gid=${sh.gid || '0'}`);
    const data = parseEventTab(parseCsv(csv));
    if (!data.matches.length && !data.teams.length) throw new Error('No team_id / match_id columns found in that tab.');
    let logos: Record<string, string> = {};
    if (!sh.pub) try { logos = parseLogos(parseCsv(await get(`${BASE}${sh.id}/gviz/tq?tqx=out:csv&sheet=logos`))); } catch { /* optional tab */ }
    sh.teams = data.teams.map(t => ({ ...t, logo: logos[t.id] ?? '' }));
    sh.matches = data.matches;
    sh.lastAt = Date.now();
    sh.error = '';
    mergePlayers(data.players, data.teams);
    applyFeatured();
  } catch (e: any) {
    sh.error = e?.message ?? String(e);
  }
  save();
}

/** Team players → player DB (keeps existing entries, VDO ids and facts). */
function mergePlayers(players: { id: string; name: string; country: string; device: string }[], teams: { name: string; players: string[] }[]) {
  const inTeams = new Map<string, string>();
  for (const t of teams) for (const p of t.players) inTeams.set(normName(p), t.name);
  const byName = new Map(db.players.map(p => [normName(p.name), p]));
  for (const p of players) {
    const team = inTeams.get(normName(p.name));
    if (!team) continue;
    const cur = byName.get(normName(p.name));
    if (cur) { cur.style = cur.style || team; cur.camera = cur.camera || p.country; cur.input = cur.input || p.device; continue; }
    const np = { id: `sh-${p.id}`, name: p.name, input: p.device, camera: p.country, style: team, age: '', favPlayer: '', funFact: '', rival: '', photo: '', ingame: p.name, vdo: '' };
    db.players.push(np);
    byName.set(normName(p.name), np);
  }
  db.players = ensureStreamIds(db.players);
}

export function featuredMatch(): SheetMatch | undefined {
  return db.sheet.featured ? db.sheet.matches.find(m => m.id === db.sheet.featured) : undefined;
}

/** Copy the featured match (names, logos, series score, best-of) onto the scoreboard, live and preview. */
export function applyFeatured() {
  const m = featuredMatch();
  if (!m) return;
  const logo = (id: string) => db.sheet.teams.find(t => t.id === id)?.logo ?? '';
  const tag = (n: string) => n.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
  for (const show of [db.showLive, db.showPreview]) {
    const keepA = show.teamA.name === m.t1.name, keepB = show.teamB.name === m.t2.name;
    show.teamA = { ...show.teamA, name: m.t1.name, tag: keepA ? show.teamA.tag : tag(m.t1.name), logo: logo(m.t1.id) || (keepA ? show.teamA.logo : ''), score: num(m.s1) || (m.status === 'COMPLETED' ? num(m.s1) : keepA ? show.teamA.score : 0) };
    show.teamB = { ...show.teamB, name: m.t2.name, tag: keepB ? show.teamB.tag : tag(m.t2.name), logo: logo(m.t2.id) || (keepB ? show.teamB.logo : ''), score: num(m.s2) || (m.status === 'COMPLETED' ? num(m.s2) : keepB ? show.teamB.score : 0) };
    if (m.bo) show.bestOf = m.bo;
  }
}
