\set ON_ERROR_STOP on

-- Override these with:
-- psql -v individual_csv='/abs/path/individual.csv' -v team_csv='/abs/path/team.csv' -f sql/build_team_fact_dw.sql
\if :{?individual_csv}
\else
\set individual_csv '/Users/jeppeaxelsen/Desktop/github-folder/test5/badminton_export/season_2025_all_groups_individual_matches.csv'
\endif

\if :{?team_csv}
\else
\set team_csv '/Users/jeppeaxelsen/Desktop/github-folder/test5/badminton_export/season_2025_all_groups_team_matches.csv'
\endif

SELECT 'CREATE DATABASE badminton_dw_team'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'badminton_dw_team'
)\gexec

\connect badminton_dw_team

CREATE SCHEMA IF NOT EXISTS dw;
SET search_path TO dw, public;

DROP TABLE IF EXISTS bridge_team_match_player CASCADE;
DROP TABLE IF EXISTS fact_team_match CASCADE;
DROP TABLE IF EXISTS dim_player CASCADE;
DROP TABLE IF EXISTS dim_venue CASCADE;
DROP TABLE IF EXISTS dim_organizer CASCADE;
DROP TABLE IF EXISTS dim_round CASCADE;
DROP TABLE IF EXISTS dim_group CASCADE;
DROP TABLE IF EXISTS dim_division CASCADE;
DROP TABLE IF EXISTS dim_season CASCADE;
DROP TABLE IF EXISTS dim_team CASCADE;
DROP TABLE IF EXISTS dim_date CASCADE;
DROP TABLE IF EXISTS stg_individual_matches CASCADE;
DROP TABLE IF EXISTS stg_team_matches CASCADE;

CREATE TABLE stg_team_matches (
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

CREATE TABLE stg_individual_matches (
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

\copy stg_team_matches
FROM :'team_csv'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\copy stg_individual_matches
FROM :'individual_csv'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

CREATE TABLE dim_date (
    date_key integer PRIMARY KEY,
    full_date date NOT NULL UNIQUE,
    year_no smallint NOT NULL,
    month_no smallint NOT NULL,
    day_no smallint NOT NULL,
    quarter_no smallint NOT NULL,
    iso_week_no smallint NOT NULL,
    iso_day_of_week smallint NOT NULL
);

CREATE TABLE dim_season (
    season_key bigserial PRIMARY KEY,
    season_id integer NOT NULL UNIQUE,
    season_label text NOT NULL
);

CREATE TABLE dim_division (
    division_key bigserial PRIMARY KEY,
    division_name text NOT NULL UNIQUE
);

CREATE TABLE dim_group (
    group_key bigserial PRIMARY KEY,
    season_key bigint NOT NULL REFERENCES dim_season(season_key),
    league_group_id bigint NOT NULL,
    group_name text NOT NULL,
    division_key bigint REFERENCES dim_division(division_key),
    age_group_id integer,
    region_id integer,
    UNIQUE (season_key, league_group_id)
);

CREATE TABLE dim_team (
    team_key bigserial PRIMARY KEY,
    team_name text NOT NULL UNIQUE
);

CREATE TABLE dim_round (
    round_key bigserial PRIMARY KEY,
    group_key bigint NOT NULL REFERENCES dim_group(group_key),
    round_no smallint NOT NULL,
    round_label text NOT NULL,
    round_date_key integer NOT NULL REFERENCES dim_date(date_key),
    UNIQUE (group_key, round_no, round_date_key)
);

CREATE TABLE dim_organizer (
    organizer_key bigserial PRIMARY KEY,
    organizer_name text NOT NULL UNIQUE
);

CREATE TABLE dim_venue (
    venue_key bigserial PRIMARY KEY,
    venue_name text NOT NULL UNIQUE
);

CREATE TABLE dim_player (
    player_key bigserial PRIMARY KEY,
    player_name text NOT NULL UNIQUE,
    is_placeholder boolean NOT NULL DEFAULT false
);

CREATE TABLE fact_team_match (
    team_match_key bigserial PRIMARY KEY,
    season_key bigint NOT NULL REFERENCES dim_season(season_key),
    group_key bigint NOT NULL REFERENCES dim_group(group_key),
    match_id bigint NOT NULL,
    round_key bigint NOT NULL REFERENCES dim_round(round_key),
    match_date_key integer NOT NULL REFERENCES dim_date(date_key),
    scheduled_time time,
    scheduled_time_raw text,
    home_team_key bigint NOT NULL REFERENCES dim_team(team_key),
    away_team_key bigint NOT NULL REFERENCES dim_team(team_key),
    organizer_key bigint REFERENCES dim_organizer(organizer_key),
    venue_key bigint REFERENCES dim_venue(venue_key),
    home_disciplines_won smallint,
    away_disciplines_won smallint,
    home_team_points smallint,
    away_team_points smallint,
    home_win boolean,
    away_win boolean,
    is_draw boolean,
    discipline_margin smallint,
    team_points_margin smallint,
    has_walkover boolean NOT NULL DEFAULT false,
    walkover_code text,
    livescore_url text,
    source_team_result text,
    source_team_points text,
    UNIQUE (season_key, group_key, match_id)
);

CREATE TABLE bridge_team_match_player (
    team_match_key bigint NOT NULL REFERENCES fact_team_match(team_match_key) ON DELETE CASCADE,
    team_key bigint NOT NULL REFERENCES dim_team(team_key),
    player_key bigint NOT NULL REFERENCES dim_player(player_key),
    disciplines_played smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (team_match_key, team_key, player_key)
);

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
) src
WHERE src.full_date IS NOT NULL;

INSERT INTO dim_season (season_id, season_label)
SELECT DISTINCT
    s.season_id,
    s.season_id::text || '/' || (s.season_id + 1)::text AS season_label
FROM (
    SELECT nullif(trim(season_id), '')::integer AS season_id
    FROM stg_team_matches
    WHERE nullif(trim(season_id), '') IS NOT NULL
    UNION
    SELECT nullif(trim(season_id), '')::integer AS season_id
    FROM stg_individual_matches
    WHERE nullif(trim(season_id), '') IS NOT NULL
) s
WHERE s.season_id IS NOT NULL;

INSERT INTO dim_division (division_name)
SELECT DISTINCT nullif(trim(division_name), '') AS division_name
FROM (
    SELECT division_name FROM stg_team_matches
    UNION
    SELECT division_name FROM stg_individual_matches
) d
WHERE nullif(trim(division_name), '') IS NOT NULL;

WITH group_source AS (
    SELECT
        nullif(trim(season_id), '')::integer AS season_id,
        nullif(trim(league_group_id), '')::bigint AS league_group_id,
        nullif(trim(division_name), '') AS division_name,
        nullif(trim(group_name), '') AS group_name,
        nullif(trim(age_group_id), '')::integer AS age_group_id,
        nullif(trim(region_id), '')::integer AS region_id
    FROM stg_team_matches
    UNION ALL
    SELECT
        nullif(trim(season_id), '')::integer AS season_id,
        nullif(trim(league_group_id), '')::bigint AS league_group_id,
        nullif(trim(division_name), '') AS division_name,
        nullif(trim(group_name), '') AS group_name,
        nullif(trim(age_group_id), '')::integer AS age_group_id,
        nullif(trim(region_id), '')::integer AS region_id
    FROM stg_individual_matches
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
    ON dd.division_name = ga.division_name;

INSERT INTO dim_team (team_name)
SELECT DISTINCT team_name
FROM (
    SELECT nullif(trim(home_team), '') AS team_name FROM stg_team_matches
    UNION
    SELECT nullif(trim(away_team), '') AS team_name FROM stg_team_matches
    UNION
    SELECT nullif(trim(home_team), '') AS team_name FROM stg_individual_matches
    UNION
    SELECT nullif(trim(away_team), '') AS team_name FROM stg_individual_matches
) teams
WHERE team_name IS NOT NULL;

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
  AND nullif(trim(tm.round_date), '') IS NOT NULL;

INSERT INTO dim_organizer (organizer_name)
SELECT DISTINCT nullif(trim(organizer), '') AS organizer_name
FROM stg_team_matches
WHERE nullif(trim(organizer), '') IS NOT NULL;

INSERT INTO dim_venue (venue_name)
SELECT DISTINCT nullif(trim(venue), '') AS venue_name
FROM stg_team_matches
WHERE nullif(trim(venue), '') IS NOT NULL;

WITH player_source AS (
    SELECT trim(player_name) AS player_name
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.home_players, ''), '\s*,\s*') AS player_name
    UNION
    SELECT trim(player_name) AS player_name
    FROM stg_individual_matches i
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(i.away_players, ''), '\s*,\s*') AS player_name
)
INSERT INTO dim_player (player_name, is_placeholder)
SELECT DISTINCT
    player_name,
    lower(player_name) LIKE '(ikke fremm%dt)%' AS is_placeholder
