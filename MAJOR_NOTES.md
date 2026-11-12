# OverDrive Final Major: prep notes

Written 9 Nov 2026, after the Wildcard. Read this first when setting up the Major.

## Season sheet

**OverDrive 2026 tinySheet**
https://docs.google.com/spreadsheets/d/1wvKS0QsGqGUXCM2upmuFVw4pKUPPwYGi-D1o21v62gU/edit?usp=sharing

Tabs: Division 1, Division 2, scheduling, results, standings, broadcast, playoffs_bracket_id,
socials, utils, marketing, wip_div1, wip_broadcast_v2, timing_data, comments.

Only part of the first tab could be read from outside the sheet (below). Division 2, the
playoffs bracket, broadcast, socials and the full schedule were **not** read. For the Major,
get the data from the sheet itself on the day:

1. Controller → **Tournament → Google Sheet**: paste the link of the tab that holds the
   `match_id` / `team_id` block (open that tab and copy the address, it ends in `#gid=…`),
   or a "File → Share → Publish to the web → CSV" link of that tab. Turn Auto-sync on.
2. Teams, players, match times and live scores then come in every 30–60 s.
3. The Major bracket is built (8 teams, double elimination, Bo5). The first-round pairings
   were not published where they could be read on 10 Nov: set them in Controller → Major →
   First round. If the sheet's Major tab uses other match ids than R1_UB1…R4_LB1 / R5_GF1,
   scores won't sync from it: enter them with the score buttons, or bring the tab to a session.

## The Major (from Liquipedia search results, 9 Nov 2026)

- OverDrive 2026 Split 3: Major, Liquipedia Tier 1, online, organised by OverDrive, sponsor Ubisoft Nadeo
- 21–22 Nov 2026, 8 teams, double elimination, TMWT Duos, €13,600 prize pool (≈ $15,165)
- Maps listed: India, Czech Republic, Egypt, United Kingdom, New Zealand
- Qualified via Split 2 Division 1 (won by BIG, runner-up Weibo x FUT) and the Split 3 Wildcards (4 spots)
- NAVI (mime + eLconn21) qualified through the Wildcards, winning all three matches (Wildcard final 3–0 vs ONIC)
- Page: https://liquipedia.net/trackmania/OverDrive/2026/Split_3/Major (Liquipedia blocks automated reading:
  save the page from a browser, File → Save as / Print to PDF, to work from it)

## Previous results (Liquipedia)

Split 1 (spring 2026) and Split 2 are on Liquipedia, with standings, brackets and match pages:
- https://liquipedia.net/trackmania/OverDrive/2026/Split_1/Division_1 (league stage + playoffs)
- https://liquipedia.net/trackmania/OverDrive/2026/Split_1/Continentals/EMEA and …/Americas
- https://liquipedia.net/trackmania/OverDrive/2026/Split_1/Barrage
- Split 2 pages: same address with Split_2 (e.g. …/OverDrive/2026/Split_2/Division_2)
- Every team and player has a Results page, e.g. https://liquipedia.net/trackmania/Mime/Results

Liquipedia's Split 1 Division 1 table confirms the standings order below (PACB 1st, BIG 2nd,
All Gamers 3rd … Natus Vincere 9th, S8UL 10th).

## What was readable (9 Nov 2026, regular season, may be out of date)

### Division 1 participants

| Seed | Team | Players | Subs |
|---|---|---|---|
| 1 | BIG | Granady, Massa | |
| 2 | All Gamers | Binkss, Gwen | Cocow, Alfadream |
| 3 | Pacb | CarlJr, Pac | Affi, Bren |
| 4 | GenG x Weibo | Wosile, Heav | |
| 5 | FUT | Legu18, Nayko | |
| 6 | Navi | NuPrime, mime | |
| 7 | COOK | L1ngo, Scrapie | |
| 8 | S8UL | Neal, Whizzy | Spark |
| 9 | Orgless | Stufts, Letzter | |
| 10 | VP x Neon | pusztitopako, neon | |

### Division 1 standings, Split 1 (after 9 matches)

Order checked against Liquipedia for 1st–3rd and 9th–10th; check the middle rows on the
standings tab before using them on air.

| Team | P | W | L | Tracks W | Tracks L | +/- | Pts |
|---|---|---|---|---|---|---|---|
| PACB | 9 | 8 | 1 | 25 | 3 | 22 | 8 |
| BIG | 9 | 8 | 1 | 26 | 6 | 20 | 8 |
| All Gamers | 9 | 8 | 1 | 24 | 7 | 17 | 8 |
| VP x Neon | 9 | 5 | 4 | 19 | 14 | 5 | 5 |
| GenG x Weibo | 9 | 5 | 4 | 17 | 22 | -5 | 5 |
| COOK | 9 | 4 | 5 | 15 | 20 | -5 | 4 |
| Orgless | 9 | 3 | 6 | 12 | 20 | -8 | 3 |
| FUT | 9 | 2 | 7 | 12 | 23 | -11 | 2 |
| Navi | 9 | 2 | 7 | 10 | 22 | -12 | 2 |
| S8UL | 9 | 0 | 9 | 4 | 27 | -23 | 0 |

