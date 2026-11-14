/**
 * OverDrive 2026 Split 3 Major: player profiles for the Warm-up screen.
 * From Liquipedia (player pages, read 9 Nov 2026): check for changes before the event (21–22 Nov).
 */
import { hiRes } from './assetRes';
export interface MajorProfile {
  handle: string; team: string; how: string; name: string; country: string; age: string; winnings: string; history: string;
  /** Best / most recent placings: [year, place, event] */
  results: [string, string, string][];
  note: string;
}

export const MAJOR_PROFILES: MajorProfile[] = [
  { handle: "Massa", team: "BIG", how: "Split 2 Division 1 · 1st", name: "Dennis Lotze", country: "Germany", age: "31", winnings: "$39,752", history: "BIG since 2018 · ex Team Dignitas, Team expert.Black",
    results: [["2026", "9th–12th", "Esports World Cup 2026"], ["2025", "1st", "TMWT 2025 Global Playoffs #2"], ["2025", "3rd–4th", "Trackmania World Cup 2025"], ["2023", "2nd", "TMWT 2023 Stage 2 Grand League"], ["2016", "1st", "Gamers Assembly 2016 – Tech"]],
    note: "The veteran: competing since the early 2010s, eight years in BIG colours." },
  { handle: "GranaDy", team: "BIG", how: "Split 2 Division 1 · 1st", name: "Nico Gyarmati", country: "Germany", age: "25", winnings: "$75,525", history: "BIG since 2022 · ex ALTERNATE aTTaX · also a content creator",
    results: [["2026", "5th–6th", "Esports World Cup 2026"], ["2026", "3rd", "Road to EWC: DreamHack Birmingham"], ["2025", "1st", "TMWT 2025 Global Playoffs #2"], ["2025", "2nd", "Red Bull Faster 2025"], ["2023", "3rd", "Ascension Tournament 2023"]],
    note: "Won TMWT Global Playoffs #2 with Massa: the Split 2 Division 1 winners arrive as a proven duo." },
  { handle: "Heav", team: "FUT Esports", how: "Split 2 Division 1 · 2nd", name: "Lucas Fay", country: "France", age: "", winnings: "$11,967", history: "Weibo Gaming 2026 · ex Glorious Esport (2022–24)",
    results: [["2026", "3rd", "Fourmula Vae 2026"], ["2026", "1st", "RDS CUP Season 4"], ["2025", "5th", "BIG Trackmania Cup"], ["2025", "1st", "RDS CUP Season 3"], ["2025", "1st", "Kimi of the Year Season 2"]],
    note: "Split 2 runner-up (as Weibo x FUT). A string of community-cup titles since 2023." },
  { handle: "Nayko", team: "FUT Esports", how: "Split 2 Division 1 · 2nd", name: "Maxence Cloud", country: "France", age: "20", winnings: "$11,705", history: "FUT Esports since Feb 2026 · ex Loading, Thrive, Lystral",
    results: [["2026", "1st", "Coupe de France 2026"], ["2026", "17th–20th", "Esports World Cup 2026"], ["2026", "4th", "Maji Mondays Season 5"], ["2026", "3rd", "InsaLan XX Elite"]],
    note: "French champion: won the Coupe de France in September, and played the EWC with FUT." },
  { handle: "Whizzy", team: "Airwalkers", how: "Split 2 Division 1 · 3rd", name: "Alexander Page", country: "United Kingdom", age: "24", winnings: "$14,160", history: "S8UL Esports since Apr 2026 · ex WYLDE (2023–26)",
    results: [["2026", "17th–20th", "Esports World Cup 2026"], ["2025", "3rd", "TM Formula E Championship Season 2"], ["2025", "3rd", "Beacon Duo League Season 1"], ["2025", "5th", "Out of the Blue"], ["2025", "2nd", "TM Formula E: Tokyo & Miami"]],
    note: "Formula E specialist; reunites with former WYLDE teammate Stufts." },
  { handle: "Stufts", team: "Airwalkers", how: "Split 2 Division 1 · 3rd", name: "Mees Jenema", country: "Netherlands", age: "21", winnings: "$19,963", history: "GodLike Esports since Apr 2026 · ex WYLDE, SHIFT",
    results: [["2026", "7th–8th", "Esports World Cup 2026"], ["2024", "1st", "TM Formula E: London Races 1 & 2"], ["2024", "1st", "Trackmania × Comic Con Baltics 2024"], ["2024", "4th", "BIG LAN Race"]],
    note: "Top-8 at the Esports World Cup this summer, the best EWC finish of the Airwalkers pair." },
  { handle: "L1ngo", team: "COOK", how: "Split 2 Division 1 · 4th", name: "Émile Côté", country: "Canada", age: "", winnings: "$11,444", history: "GodLike Esports since Apr 2026 · ex Evo (2023–26)",
    results: [["2026", "2nd", "LAN ETS 2026"], ["2026", "25th–28th", "Esports World Cup 2026"], ["2025", "2nd", "Out of the Blue"], ["2025", "1st", "die Bayerische Duo Dash (with eLconn21)"]],
    note: "The only North American in the field. Won a duo event with eLconn21, now on the other side at NAVI." },
  { handle: "Scrapie", team: "COOK", how: "Split 2 Division 1 · 4th", name: "Dennis Heinen", country: "Belgium", age: "28", winnings: "$15,446", history: "Most recently Sprout (2022–24) · ex Lazarus, Team PAX",
    results: [["2024", "1st", "TM Formula E: Tokyo Race 1"], ["2023", "2nd", "TMWT 2023 Stage 1 Challenger League"], ["2023", "3rd", "Maji Mondays"], ["2021", "3rd", "Trackmania Grand League Winter 2021 Final"]],
    note: "Experienced Belgian; Grand League finals podium back in 2021." },
  { handle: "Melioo", team: "Ragnarok", how: "Wildcards · 1st–2nd", name: "Emerson Almeida", country: "France", age: "", winnings: "$1,557", history: "Last team Oserv Esport (2024–25) · ex w., Ferox",
    results: [["2024", "1st", "Holy'n Lyon"], ["2024", "1st", "FastPoint League"], ["2024", "2nd", "TMWT 2024 Challenger Community Cup #1"], ["2023", "4th", "Gamers Assembly 2023: Mixed"]],
    note: "Breakout story: through the Wildcards to his first Tier 1 event, alongside the EWC runner-up." },
  { handle: "Epos", team: "Ragnarok", how: "Wildcards · 1st–2nd", name: "Robert McKay", country: "United Kingdom", age: "", winnings: "$96,504", history: "Team Liquid since Feb 2026 · ex SWIFT, BLUEJAYS",
    results: [["2026", "2nd", "Esports World Cup 2026"], ["2026", "1st", "XPEvo 2026"], ["2026", "3rd", "Red Bull Faster 2026"], ["2025", "1st", "XPEvo 2025"], ["2025", "3rd", "TMWT 2025 Global Playoffs #1"]],
    note: "EWC 2026 runner-up and back-to-back XPEvo champion: the in-form star of the Wildcard teams." },
  { handle: "Mime", team: "Natus Vincere", how: "Wildcards · 1st–2nd", name: "Hubert Dziedzic", country: "Poland", age: "24", winnings: "$47,866", history: "NAVI since Feb 2026 · also JOEL · ex Team Nemesis, Into The Breach",
    results: [["2026", "4th", "Esports World Cup 2026"], ["2026", "1st", "Trackmania × Comic Con Baltics 2026"], ["2025", "2nd", "TMWT 2025 Global Playoffs #2"], ["2025", "3rd–4th", "Trackmania World Cup 2025"], ["2023", "3rd–4th", "TMWT 2023 World Championship"]],
    note: "4th at the EWC; won all three Wildcard matches with NAVI, including a 3–0 final." },
  { handle: "eLconn21", team: "Natus Vincere", how: "Wildcards · 1st–2nd", name: "Filip Šprungl", country: "Czechia", age: "23", winnings: "$75,934", history: "JOEL since 2024 · ex Team Nemesis, Into The Breach",
    results: [["2026", "5th–6th", "Esports World Cup 2026"], ["2025", "1st", "Out of the Blue"], ["2025", "1st", "die Bayerische Duo Dash"], ["2025", "1st", "Trackmania × Comic Con Baltics 2025"], ["2024", "1st", "Maji Mondays Season 3"]],
    note: "Long-time partner of mime: teammates at Into The Breach and Team Nemesis before NAVI." },
  { handle: "Nabla", team: "rnboi", how: "Wildcards · 3rd–4th", name: "", country: "France", age: "16–17", winnings: "$1,030", history: "Silnce Esport since Nov 2024 · ex BC Racing",
    results: [["2026", "3rd", "Maji Mondays Season 5"], ["2026", "2nd", "Random Cup Season 2 Finale"], ["2026", "13th–14th", "XPEvo 2026"], ["2026", "2nd", "BIG YEK Monthly Cup, April"]],
    note: "Youngest player at the Major, born 2009." },
  { handle: "Walegen", team: "rnboi", how: "Wildcards · 3rd–4th", name: "Remi Despretz--Honoré", country: "France", age: "21", winnings: "$3,033", history: "Last team Lille Esport (2022–25)",
    results: [["2026", "2nd", "Fourmula Vae 2026"], ["2026", "2nd", "Springs Mania Cup"], ["2025", "2nd", "Wirtual Birthday Cup 2025"], ["2024", "1st", "Wirtual Birthday Cup 2024"]],
    note: "Three Tier 2 podiums in the last three months: arriving in form." },
  { handle: "Gwen", team: "All Gamers Global", how: "Wildcards · 3rd–4th", name: "Gwendal Duparc", country: "France", age: "22", winnings: "$231,395", history: "All Gamers Global since Feb 2026 · ex Ici Japon Corp., Gamers First",
    results: [["2026", "1st", "Esports World Cup 2026"], ["2023", "1st", "Ascension Tournament 2023"], ["2024", "1st", "Volvic Duo Dash (with Binkss)"], ["2023", "1st", "Cupra Cup"], ["2021", "1st", "Trackmania Grand League Fall 2021 Steps"]],
    note: "The reigning Esports World Cup champion ($130,000) and the highest earner in the field." },
  { handle: "Binkss", team: "All Gamers Global", how: "Wildcards · 3rd–4th", name: "Alexandre Touche", country: "France", age: "22", winnings: "$40,519", history: "All Gamers Global since Feb 2026 · ex Team BPP, Gamers First",
    results: [["2026", "9th–12th", "Esports World Cup 2026"], ["2025", "2nd", "TMWT 2025 Global Playoffs #1"], ["2024", "3rd", "Trackmania World Cup 2024"], ["2024", "1st", "Volvic Duo Dash (with Gwen)"], ["2023", "1st", "Cupra Cup (with Gwen)"]],
    note: "Long-time partner of Gwen: Cupra Cup and Volvic Duo Dash winners together." },
];