FROM player_source
WHERE player_name <> '';

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
    ON ven.venue_name = ps.venue_name;

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
    ON dp.player_name = tpa.player_name;

CREATE INDEX ix_fact_team_match_season_key ON fact_team_match(season_key);
CREATE INDEX ix_fact_team_match_group_key ON fact_team_match(group_key);
CREATE INDEX ix_fact_team_match_round_key ON fact_team_match(round_key);
CREATE INDEX ix_fact_team_match_date_key ON fact_team_match(match_date_key);
CREATE INDEX ix_fact_team_match_home_team_key ON fact_team_match(home_team_key);
CREATE INDEX ix_fact_team_match_away_team_key ON fact_team_match(away_team_key);
CREATE INDEX ix_bridge_team_match_player_player_key ON bridge_team_match_player(player_key);

SELECT
    (SELECT COUNT(*) FROM dim_date) AS dim_date_rows,
    (SELECT COUNT(*) FROM dim_season) AS dim_season_rows,
    (SELECT COUNT(*) FROM dim_division) AS dim_division_rows,
    (SELECT COUNT(*) FROM dim_group) AS dim_group_rows,
    (SELECT COUNT(*) FROM dim_round) AS dim_round_rows,
    (SELECT COUNT(*) FROM dim_team) AS dim_team_rows,
    (SELECT COUNT(*) FROM dim_organizer) AS dim_organizer_rows,
    (SELECT COUNT(*) FROM dim_venue) AS dim_venue_rows,
    (SELECT COUNT(*) FROM dim_player) AS dim_player_rows,
    (SELECT COUNT(*) FROM fact_team_match) AS fact_team_match_rows,
    (SELECT COUNT(*) FROM bridge_team_match_player) AS bridge_rows;
