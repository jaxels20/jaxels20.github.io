\set ON_ERROR_STOP on

\if :{?season_id}
\else
\echo 'Missing required variable: season_id'
\echo 'Example: psql -d postgres -v season_id=2022 -v individual_csv="..." -v team_csv="..." -f sql/refresh_team_fact_dw_season.sql'
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

SELECT 'CREATE DATABASE badminton_dw_team'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'badminton_dw_team'
)\gexec

\connect badminton_dw_team

CREATE SCHEMA IF NOT EXISTS dw;
SET search_path TO dw, public;

SELECT (to_regclass('dw.fact_team_match') IS NOT NULL)::int AS has_schema \gset

\if :has_schema
\else
\echo 'Schema for badminton_dw_team is missing.'
\echo 'Run sql/build_team_fact_dw.sql once before incremental refresh.'
\quit 1
\endif

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

COPY stg_team_matches
FROM :'team_csv'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

COPY stg_individual_matches
FROM :'individual_csv'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

DELETE FROM bridge_team_match_player b
USING fact_team_match f, dim_season s
WHERE b.team_match_key = f.team_match_key
  AND f.season_key = s.season_key
  AND s.season_id = :season_id::integer;

DELETE FROM fact_team_match f
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
    FROM stg_team_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
    UNION
    SELECT nullif(trim(away_team), '') AS team_name
    FROM stg_team_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
    UNION
    SELECT nullif(trim(home_team), '') AS team_name
    FROM stg_individual_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
    UNION
    SELECT nullif(trim(away_team), '') AS team_name
    FROM stg_individual_matches
    WHERE nullif(trim(season_id), '')::integer = :season_id::integer
) teams
WHERE team_name IS NOT NULL
ON CONFLICT (team_name) DO NOTHING;

INSERT INTO dim_round (group_key, round_no, round_label, round_date_key)
SELECT DISTINCT
    dg.group_key,
    tm.round_no::smallint,
    trim(tm.round),
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

INSERT INTO dim_organizer (organizer_name)
SELECT DISTINCT nullif(trim(organizer), '') AS organizer_name
FROM stg_team_matches
WHERE nullif(trim(organizer), '') IS NOT NULL
  AND nullif(trim(season_id), '')::integer = :season_id::integer
ON CONFLICT (organizer_name) DO NOTHING;

INSERT INTO dim_venue (venue_name)
SELECT DISTINCT nullif(trim(venue), '') AS venue_name
FROM stg_team_matches
WHERE nullif(trim(venue), '') IS NOT NULL
  AND nullif(trim(season_id), '')::integer = :season_id::integer
ON CONFLICT (venue_name) DO NOTHING;

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

WITH parsed_matches AS (
    SELECT
        tm.season_id::integer AS season_id,
        tm.league_group_id::bigint AS league_group_id,
        tm.match_id::bigint AS match_id,
        trim(tm.round) AS round_label,
        tm.round_no::smallint AS round_no,
        to_date(tm.round_date, 'DD-MM-YYYY') AS match_date,
        trim(tm.time) AS scheduled_time_raw,
        nullif(trim(tm.home_team), '') AS home_team_name,
        nullif(trim(tm.away_team), '') AS away_team_name,
        nullif(trim(tm.organizer), '') AS organizer_name,
        nullif(trim(tm.venue), '') AS venue_name,
        regexp_replace(coalesce(tm.team_result, ''), '\s', '', 'g') AS team_result_clean,
        regexp_replace(coalesce(tm.team_points, ''), '\s', '', 'g') AS team_points_clean,
        nullif(trim(tm.wo), '') AS walkover_code,
        nullif(trim(tm.livescore), '') AS livescore_url,
        nullif(trim(tm.team_result), '') AS source_team_result,
        nullif(trim(tm.team_points), '') AS source_team_points
    FROM stg_team_matches tm
    WHERE nullif(trim(tm.season_id), '')::integer = :season_id::integer
),
parsed_scores AS (
    SELECT
        pm.*,
        CASE
            WHEN pm.team_result_clean ~ '^[0-9]+-[0-9]+$'
            THEN split_part(pm.team_result_clean, '-', 1)::smallint
        END AS home_disciplines_won,
        CASE
            WHEN pm.team_result_clean ~ '^[0-9]+-[0-9]+$'
            THEN split_part(pm.team_result_clean, '-', 2)::smallint
        END AS away_disciplines_won,
        CASE
            WHEN pm.team_points_clean ~ '^[0-9]+-[0-9]+$'
            THEN split_part(pm.team_points_clean, '-', 1)::smallint
        END AS home_team_points,
        CASE
            WHEN pm.team_points_clean ~ '^[0-9]+-[0-9]+$'
            THEN split_part(pm.team_points_clean, '-', 2)::smallint
        END AS away_team_points,
        CASE
            WHEN substring(pm.scheduled_time_raw FROM '([0-9]{2}:[0-9]{2})$') IS NOT NULL
            THEN substring(pm.scheduled_time_raw FROM '([0-9]{2}:[0-9]{2})$')::time
        END AS scheduled_time
    FROM parsed_matches pm
)
INSERT INTO fact_team_match (
    season_key,
    group_key,
    match_id,
    round_key,
    match_date_key,
    scheduled_time,
    scheduled_time_raw,
    home_team_key,
    away_team_key,
    organizer_key,
    venue_key,
    home_disciplines_won,
    away_disciplines_won,
    home_team_points,
    away_team_points,
    home_win,
    away_win,
    is_draw,
    discipline_margin,
    team_points_margin,
    has_walkover,
    walkover_code,
    livescore_url,
    source_team_result,
    source_team_points
)
SELECT
    ds.season_key,
    dg.group_key,
    ps.match_id,
    dr.round_key,
    dd.date_key AS match_date_key,
    ps.scheduled_time,
    ps.scheduled_time_raw,
    ht.team_key,
    at.team_key,
    org.organizer_key,
    ven.venue_key,
    ps.home_disciplines_won,
    ps.away_disciplines_won,
    ps.home_team_points,
    ps.away_team_points,
    CASE
        WHEN ps.home_disciplines_won IS NOT NULL AND ps.away_disciplines_won IS NOT NULL
        THEN ps.home_disciplines_won > ps.away_disciplines_won
    END AS home_win,
    CASE
        WHEN ps.home_disciplines_won IS NOT NULL AND ps.away_disciplines_won IS NOT NULL
        THEN ps.away_disciplines_won > ps.home_disciplines_won
    END AS away_win,
    CASE
        WHEN ps.home_disciplines_won IS NOT NULL AND ps.away_disciplines_won IS NOT NULL
        THEN ps.home_disciplines_won = ps.away_disciplines_won
    END AS is_draw,
    CASE
        WHEN ps.home_disciplines_won IS NOT NULL AND ps.away_disciplines_won IS NOT NULL
        THEN ps.home_disciplines_won - ps.away_disciplines_won
    END AS discipline_margin,
    CASE
        WHEN ps.home_team_points IS NOT NULL AND ps.away_team_points IS NOT NULL
        THEN ps.home_team_points - ps.away_team_points
    END AS team_points_margin,
    ps.walkover_code IS NOT NULL AS has_walkover,
    ps.walkover_code,
    ps.livescore_url,
    ps.source_team_result,
    ps.source_team_points