export const normHandle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The 8 Major teams: how they qualified and their logo (public/brand/overdrive/teams/). */
export const MAJOR_TEAMS: { name: string; how: string; logo: string }[] = [
  { name: 'BIG', how: 'Split 2 Division 1 · 1st', logo: 'big' },
  { name: 'FUT Esports', how: 'Split 2 Division 1 · 2nd', logo: 'weiboxfut' },
  { name: 'Airwalkers', how: 'Split 2 Division 1 · 3rd', logo: 'airwalkers' },
  { name: 'COOK', how: 'Split 2 Division 1 · 4th', logo: 'cook' },
  { name: 'Ragnarok', how: 'Wildcards · 1st–2nd', logo: 'ragnarok' },
  { name: 'Natus Vincere', how: 'Wildcards · 1st–2nd', logo: 'navixjoel' },
  { name: 'rnboi', how: 'Wildcards · 3rd–4th', logo: 'rnboi' },
  { name: 'All Gamers Global', how: 'Wildcards · 3rd–4th', logo: 'ag' },
];
export const majorTeam = (name: string) => MAJOR_TEAMS.find(t => t.name === name);
export const teamLogo = (name: string) => { const t = majorTeam(name); return t ? hiRes(`/brand/overdrive/teams/${t.logo}.png`) : ''; };
export const teamPlayers = (name: string) => MAJOR_PROFILES.filter(p => p.team === name);

