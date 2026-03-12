\set ON_ERROR_STOP on

\if :{?season_id}
\else
\echo 'Missing required variable: season_id'
\echo 'Example: psql -d postgres -v season_id=2022 -v individual_csv="..." -v team_csv="..." -f sql/refresh_individual_fact_dw_season.sql'
\quit 1
\endif

\if :{?individual_csv}
\else
\echo 'Missing required variable: individual_csv'
\quit 1
\endif

\if :{?team_csv}
\else
\echo 'Missing required variable: team_csv'
\quit 1
\endif

SELECT 'CREATE DATABASE badminton_dw_individual'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'badminton_dw_individual'
)\gexec

\connect badminton_dw_individual

CREATE SCHEMA IF NOT EXISTS dw;
SET search_path TO dw, public;

SELECT (to_regclass('dw.fact_individual_match') IS NOT NULL)::int AS has_schema \gset

\if :has_schema
\else
\echo 'Schema for badminton_dw_individual is missing.'
\echo 'Run sql/build_individual_fact_dw.sql once before incremental refresh.'
\quit 1
\endif

CREATE TEMP TABLE stg_individual_matches (
    season_id text,
    age_group_id text,
    region_id text,
    club_id text,
    league_group_id text,
    division_name text,
    group_name text,
    match_id text,
    round text,
    discipline text,
    discipline_no text,
    discipline_code text,
    home_team text,
    away_team text,
    home_players text,
    away_players text,
    set_scores text,
    winner_side text,
    winner_team text,
    wo text
);

CREATE TEMP TABLE stg_team_matches (
    season_id text,
    age_group_id text,
    region_id text,
    club_id text,
    league_group_id text,
    division_name text,
    group_name text,
    match_id text,
    round text,
    round_no text,
    round_date text,
    time text,
    home_team text,
    away_team text,
    organizer text,
    venue text,
    team_result text,
    team_points text,
    wo text,
    livescore text
);

\copy stg_individual_matches
FROM :'individual_csv'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\copy stg_team_matches
FROM :'team_csv'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

DELETE FROM bridge_individual_match_player b
USING fact_individual_match f, dim_season s
WHERE b.individual_match_key = f.individual_match_key
  AND f.season_key = s.season_key
  AND s.season_id = :season_id::integer;

DELETE FROM fact_individual_match f
USING dim_season s
WHERE f.season_key = s.season_key
  AND s.season_id = :season_id::integer;

DELETE FROM dim_round r
USING dim_group g, dim_season s
WHERE r.group_key = g.group_key
  AND g.season_key = s.season_key
  AND s.season_id = :season_id::integer;

DELETE FROM dim_group g
USING dim_season s
WHERE g.season_key = s.season_key
  AND s.season_id = :season_id::integer;

DELETE FROM dim_season
WHERE season_id = :season_id::integer;

INSERT INTO dim_date (
    date_key,
    full_date,
    year_no,
    month_no,
    day_no,
    quarter_no,
    iso_week_no,
    iso_day_of_week
)
SELECT
    to_char(src.full_date, 'YYYYMMDD')::integer AS date_key,
    src.full_date,
    EXTRACT(YEAR FROM src.full_date)::smallint,
    EXTRACT(MONTH FROM src.full_date)::smallint,
    EXTRACT(DAY FROM src.full_date)::smallint,
    EXTRACT(QUARTER FROM src.full_date)::smallint,
    EXTRACT(WEEK FROM src.full_date)::smallint,
    EXTRACT(ISODOW FROM src.full_date)::smallint
FROM (
    SELECT DISTINCT to_date(round_date, 'DD-MM-YYYY') AS full_date
    FROM stg_team_matches
    WHERE nullif(trim(round_date), '') IS NOT NULL
      AND nullif(trim(season_id), '')::integer = :season_id::integer
    UNION
    SELECT DISTINCT to_date(substring(round FROM '([0-9]{2}-[0-9]{2}-[0-9]{4})'), 'DD-MM-YYYY') AS full_date
    FROM stg_individual_matches
    WHERE nullif(trim(round), '') IS NOT NULL
      AND nullif(trim(season_id), '')::integer = :season_id::integer
) src
WHERE src.full_date IS NOT NULL
ON CONFLICT (date_key) DO NOTHING;