FROM parsed_scores ps
JOIN dim_season ds
    ON ds.season_id = ps.season_id
JOIN dim_group dg
    ON dg.season_key = ds.season_key
   AND dg.league_group_id = ps.league_group_id
JOIN dim_date dd
    ON dd.full_date = ps.match_date
JOIN dim_round dr
    ON dr.group_key = dg.group_key
   AND dr.round_no = ps.round_no
   AND dr.round_date_key = dd.date_key
JOIN dim_team ht
    ON ht.team_name = ps.home_team_name
JOIN dim_team at
    ON at.team_name = ps.away_team_name
LEFT JOIN dim_organizer org
    ON org.organizer_name = ps.organizer_name
LEFT JOIN dim_venue ven
    ON ven.venue_name = ps.venue_name
ON CONFLICT (season_key, group_key, match_id) DO NOTHING;

WITH team_player_rows AS (
    SELECT
        i.season_id::integer AS season_id,
        i.league_group_id::bigint AS league_group_id,
        i.match_id::bigint AS match_id,
        trim(i.home_team) AS team_name,
        trim(p.player_name) AS player_name
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.home_players, ''), '\s*,\s*') AS p(player_name)
    WHERE trim(p.player_name) <> ''
      AND nullif(trim(i.season_id), '')::integer = :season_id::integer
    UNION ALL
    SELECT
        i.season_id::integer AS season_id,
        i.league_group_id::bigint AS league_group_id,
        i.match_id::bigint AS match_id,
        trim(i.away_team) AS team_name,
        trim(p.player_name) AS player_name
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.away_players, ''), '\s*,\s*') AS p(player_name)
    WHERE trim(p.player_name) <> ''
      AND nullif(trim(i.season_id), '')::integer = :season_id::integer
),
team_player_agg AS (
    SELECT
        season_id,
        league_group_id,
        match_id,
        team_name,
        player_name,
        COUNT(*)::smallint AS disciplines_played
    FROM team_player_rows
    GROUP BY 1, 2, 3, 4, 5
)
INSERT INTO bridge_team_match_player (
    team_match_key,
    team_key,
    player_key,
    disciplines_played
)
SELECT
    f.team_match_key,
    dt.team_key,
    dp.player_key,
    tpa.disciplines_played
FROM team_player_agg tpa
JOIN dim_season ds
    ON ds.season_id = tpa.season_id
JOIN dim_group dg
    ON dg.season_key = ds.season_key
   AND dg.league_group_id = tpa.league_group_id
JOIN fact_team_match f
    ON f.season_key = ds.season_key
   AND f.group_key = dg.group_key
   AND f.match_id = tpa.match_id
JOIN dim_team dt
    ON dt.team_name = tpa.team_name
JOIN dim_player dp
    ON dp.player_name = tpa.player_name
ON CONFLICT (team_match_key, team_key, player_key) DO UPDATE
SET disciplines_played = EXCLUDED.disciplines_played;

SELECT
    :season_id::integer AS refreshed_season_id,
    (SELECT COUNT(*)
     FROM fact_team_match f
     JOIN dim_season s ON s.season_key = f.season_key
     WHERE s.season_id = :season_id::integer) AS fact_rows_for_season,
    (SELECT COUNT(*)
     FROM dim_group g
     JOIN dim_season s ON s.season_key = g.season_key
     WHERE s.season_id = :season_id::integer) AS groups_for_season;
