# OverDrive 2026 dataset: import report

Built by `scripts/season/import_season.py` into `public/season/overdrive-2026.json` (served as /season/overdrive-2026.json and part of every build) from `season-data/source/2026/` (read-only exports of the two verified sheets, read 13 Nov 2026).

## Counts

| | |
|---|---|
| Tournaments / stages | 61 |
| Regions | 3 (Americas, EMEA, Oceasia) |
| Teams (records with ids) | 108 |
| Players | 247 |
| Matches | 851 |
| Standings rows | 39 (+120 Split 1 weekly snapshots) |
| Continental placements | 38 |
| Overpoints ranking | 53 |
| Split 1 player times / track records | 180 / 5 |

## Matches per tournament

| Tournament | Matches |
|---|---|
| S1 · Split 1 · Barrage | 1 |
| S1 · Split 1 · Division 1 | 45 |
| S1 · Split 1 · Division 1 Playoffs | 6 |
| S1 · Split 1 · Division 2 | 45 |
| S1 · Split 1 · Promotion | 4 |
| S1 · Continental Americas Playoffs | 6 |
| S1 · Continental Americas Swiss Stage | 15 |
| S1 · Continental EMEA Playoffs | 14 |
| S1 · Continental EMEA Swiss Stage | 33 |
| S1 · Continental Oceasia Playoffs | 6 |
| S1 · Continental Oceasia Swiss Stage | 17 |
| S1 · Open Qualifier 1 Americas | 14 |
| S1 · Open Qualifier 1 EMEA | 113 |
| S1 · Open Qualifier 1 Oceasia | 14 |
| S1 · Open Qualifier 2 Americas | 1 |
| S1 · Open Qualifier 2 EMEA | 29 |
| S1 · Open Qualifier 2 Oceasia | 13 |
| S1 · Open Qualifier 3 Americas | 13 |
| S1 · Open Qualifier 3 EMEA | 30 |
| S1 · Open Qualifier 3 Oceasia | 14 |
| S1 · Open Qualifier 4 Americas | 14 |
| S1 · Open Qualifier 4 EMEA | 29 |
| S1 · Open Qualifier 4 Oceasia | 14 |
| S1 · Open Qualifier 5 Americas | 1 |
| S1 · Open Qualifier 5 EMEA | 27 |
| S1 · Open Qualifier 5 Oceasia | 6 |
| S1 · Open Qualifier 6 Americas | 6 |
| S1 · Open Qualifier 6 EMEA | 14 |
| S1 · Open Qualifier 6 Oceasia | 6 |
| S1 · Open Qualifier 7 Americas | 1 |
| S1 · Open Qualifier 7 EMEA | 14 |
| S1 · Open Qualifier 7 Oceasia | 1 |
| S1 · Open Qualifier 8 Americas | 6 |
| S1 · Open Qualifier 8 EMEA | 6 |
| S1 · Open Qualifier 8 Oceasia | 1 |
| S2 · Split 2 · Division 1 | 45 |
| S2 · Split 2 · Division 1 Playoffs | 6 |
| S2 · Split 2 · Division 2 | 45 |
| S2 · Split 2 · Promotion & Relegation | 3 |
| S2 · Continental Americas Playoffs | 3 |
| S2 · Continental EMEA Playoffs | 14 |
| S2 · Continental Oceasia Playoffs | 6 |
| S2 · Continental Oceasia Swiss Stage | 16 |
| S2 · Open Qualifier 1 Americas | 1 |
| S2 · Open Qualifier 1 EMEA | 13 |
| S2 · Open Qualifier 1 Oceasia | 14 |
| S2 · Open Qualifier 2 Americas | 1 |
| S2 · Open Qualifier 2 EMEA | 1 |
| S2 · Open Qualifier 2 Oceasia | 14 |
| S2 · Open Qualifier 3 Americas | 1 |
| S2 · Open Qualifier 3 EMEA | 1 |
| S2 · Open Qualifier 3 Oceasia | 14 |
| S2 · Open Qualifier 4 Americas | 1 |
| S2 · Open Qualifier 4 EMEA | 1 |
| S2 · Open Qualifier 4 Oceasia | 14 |
| S2 · Open Qualifier 5 EMEA | 3 |
| S2 · Open Qualifier 5 Oceasia | 14 |
| S2 · Open Qualifier 6 EMEA | 1 |
| S2 · Open Qualifier 6 Oceasia | 14 |
| S3 · Major | 0 |
| S3 · Wildcard | 26 |

## Name links made (evidence)

