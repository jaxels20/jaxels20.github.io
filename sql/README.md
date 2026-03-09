# Badminton Fact-Table Warehouses (PostgreSQL)

This folder contains two star-schema warehouse builds that now support:

- all groups in a season (e.g. Grundspil, Bronzekamp, Puljer, kval-kampe)
- multiple seasons/years in the same warehouse
- division + group context in dimensions/facts

Default expected exports are:

- `badminton_export/season_2025_all_groups_team_matches.csv`
- `badminton_export/season_2025_all_groups_individual_matches.csv`

You can generate those with:

- `collect_all_groups_api.py` (recommended for full-season population)

## 1) Individual-Match Fact Warehouse

Script: `sql/build_individual_fact_dw.sql`  
Database: `badminton_dw_individual`  
Fact grain: one row per `season + group + match_id + discipline`.

Core dimensions:

- `dim_date`
- `dim_season`
- `dim_division`
- `dim_group`
- `dim_round`
- `dim_team`
- `dim_discipline`
- `dim_player`

Core fact:

- `fact_individual_match`

Bridge for player participation:

- `bridge_individual_match_player` (`H/A` side + player slot 1/2)

## 2) Team-Match Fact Warehouse

Script: `sql/build_team_fact_dw.sql`  
Database: `badminton_dw_team`  
Fact grain: one row per `season + group + match_id`.

Core dimensions:

- `dim_date`
- `dim_season`
- `dim_division`
- `dim_group`
- `dim_round`
- `dim_team`
- `dim_organizer`
- `dim_venue`
- `dim_player` (for participation analytics)

Core fact:

- `fact_team_match`

Bridge for player participation in team matches:

- `bridge_team_match_player` (includes `disciplines_played`)

## Data Collection (All Groups)

Use the subPage=1 URL for the season/year you want:

```bash
python3 collect_all_groups_api.py \
  --url "https://badmintonplayer.dk/DBF/HoldTurnering/Stilling/#1,2025,,1,1,,,,"
```

Recommended for long full-season runs (more robust + clearer progress logs):

```bash
python3 collect_all_groups_api.py \
  --url "https://badmintonplayer.dk/DBF/HoldTurnering/Stilling/#1,2025,,1,1,,,," \
  --timeout 45 \
  --retries 4 \
  --retry-backoff 2 \
  --progress-every 20
```

The script discovers all groups for that season, then collects subPage=4 + subPage=5 data for each group.

Outputs:

- `badminton_export/season_<year>_all_groups_full.json`
- `badminton_export/season_<year>_all_groups_groups.csv`
- `badminton_export/season_<year>_all_groups_team_matches.csv`
- `badminton_export/season_<year>_all_groups_individual_matches.csv`

To collect another year later, change the URL season value (e.g. `#1,2026,...`).

## Build Warehouses

Requires `psql` access with permission to create databases.

Default paths are preconfigured for this repository. Run:

```bash
psql -d postgres -f sql/build_individual_fact_dw.sql
psql -d postgres -f sql/build_team_fact_dw.sql
```

If CSV paths differ, override with variables:

```bash
psql -d postgres \
  -v individual_csv='/absolute/path/season_2025_all_groups_individual_matches.csv' \
  -v team_csv='/absolute/path/season_2025_all_groups_team_matches.csv' \
  -f sql/build_individual_fact_dw.sql

psql -d postgres \
  -v individual_csv='/absolute/path/season_2025_all_groups_individual_matches.csv' \
  -v team_csv='/absolute/path/season_2025_all_groups_team_matches.csv' \
  -f sql/build_team_fact_dw.sql
```

## Player Stats Report

Script: `sql/player_stats_report.sql`  
Database: `badminton_dw_individual`

Run with player name:

```bash
/opt/homebrew/Cellar/postgresql@18/18.3/bin/psql \
  -h /tmp \
  -d badminton_dw_individual \
  -v player_name='Anna Simonsen' \
  -f sql/player_stats_report.sql
```

Optional filter by season/year:

```bash
/opt/homebrew/Cellar/postgresql@18/18.3/bin/psql \
  -h /tmp \
  -d badminton_dw_individual \
  -v player_name='Anna Simonsen' \
  -v season_id=2025 \
  -f sql/player_stats_report.sql
```

## Team Stats Report

Script: `sql/team_stats_report.sql`  
Database: `badminton_dw_individual`

Run with team name:

```bash
/opt/homebrew/Cellar/postgresql@18/18.3/bin/psql \
  -h /tmp \
  -d badminton_dw_individual \
  -v team_name='Viby J 2' \
  -f sql/team_stats_report.sql
```

Optional filter by season/year:

```bash
/opt/homebrew/Cellar/postgresql@18/18.3/bin/psql \
  -h /tmp \
  -d badminton_dw_individual \
  -v team_name='Viby J 2' \
  -v season_id=2025 \
  -f sql/team_stats_report.sql
```

Team report includes:

- overall team summary (team-match W/L/D, individual match win %, sets/points, walkovers, 3-set stats)
- pivoted discipline matrix (`overall`, `HS`, `DS`, `HD`, `DD`, `MD`) with matches/wins/win%, sets, points
- home vs away team-match performance
- opponent breakdown at team-match level
- winrate table by lineup match type (`1.hd`, `2.hd`, etc.)
- top players and top doubles pairs
- recent team matches

## Team Head-to-Head Report

Script: `sql/team_head_to_head_report.sql`  
Database: `badminton_dw_individual`

Compare two teams side-by-side (strengths/weaknesses):

```bash
/opt/homebrew/bin/psql-18 \
  -h /tmp \
  -d badminton_dw_individual \
  -v team_a='Vendsyssel 2' \
  -v team_b='Christiansbjerg' \
  -v season_id=2025 \
  -f sql/team_head_to_head_report.sql
```

The report includes:

- overall side-by-side comparison (team-match and individual-match KPIs)
- key deltas (`A - B`) for win rates, set win %, point win %
- discipline comparison (`HS/DS/HD/DD/MD`) including deltas
- match-type table (`1.hd`, `2.hd`, etc.) for both teams
- direct head-to-head summary + recent head-to-head matches
- common-opponent comparison to highlight relative strengths/weaknesses

## Export Reports as PDF

Script: `export_stats_report_pdf.py`

This script runs either SQL report (`player` or `team`) via `psql`, converts output into styled HTML tables, and exports a professional-looking PDF.

Player report PDF:

```bash
python3 export_stats_report_pdf.py \
  --report player \
  --name 'Anna Simonsen'
```

Team report PDF:

```bash
python3 export_stats_report_pdf.py \
  --report team \
  --name 'Viby J 2' \
  --season-id 2025
```

Team head-to-head PDF (and HTML if requested):

```bash
python3 export_stats_report_pdf.py \
  --report team_h2h \
  --name 'Vendsyssel 2' \
  --name-b 'Christiansbjerg' \
  --season-id 2025 \
  --also-save-html
```

Optional explicit output path:

```bash
python3 export_stats_report_pdf.py \
  --report team \
  --name 'Viby J 2' \
  --output reports/viby_j_2_report.pdf
```

Notes:

- Defaults to DB `badminton_dw_individual` and host `/tmp`.
- Auto-detects `psql` and also `psql-18` (common Homebrew naming).
- Uses Playwright/Chromium for polished PDF rendering (falls back to plain-text PDF if unavailable).
- Override DB connection with `--db`, `--host`, `--port`, `--user`, and `--psql-bin`.
- Use `--also-save-txt` if you also want a raw text copy beside the PDF.
- Use `--also-save-html` if you want the intermediate styled HTML file.
