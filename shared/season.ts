/**
 * OverDrive 2026 season so far, per Major team (Liquipedia, as readable on 10 Nov 2026).
 * '' = not found; fill it in here before the show. Used by the analyst desk's Head to head
 * panel and the match intro's "Fill roads from the season" button.
 */
export interface SeasonLine {
  /** Split 1 (spring): Division 1 league stage unless noted. */
  split1: string;
  /** Split 2 (autumn). */
  split2: string;
  /** Split 3 Wildcards (7–8 Nov). */
  wildcards: string;
  /** One line for the match intro ("Road so far"). */
  road: string;
}

export const SEASON: Record<string, SeasonLine> = {
  BIG: { split1: 'Div 1 · 2nd in the league (8–1)', split2: 'Div 1 · Champions', wildcards: '', road: 'Split 2 Division 1 champions' },
  'FUT Esports': { split1: 'Div 1 · 8th in the league (2–7)', split2: 'Div 1 · Runner-up (Weibo x FUT)', wildcards: '', road: 'Split 2 Division 1 runner-up' },
  Airwalkers: { split1: '', split2: 'Div 1 · 3rd', wildcards: '', road: 'Split 2 Division 1 · 3rd' },
  COOK: { split1: 'Div 1 · 5th in the league (4–4)', split2: 'Div 1 · 4th', wildcards: '', road: 'Split 2 Division 1 · 4th' },
  Ragnarok: { split1: 'Barrage vs NAVI', split2: '', wildcards: 'Qualified · 1st–2nd', road: 'Through the Wildcards (1st–2nd)' },
  'Natus Vincere': { split1: 'Div 1 · 9th (2–7) · barrage vs Ragnarok', split2: 'Div 2 · Champions', wildcards: 'Qualified · 3–0, 3–0, 3–0', road: 'Wildcards: 3–0 TMTAS, 3–0 Brothers, 3–0 ONIC' },
  rnboi: { split1: '', split2: '', wildcards: 'Qualified · 3rd–4th', road: 'Through the Wildcards (3rd–4th)' },
  'All Gamers Global': { split1: 'Div 1 · 3rd in the league (8–1)', split2: '', wildcards: 'Qualified · 3rd–4th', road: 'Through the Wildcards (3rd–4th)' },
};

export const seasonOf = (team: string): SeasonLine | undefined => SEASON[team];