INSERT INTO dim_season (season_id, season_label)
VALUES (
    :season_id::integer,
    :season_id::integer::text || '/' || (:season_id::integer + 1)::text
)
ON CONFLICT (season_id) DO UPDATE
SET season_label = EXCLUDED.season_label;

INSERT INTO dim_division (division_name)
SELECT DISTINCT nullif(trim(division_name), '') AS division_name
FROM (
    SELECT division_name
    FROM stg_team_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
    UNION
    SELECT division_name
    FROM stg_individual_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
) d
WHERE nullif(trim(division_name), '') IS NOT NULL
ON CONFLICT (division_name) DO NOTHING;

WITH group_source AS (
    SELECT
        nullif(trim(season_id), '')::integer AS season_id,
        nullif(trim(league_group_id), '')::bigint AS league_group_id,
        nullif(trim(division_name), '') AS division_name,
        nullif(trim(group_name), '') AS group_name,
        nullif(trim(age_group_id), '')::integer AS age_group_id,
        nullif(trim(region_id), '')::integer AS region_id
    FROM stg_team_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
    UNION ALL
    SELECT
        nullif(trim(season_id), '')::integer AS season_id,
        nullif(trim(league_group_id), '')::bigint AS league_group_id,
        nullif(trim(division_name), '') AS division_name,
        nullif(trim(group_name), '') AS group_name,
        nullif(trim(age_group_id), '')::integer AS age_group_id,
        nullif(trim(region_id), '')::integer AS region_id
    FROM stg_individual_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
),
group_agg AS (
    SELECT
        season_id,
        league_group_id,
        MAX(division_name) AS division_name,
        MAX(group_name) AS group_name,
        MAX(age_group_id) AS age_group_id,
        MAX(region_id) AS region_id
    FROM group_source
    WHERE season_id IS NOT NULL
      AND league_group_id IS NOT NULL
    GROUP BY season_id, league_group_id
)
INSERT INTO dim_group (
    season_key,
    league_group_id,
    group_name,
    division_key,
    age_group_id,
    region_id
)
SELECT
    ds.season_key,
    ga.league_group_id,
    COALESCE(ga.group_name, 'Group ' || ga.league_group_id::text) AS group_name,
    dd.division_key,
    ga.age_group_id,
    ga.region_id
FROM group_agg ga
JOIN dim_season ds
    ON ds.season_id = ga.season_id
LEFT JOIN dim_division dd
    ON dd.division_name = ga.division_name
ON CONFLICT (season_key, league_group_id) DO UPDATE
SET group_name = EXCLUDED.group_name,
    division_key = EXCLUDED.division_key,
    age_group_id = EXCLUDED.age_group_id,
    region_id = EXCLUDED.region_id;

INSERT INTO dim_team (team_name)
SELECT DISTINCT team_name
FROM (
    SELECT nullif(trim(home_team), '') AS team_name
    FROM stg_individual_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
    UNION
    SELECT nullif(trim(away_team), '') AS team_name
    FROM stg_individual_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
    UNION
    SELECT nullif(trim(winner_team), '') AS team_name
    FROM stg_individual_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
) teams
WHERE team_name IS NOT NULL
ON CONFLICT (team_name) DO NOTHING;

INSERT INTO dim_round (group_key, round_no, round_label, round_date_key)
SELECT DISTINCT
    dg.group_key,
    tm.round_no::smallint AS round_no,
    trim(tm.round) AS round_label,
    dd.date_key
FROM stg_team_matches tm
JOIN dim_season ds
    ON ds.season_id = tm.season_id::integer
JOIN dim_group dg
    ON dg.season_key = ds.season_key
   AND dg.league_group_id = tm.league_group_id::bigint
JOIN dim_date dd
    ON dd.full_date = to_date(tm.round_date, 'DD-MM-YYYY')
WHERE nullif(trim(tm.round_no), '') IS NOT NULL
  AND nullif(trim(tm.round_date), '') IS NOT NULL
  AND nullif(trim(tm.season_id), '')::integer = :season_id::integer
ON CONFLICT (group_key, round_no, round_date_key) DO NOTHING;