- Major list name “All Gamers Global” → TEAM_0002 All Gamers (shared/season.ts: Split 1 "Div 1 · 3rd (8–1)" = All Gamers in the site standings)
- Major list name “FUT Esports” → TEAM_0004 Weibo x FUT (shared/season.ts: Split 2 "Runner-up (Weibo x FUT)")
- Major list name “Natus Vincere” → TEAM_0006 NAVI x Joel (shared/season.ts: Split 2 "Div 2 · Champions" = NAVI x Joel in the site standings)
- “Aurora x SKUF” → TEAM_0022 Onyx (the sheet lists “Aurora x SKUF” as its previous name)
- “EVOLUPEGG” → TEAM_0018 EvolupeGG (same name, different capitalisation)
- “Eline Express” → TEAM_0048 eLine Express (same name, different capitalisation)
- “F11” → TEAM_0073 Rex Regum Qeon (the sheet lists “F11” as its previous name)
- “GENG X WEIBO” → TEAM_0004 Weibo x FUT (the sheet lists “GENG X WEIBO” as its previous name)
- “GenG x Weibo” → TEAM_0004 Weibo x FUT (the sheet lists “GenG x Weibo” as its previous name)
- “Navi” → S1_NAVI NAVI (same name, different capitalisation)
- “ORGLESS” → TEAM_0009 Airwalkers (the sheet lists “ORGLESS” as its previous name)
- “Orgless” → TEAM_0009 Airwalkers (the sheet lists “Orgless” as its previous name)
- “Rex Regum Qeon” → TEAM_0023 BOMBO (the site sheet's own team_id on Split 2 rows; the record named “Rex Regum Qeon” is TEAM_0073)
- “TEAM HERETICS” → TEAM_0015 Grassboyz (the sheet lists “TEAM HERETICS” as its previous name)
- “TEMPOBROS” → TEAM_0012 rnboi (the sheet lists “TEMPOBROS” as its previous name)
- “TMWA Casual” → TEAM_0070 Shark (the sheet lists “TMWA Casual” as its previous name)
- “TMWA x SPLIT” → TEAM_0086 RUNNA X BOONIE (the sheet lists “TMWA x SPLIT” as its previous name)
- “Team Heretics” → TEAM_0015 Grassboyz (the sheet lists “Team Heretics” as its previous name)
- “TempoBros” → TEAM_0012 rnboi (the sheet lists “TempoBros” as its previous name)
- “VA BENE” → TEAM_0017 Va Bene (same name, different capitalisation)

## Names not linked to a team record (kept exactly as written)

1 names, 12 occurrences. No team record has this name or lists it as a previous name. BYE is a bracket bye, not a team.

BYE (12)

## Missing fields

- Split 1 matches whose track scores the sheet marks “missing”: 3
- matches with an empty team slot (bracket byes / unfilled): 132
- matches without a determinable winner: 31
- matches without a score: 11
- players without a nationality: 211
- teams without a roster in source B: 8
- tracks named without a score: 42

## Needs your decision

- Split 1 “FUT” has no team record in the site sheet: stored as S1_FUT. Suggested successor TEAM_0004 (Nayko (Split 1 FUT roster) plays for Weibo x FUT) — not linked until you confirm.
- Split 1 “NAVI” has no team record in the site sheet: stored as S1_NAVI. Suggested successor TEAM_0006 (mime (Split 1 Navi roster) plays for NAVI x Joel) — not linked until you confirm.
- Split 1 Promotion “Rex Regum Qeon” (PRM03 vs Loading) is linked to TEAM_0023 BOMBO because the site sheet gives that name team_id TEAM_0023 on its Split 2 rows; TEAM_0073 is also named “Rex Regum Qeon” (retired, previously F11). Confirm.

## Conflicts

- none

## Duplicates

- Two team records named “Loading”: TEAM_0016 (active) and TEAM_0098 (retired), same players. Kept both as in the source; names resolve to the active one.
- Two team records named “Shark”: TEAM_0070 (active) and TEAM_0101 (retired), same players. Kept both as in the source; names resolve to the active one.

## Corrections

- “Amercias” (fall Open Qualifier / Continental event names in the site sheet) was normalised to “Americas” when the tab was exported on 13 Nov 2026.

## Unmatched logos

- Identical image files: cook.png, overdrive.png, weiboxfut.png (the OverDrive mark) — COOK and FUT Esports show the OverDrive logo, not their own
- Logo files not linked to any team by the data or the code: abyssal, bombo, brothers, dyslexai, grassboyz, loading, nyxar, nyxbar, onic, overdrive, piwo, tmtas, wings (left unlinked: no source names a file)

## Unsupported structures

- none

## Season lines applied to the graphics (analyst desk “Head to head”, match intro roads)

- FUT Esports · split1: left as curated (“Div 1 · 8th in the league (2–7)”) — which Split 1 team is its predecessor is not confirmed (see Needs your decision; the sheet's previous-name column gives GenG x Weibo 5th (5–4))
- Airwalkers · split1: empty → “Div 1 · 7th in the league (3–6)” (verified standings, listed there as Orgless)
- COOK · split1: “Div 1 · 5th in the league (4–4)” contradicts the verified standings → “Div 1 · 6th in the league (4–5)”
- Ragnarok · split2: empty → “Div 1 · 10th in the league (0–5)” (verified standings)
- rnboi · split1: empty → “Div 2 · 3rd in the league (7–2)” (verified standings, listed there as TempoBros)
- rnboi · split2: empty → “Div 2 · 6th in the league (3–5)” (verified standings)
- All Gamers Global · split2: empty → “Div 1 · 7th in the league (0–5)” (verified standings)

## Player showcase (shared/major.ts) vs verified rosters — not changed, for your review

- BIG: showcase matches the verified roster
- FUT Esports: showcase matches the verified roster
- Airwalkers: showcase matches the verified roster
- COOK: showcase matches the verified roster
- Ragnarok: showcase matches the verified roster (roster also lists Evon, no profile)
- Natus Vincere: showcase matches the verified roster
- rnboi: showcase profiles Nabla, Walegen · verified roster (rnboi) Azion, NablaTM, Walegen
- All Gamers Global: showcase matches the verified roster (roster also lists Alfadream, Otaaaq, no profile)