/**
 * What the Warm-up shows for the intro right now: the playing sequence, else (two teams picked, idle "vs",
 * no player held in the showcase) the teams' VS screen as the resting state. null = the player showcase.
 */
export function introScreen(intro: { a: string; b: string; step: number; at: number | null; idle?: 'vs' | 'showcase' }, now: number, pinned = false): IntroPhase | null {
  const ph = introPhase(intro, now);
  if (ph) return ph;
  return intro.a && intro.b && intro.idle !== 'showcase' && !pinned ? { kind: 'vs', end: true } : null;
}

/** Match intro: VS screen, then each player, then the VS screen again (held). */
export const INTRO_VS_SECONDS = 8;
export type IntroPhase = { kind: 'vs'; end: boolean } | { kind: 'player'; profile: MajorProfile; side: 'a' | 'b'; n: number; of: number; t: number };
export function introPhase(intro: { a: string; b: string; step: number; at: number | null }, now: number): IntroPhase | null {
  if (intro.at == null || !intro.a || !intro.b) return null;
  const el = (now - intro.at) / 1000;
  if (el < INTRO_VS_SECONDS) return { kind: 'vs', end: false };
  const players = [...teamPlayers(intro.a).map(p => ['a', p] as const), ...teamPlayers(intro.b).map(p => ['b', p] as const)];
  const k = Math.floor((el - INTRO_VS_SECONDS) / intro.step);
  if (k >= players.length) return { kind: 'vs', end: true };
  const [side, profile] = players[k];
  return { kind: 'player', profile, side, n: k + 1, of: players.length, t: ((el - INTRO_VS_SECONDS) % intro.step) / intro.step };
}