INSERT INTO dim_discipline (discipline_code, discipline_no, discipline_label)
SELECT DISTINCT
    trim(discipline_code),
    discipline_no::smallint,
    trim(discipline)
FROM stg_individual_matches
WHERE nullif(trim(discipline_no), '') IS NOT NULL
  AND nullif(trim(discipline_code), '') IS NOT NULL
  AND nullif(trim(season_id), '')::integer = :season_id::integer
ON CONFLICT (discipline_code, discipline_no) DO UPDATE
SET discipline_label = EXCLUDED.discipline_label;

WITH player_source AS (
    SELECT trim(player_name) AS player_name
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.home_players, ''), '\s*,\s*') AS player_name
    WHERE nullif(trim(i.season_id), '')::integer = :season_id::integer
    UNION
    SELECT trim(player_name) AS player_name
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.away_players, ''), '\s*,\s*') AS player_name
    WHERE nullif(trim(i.season_id), '')::integer = :season_id::integer
)
INSERT INTO dim_player (player_name, is_placeholder)
SELECT DISTINCT
    player_name,
    lower(player_name) LIKE '(ikke fremm%dt)%' AS is_placeholder
FROM player_source
WHERE player_name <> ''
ON CONFLICT (player_name) DO UPDATE
SET is_placeholder = dim_player.is_placeholder OR EXCLUDED.is_placeholder;

WITH scored_sets AS (
    SELECT
        i.season_id::integer AS season_id,
        i.league_group_id::bigint AS league_group_id,
        i.match_id::bigint AS match_id,
        i.discipline_no::smallint AS discipline_no,
        trim(i.discipline_code) AS discipline_code,
        trim(set_part) AS set_part
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.set_scores, ''), '\s*,\s*') AS set_part
    WHERE nullif(trim(set_part), '') IS NOT NULL
      AND nullif(trim(i.season_id), '')::integer = :season_id::integer
),
set_points AS (
    SELECT
        season_id,
        league_group_id,
        match_id,
        discipline_no,
        discipline_code,
        split_part(set_part, '-', 1)::smallint AS home_points,
        split_part(set_part, '-', 2)::smallint AS away_points
    FROM scored_sets
),
score_agg AS (
    SELECT
        season_id,
        league_group_id,
        match_id,
        discipline_no,
        discipline_code,
        COUNT(*)::smallint AS sets_played,
        SUM((home_points > away_points)::int)::smallint AS home_sets_won,
        SUM((away_points > home_points)::int)::smallint AS away_sets_won,
        SUM(home_points)::smallint AS home_points_scored,
        SUM(away_points)::smallint AS away_points_scored
    FROM set_points
    GROUP BY 1, 2, 3, 4, 5
)
INSERT INTO fact_individual_match (
    season_key,
    group_key,
    match_id,
    round_key,
    match_date_key,
    discipline_key,
    home_team_key,
    away_team_key,
    winner_team_key,
    winner_side,
    home_sets_won,
    away_sets_won,
    sets_played,
    home_points_scored,
    away_points_scored,
    is_walkover,
    walkover_code,
    set_scores_raw,
    source_round
)
SELECT
    ds.season_key,
    dg.group_key,
    i.match_id::bigint AS match_id,
    dr.round_key,
    dd.date_key AS match_date_key,
    ddisc.discipline_key,
    ht.team_key AS home_team_key,
    at.team_key AS away_team_key,
    wt.team_key AS winner_team_key,
    lower(trim(i.winner_side)) AS winner_side,
    coalesce(sa.home_sets_won, 0),
    coalesce(sa.away_sets_won, 0),
    coalesce(sa.sets_played, 0),
    coalesce(sa.home_points_scored, 0),
    coalesce(sa.away_points_scored, 0),
    (nullif(trim(i.wo), '') IS NOT NULL) AS is_walkover,
    nullif(trim(i.wo), '') AS walkover_code,
    nullif(trim(i.set_scores), '') AS set_scores_raw,
    trim(i.round) AS source_round
FROM stg_individual_matches i
JOIN stg_team_matches tm
    ON tm.match_id = i.match_id
   AND tm.season_id = i.season_id
   AND tm.league_group_id = i.league_group_id
JOIN dim_season ds
    ON ds.season_id = i.season_id::integer
