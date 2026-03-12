\set ON_ERROR_STOP on

-- Override these with:
-- psql -v individual_csv='/abs/path/individual.csv' -v team_csv='/abs/path/team.csv' -f sql/build_individual_fact_dw.sql
\if :{?individual_csv}
\else
\set individual_csv '/Users/jeppeaxelsen/Desktop/github-folder/test5/badminton_export/season_2025_all_groups_individual_matches.csv'
\endif

\if :{?team_csv}
\else
\set team_csv '/Users/jeppeaxelsen/Desktop/github-folder/test5/badminton_export/season_2025_all_groups_team_matches.csv'
\endif

SELECT 'CREATE DATABASE badminton_dw_individual'
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'badminton_dw_individual'
)\gexec

\connect badminton_dw_individual

CREATE SCHEMA IF NOT EXISTS dw;
SET search_path TO dw, public;

DROP TABLE IF EXISTS bridge_individual_match_player CASCADE;
DROP TABLE IF EXISTS fact_individual_match CASCADE;
DROP TABLE IF EXISTS dim_player CASCADE;
DROP TABLE IF EXISTS dim_discipline CASCADE;
DROP TABLE IF EXISTS dim_round CASCADE;
DROP TABLE IF EXISTS dim_group CASCADE;
DROP TABLE IF EXISTS dim_division CASCADE;
DROP TABLE IF EXISTS dim_season CASCADE;
DROP TABLE IF EXISTS dim_team CASCADE;
DROP TABLE IF EXISTS dim_date CASCADE;
DROP TABLE IF EXISTS stg_individual_matches CASCADE;
DROP TABLE IF EXISTS stg_team_matches CASCADE;

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

\copy stg_individual_matches
FROM :'individual_csv'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\copy stg_team_matches
FROM :'team_csv'
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

CREATE TABLE dim_discipline (
    discipline_key bigserial PRIMARY KEY,
    discipline_code text NOT NULL,
    discipline_no smallint NOT NULL,
    discipline_label text NOT NULL,
    UNIQUE (discipline_code, discipline_no)
);

CREATE TABLE dim_player (
    player_key bigserial PRIMARY KEY,
    player_name text NOT NULL UNIQUE,
    is_placeholder boolean NOT NULL DEFAULT false
);

CREATE TABLE fact_individual_match (
    individual_match_key bigserial PRIMARY KEY,
    season_key bigint NOT NULL REFERENCES dim_season(season_key),
    group_key bigint NOT NULL REFERENCES dim_group(group_key),
    match_id bigint NOT NULL,
    round_key bigint NOT NULL REFERENCES dim_round(round_key),
    match_date_key integer NOT NULL REFERENCES dim_date(date_key),
    discipline_key bigint NOT NULL REFERENCES dim_discipline(discipline_key),
    home_team_key bigint NOT NULL REFERENCES dim_team(team_key),
    away_team_key bigint NOT NULL REFERENCES dim_team(team_key),
    winner_team_key bigint REFERENCES dim_team(team_key),
    winner_side text NOT NULL CHECK (winner_side IN ('home', 'away')),
    home_sets_won smallint NOT NULL DEFAULT 0,
    away_sets_won smallint NOT NULL DEFAULT 0,
    sets_played smallint NOT NULL DEFAULT 0,
    home_points_scored smallint NOT NULL DEFAULT 0,
    away_points_scored smallint NOT NULL DEFAULT 0,
    is_walkover boolean NOT NULL DEFAULT false,
    walkover_code text,
    set_scores_raw text,
    source_round text,
    UNIQUE (season_key, group_key, match_id, discipline_key)
);

CREATE TABLE bridge_individual_match_player (
    individual_match_key bigint NOT NULL REFERENCES fact_individual_match(individual_match_key) ON DELETE CASCADE,
    side_code char(1) NOT NULL CHECK (side_code IN ('H', 'A')),
    player_slot smallint NOT NULL CHECK (player_slot BETWEEN 1 AND 2),
    player_key bigint NOT NULL REFERENCES dim_player(player_key),
    PRIMARY KEY (individual_match_key, side_code, player_slot)
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
    UNION
    SELECT DISTINCT to_date(substring(round FROM '([0-9]{2}-[0-9]{2}-[0-9]{4})'), 'DD-MM-YYYY') AS full_date
    FROM stg_individual_matches
    WHERE nullif(trim(round), '') IS NOT NULL
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
    SELECT nullif(trim(home_team), '') AS team_name FROM stg_individual_matches
    UNION
    SELECT nullif(trim(away_team), '') AS team_name FROM stg_individual_matches
    UNION
    SELECT nullif(trim(winner_team), '') AS team_name FROM stg_individual_matches
) teams
WHERE team_name IS NOT NULL;

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
  AND nullif(trim(tm.round_date), '') IS NOT NULL;

INSERT INTO dim_discipline (discipline_code, discipline_no, discipline_label)
SELECT DISTINCT
    trim(discipline_code),
    discipline_no::smallint,
    trim(discipline)
FROM stg_individual_matches
WHERE nullif(trim(discipline_no), '') IS NOT NULL
  AND nullif(trim(discipline_code), '') IS NOT NULL;

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
  AND nullif(trim(i.winner_side), '') IS NOT NULL;

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
WHERE sp.player_name <> '';

CREATE INDEX ix_fact_individual_match_season_key ON fact_individual_match(season_key);
CREATE INDEX ix_fact_individual_match_group_key ON fact_individual_match(group_key);
CREATE INDEX ix_fact_individual_match_round_key ON fact_individual_match(round_key);
CREATE INDEX ix_fact_individual_match_date_key ON fact_individual_match(match_date_key);
CREATE INDEX ix_fact_individual_match_home_team_key ON fact_individual_match(home_team_key);
CREATE INDEX ix_fact_individual_match_away_team_key ON fact_individual_match(away_team_key);
CREATE INDEX ix_bridge_individual_match_player_player_key ON bridge_individual_match_player(player_key);

SELECT
    (SELECT COUNT(*) FROM dim_date) AS dim_date_rows,
    (SELECT COUNT(*) FROM dim_season) AS dim_season_rows,
    (SELECT COUNT(*) FROM dim_division) AS dim_division_rows,
    (SELECT COUNT(*) FROM dim_group) AS dim_group_rows,
    (SELECT COUNT(*) FROM dim_round) AS dim_round_rows,
    (SELECT COUNT(*) FROM dim_team) AS dim_team_rows,
    (SELECT COUNT(*) FROM dim_discipline) AS dim_discipline_rows,
    (SELECT COUNT(*) FROM dim_player) AS dim_player_rows,
    (SELECT COUNT(*) FROM fact_individual_match) AS fact_individual_match_rows,
    (SELECT COUNT(*) FROM bridge_individual_match_player) AS bridge_rows;