### Some Division 1 results (April 2026; series score first, then map points)

| Match | Week | Teams | Score |
|---|---|---|---|
| D1M16 | 2 | S8UL vs VP x Neon | 1–3 |
| D1M30 | 3 | All Gamers vs VP x Neon | 3–1 |
| D1M28 | 3 | Navi vs S8UL | 3–0 |
| D1M25 | 3 | S8UL vs Orgless | 0–3 |
| D1M21 | 3 | Pacb vs Navi | 3–0 |
| D1M27 | 3 | FUT vs COOK | 1–3 |
| D1M29 | 3 | Pacb vs Orgless | 3–0 |
| D1M23 | 3 | All Gamers vs FUT | 3–1 |
| D1M03 | 1 | All Gamers vs Orgless | 3–0 |

Wildcard qualifiers (top 4 of the Wildcard bracket) join these teams at the Major: their
names come from the Wildcard results (Controller → Wildcard, or shared/wildcard.ts).


## Season results (read 10 Nov 2026 from Liquipedia search results)

Liquipedia blocks automated page reads, so only what search results showed is here. It is also
in `shared/season.ts` (desk Head to head + match intro roads). Check before air.

- **Split 1, Division 1 league stage**: PACB 8–1 (25–3), BIG 8–1 (26–6), All Gamers Global 8–1 (24–7),
  VP x Neon 4–4, Team COOK 4–4, Gen.G x Weibo 4–4, Orgless 3–5, FUT Esports 2–7, Natus Vincere 2–7, S8UL 0–9.
  Playoff semis: PACB vs VP x Neon, BIG vs All Gamers (results not read). Barrage: Ragnarok vs NAVI (result not read).
- **Split 2**: Division 1 won by BIG, runner-up Weibo x FUT (3rd Airwalkers, 4th COOK per the Major page).
  Division 2 won by Natus Vincere, runner-up Halcyon. Continentals: EMEA Nyxar Competitive, APAC Team Abyssal, Americas OCD.
- **Split 3 Wildcards (7–8 Nov)**: NAVI (mime, eLconn21) won all three: 3–0 TMTAS, 3–0 Brothers, 3–0 ONIC.
  Qualified: Ragnarok and NAVI (1st–2nd), rnboi and All Gamers Global (3rd–4th).
- **Major**: double elimination, all matches Bo5, €13,600, 21–22 Nov, online. Seeding / first-round pairings: not found.

Not found: Split 1 playoff results, the full Split 2 tables, the rest of the Wildcard bracket, the Major seeding.
To fill those in, save the Liquipedia pages from a browser (File → Save as) and bring them to a session.


## Map PBs (trackmania.io, 2026 Split 3 campaign, read 10 Nov 2026)

Author times: India 1:05.000 · Czech Republic 1:02.000 · Egypt 1:12.000 · United Kingdom 1:11.000 · New Zealand 1:04.000.
Major players on the leaderboards (fastest first):

- India: eLconn21 1:04.068, Melioo 1:04.075, Epos 1:04.151, Gwen 1:04.240, Mime 1:04.263, Nabla 1:04.281, Binkss 1:04.288, Walegen 1:04.298
- Czech Republic: Melioo 59.848, Binkss 59.898, Epos 59.976, Nabla 59.985, Mime 59.988, eLconn21 1:00.007, Gwen 1:00.034, Walegen 1:00.382
- Egypt: Epos 1:09.493, Gwen 1:09.545, Nabla 1:10.267, Walegen 1:10.385, Binkss 1:10.518, Massa 1:10.632, Melioo 1:11.282 (no time: Mime, eLconn21)
- United Kingdom: Nabla 1:08.891, eLconn21 1:09.281, Mime 1:09.353, Gwen 1:09.457, Walegen 1:09.521, Melioo 1:09.557, Binkss 1:09.657, Epos 1:09.697
- New Zealand: Melioo 1:01.370, Mime 1:01.422, Epos 1:01.452, eLconn21 1:01.537, Binkss 1:01.588, Gwen 1:01.645, Walegen 1:01.804, Nabla 1:01.958

Not on these leaderboards: GranaDy, Heav, Nayko, Whizzy, Stufts, L1ngo, Scrapie (and Massa except Egypt). Refresh before the show: times will move as players practise.