JOIN dim_group dg
    ON dg.season_key = ds.season_key
   AND dg.league_group_id = i.league_group_id::bigint
JOIN dim_date dd
    ON dd.full_date = to_date(tm.round_date, 'DD-MM-YYYY')
JOIN dim_round dr
    ON dr.group_key = dg.group_key
   AND dr.round_no = tm.round_no::smallint
   AND dr.round_date_key = dd.date_key
JOIN dim_discipline ddisc
    ON ddisc.discipline_code = trim(i.discipline_code)
   AND ddisc.discipline_no = i.discipline_no::smallint
JOIN dim_team ht
    ON ht.team_name = trim(i.home_team)
JOIN dim_team at
    ON at.team_name = trim(i.away_team)
LEFT JOIN dim_team wt
    ON wt.team_name = trim(i.winner_team)
LEFT JOIN score_agg sa
    ON sa.season_id = i.season_id::integer
   AND sa.league_group_id = i.league_group_id::bigint
   AND sa.match_id = i.match_id::bigint
   AND sa.discipline_no = i.discipline_no::smallint
   AND sa.discipline_code = trim(i.discipline_code)
WHERE nullif(trim(i.match_id), '') IS NOT NULL
  AND nullif(trim(i.discipline_no), '') IS NOT NULL
  AND nullif(trim(i.discipline_code), '') IS NOT NULL
  AND nullif(trim(i.winner_side), '') IS NOT NULL
  AND nullif(trim(i.season_id), '')::integer = :season_id::integer
ON CONFLICT (season_key, group_key, match_id, discipline_key) DO NOTHING;

WITH source_players AS (
    SELECT
        i.season_id::integer AS season_id,
        i.league_group_id::bigint AS league_group_id,
        i.match_id::bigint AS match_id,
        i.discipline_no::smallint AS discipline_no,
        trim(i.discipline_code) AS discipline_code,
        'H'::char(1) AS side_code,
        p.ordinality::smallint AS player_slot,
        trim(p.player_name) AS player_name
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.home_players, ''), '\s*,\s*') WITH ORDINALITY AS p(player_name, ordinality)
    WHERE nullif(trim(i.season_id), '')::integer = :season_id::integer
    UNION ALL
    SELECT
        i.season_id::integer AS season_id,
        i.league_group_id::bigint AS league_group_id,
        i.match_id::bigint AS match_id,
        i.discipline_no::smallint AS discipline_no,
        trim(i.discipline_code) AS discipline_code,
        'A'::char(1) AS side_code,
        p.ordinality::smallint AS player_slot,
        trim(p.player_name) AS player_name
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.away_players, ''), '\s*,\s*') WITH ORDINALITY AS p(player_name, ordinality)
    WHERE nullif(trim(i.season_id), '')::integer = :season_id::integer
)
INSERT INTO bridge_individual_match_player (
    individual_match_key,
    side_code,
    player_slot,
    player_key
)
SELECT
    f.individual_match_key,
    sp.side_code,
    sp.player_slot,
    dp.player_key
FROM source_players sp
JOIN dim_season ds
    ON ds.season_id = sp.season_id
JOIN dim_group dg
    ON dg.season_key = ds.season_key
   AND dg.league_group_id = sp.league_group_id
JOIN dim_discipline dd
    ON dd.discipline_code = sp.discipline_code
   AND dd.discipline_no = sp.discipline_no
JOIN fact_individual_match f
    ON f.season_key = ds.season_key
   AND f.group_key = dg.group_key
   AND f.match_id = sp.match_id
   AND f.discipline_key = dd.discipline_key
JOIN dim_player dp
    ON dp.player_name = sp.player_name
WHERE sp.player_name <> ''
ON CONFLICT (individual_match_key, side_code, player_slot) DO NOTHING;

SELECT
    :season_id::integer AS refreshed_season_id,
    (SELECT COUNT(*)
     FROM fact_individual_match f
     JOIN dim_season s ON s.season_key = f.season_key
     WHERE s.season_id = :season_id::integer) AS fact_rows_for_season,
    (SELECT COUNT(*)
     FROM dim_group g
     JOIN dim_season s ON s.season_key = g.season_key
     WHERE s.season_id = :season_id::integer) AS groups_for_season;
