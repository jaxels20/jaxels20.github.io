\set ON_ERROR_STOP on

\if :{?team_a}
\else
\echo 'Missing required variable: team_a'
\echo 'Example:'
\echo '  /opt/homebrew/bin/psql-18 -h /tmp -d badminton_dw_individual -v team_a=''Vendsyssel 2'' -v team_b=''Christiansbjerg'' -v season_id=2025 -f sql/team_head_to_head_report.sql'
\quit 1
\endif

\if :{?team_b}
\else
\echo 'Missing required variable: team_b'
\echo 'Example:'
\echo '  /opt/homebrew/bin/psql-18 -h /tmp -d badminton_dw_individual -v team_a=''Vendsyssel 2'' -v team_b=''Christiansbjerg'' -v season_id=2025 -f sql/team_head_to_head_report.sql'
\quit 1
\endif

\if :{?season_id}
\else
\set season_id ''
\endif

SELECT (lower(:'team_a') = lower(:'team_b'))::int AS same_team \gset

\if :same_team
\echo 'team_a and team_b must be different teams.'
\quit 1
\endif

\pset border 2
\pset linestyle ascii
\pset null '-'
\pset pager off

SET search_path TO dw, public;

DROP VIEW IF EXISTS tmp_team_match_results;
DROP VIEW IF EXISTS tmp_team_individual_matches;
DROP TABLE IF EXISTS tmp_selected_teams;

CREATE TEMP TABLE tmp_selected_teams (
    team_code char(1) PRIMARY KEY,
    requested_team text NOT NULL
);

INSERT INTO tmp_selected_teams (team_code, requested_team)
VALUES
    ('A', :'team_a'),
    ('B', :'team_b');

CREATE TEMP VIEW tmp_team_individual_matches AS
SELECT
    st.team_code,
    st.requested_team,
    dseason.season_id,
    f.individual_match_key,
    f.match_id,
    dd.full_date AS match_date,
    dr.round_no,
    dr.round_label,
    ddisc.discipline_code,
    ddisc.discipline_no,
    ddisc.discipline_label,
    'H'::char(1) AS team_side_code,
    ht.team_name AS team_name,
    at.team_name AS opponent_team_name,
    f.is_walkover,
    f.walkover_code,
    (f.winner_side = 'home') AS is_win,
    f.home_sets_won AS sets_won,
    f.away_sets_won AS sets_lost,
    f.home_points_scored AS points_won,
    f.away_points_scored AS points_lost,
    f.sets_played,
    f.set_scores_raw
FROM fact_individual_match f
JOIN dim_season dseason
    ON dseason.season_key = f.season_key
JOIN dim_date dd
    ON dd.date_key = f.match_date_key
JOIN dim_round dr
    ON dr.round_key = f.round_key
JOIN dim_discipline ddisc
    ON ddisc.discipline_key = f.discipline_key
JOIN dim_team ht
    ON ht.team_key = f.home_team_key
JOIN dim_team at
    ON at.team_key = f.away_team_key
JOIN tmp_selected_teams st
    ON lower(ht.team_name) = lower(st.requested_team)
WHERE (
      NULLIF(:'season_id', '') IS NULL
      OR dseason.season_id = NULLIF(:'season_id', '')::integer
)

UNION ALL

SELECT
    st.team_code,
    st.requested_team,
    dseason.season_id,
    f.individual_match_key,
    f.match_id,
    dd.full_date AS match_date,
    dr.round_no,
    dr.round_label,
    ddisc.discipline_code,
    ddisc.discipline_no,
    ddisc.discipline_label,
    'A'::char(1) AS team_side_code,
    at.team_name AS team_name,
    ht.team_name AS opponent_team_name,
    f.is_walkover,
    f.walkover_code,
    (f.winner_side = 'away') AS is_win,
    f.away_sets_won AS sets_won,
    f.home_sets_won AS sets_lost,
    f.away_points_scored AS points_won,
    f.home_points_scored AS points_lost,
    f.sets_played,
    f.set_scores_raw
FROM fact_individual_match f
JOIN dim_season dseason
    ON dseason.season_key = f.season_key
JOIN dim_date dd
    ON dd.date_key = f.match_date_key
JOIN dim_round dr
    ON dr.round_key = f.round_key
JOIN dim_discipline ddisc
    ON ddisc.discipline_key = f.discipline_key
JOIN dim_team ht
    ON ht.team_key = f.home_team_key
JOIN dim_team at
    ON at.team_key = f.away_team_key
JOIN tmp_selected_teams st
    ON lower(at.team_name) = lower(st.requested_team)
WHERE (
      NULLIF(:'season_id', '') IS NULL
      OR dseason.season_id = NULLIF(:'season_id', '')::integer
);

CREATE TEMP VIEW tmp_team_match_results AS
SELECT
    team_code,
    season_id,
    match_id,
    match_date,
    round_no,
    round_label,
    MAX(team_name) AS team_name,
    MAX(opponent_team_name) AS opponent_team_name,
    MAX(team_side_code) AS team_side_code,
    COUNT(*) AS disciplines_played,
    COUNT(*) FILTER (WHERE is_win) AS disciplines_won,
    COUNT(*) FILTER (WHERE NOT is_win) AS disciplines_lost,
    COUNT(*) FILTER (WHERE is_walkover) AS walkovers_in_match,
    COALESCE(SUM(sets_won), 0) AS sets_won,
    COALESCE(SUM(sets_lost), 0) AS sets_lost,
    COALESCE(SUM(points_won), 0) AS points_won,
    COALESCE(SUM(points_lost), 0) AS points_lost
FROM tmp_team_individual_matches
GROUP BY team_code, season_id, match_id, match_date, round_no, round_label;

SELECT
    COUNT(*) FILTER (WHERE team_code = 'A')::int AS individual_rows_a,
    COUNT(*) FILTER (WHERE team_code = 'B')::int AS individual_rows_b,
    (COUNT(*) FILTER (WHERE team_code = 'A') > 0)::int AS has_rows_a,
    (COUNT(*) FILTER (WHERE team_code = 'B') > 0)::int AS has_rows_b,
    COUNT(*)::int AS total_individual_rows
FROM tmp_team_individual_matches
\gset

\echo ''
\echo '============================================='
\echo 'Team Head-to-Head Comparison Report'
\echo '============================================='
\echo ''
SELECT
    :'team_a' AS requested_team_a,
    :'team_b' AS requested_team_b,
    NULLIF(:'season_id', '') AS requested_season_id,
    :individual_rows_a::int AS team_a_individual_rows,
    :individual_rows_b::int AS team_b_individual_rows,
    :total_individual_rows::int AS total_individual_rows;

\if :has_rows_a
\else
\echo ''
\echo 'No rows found for team_a. Similar names:'
SELECT team_name AS similar_team_name
FROM dim_team
WHERE team_name ILIKE '%' || :'team_a' || '%'
ORDER BY team_name
LIMIT 20;
\endif

\if :has_rows_b
\else
\echo ''
\echo 'No rows found for team_b. Similar names:'
SELECT team_name AS similar_team_name
FROM dim_team
WHERE team_name ILIKE '%' || :'team_b' || '%'
ORDER BY team_name
LIMIT 20;
\endif

SELECT (:has_rows_a::int = 1 AND :has_rows_b::int = 1)::int AS can_compare \gset

\if :can_compare

\echo ''
\echo 'Overall Comparison (side-by-side)'
WITH individual AS (
    SELECT
        team_code,
        MAX(team_name) AS team_name,
        COUNT(*) AS individual_matches,
        COUNT(*) FILTER (WHERE is_win) AS individual_wins,
        COUNT(*) FILTER (WHERE NOT is_win) AS individual_losses,
        COUNT(*) FILTER (WHERE is_walkover) AS walkovers,
        COUNT(*) FILTER (WHERE NOT is_walkover) AS non_walkover_matches,
        COUNT(*) FILTER (WHERE NOT is_walkover AND is_win) AS non_walkover_wins,
        COALESCE(SUM(sets_won), 0) AS sets_won,
        COALESCE(SUM(sets_lost), 0) AS sets_lost,
        COALESCE(SUM(points_won), 0) AS points_won,
        COALESCE(SUM(points_lost), 0) AS points_lost
    FROM tmp_team_individual_matches
    GROUP BY team_code
),
team_match AS (
    SELECT
        team_code,
        COUNT(*) AS team_matches,
        COUNT(*) FILTER (WHERE disciplines_won > disciplines_lost) AS team_match_wins,
        COUNT(*) FILTER (WHERE disciplines_won < disciplines_lost) AS team_match_losses,
        COUNT(*) FILTER (WHERE disciplines_won = disciplines_lost) AS team_match_draws,
        COALESCE(SUM(disciplines_won), 0) AS disciplines_won,
        COALESCE(SUM(disciplines_lost), 0) AS disciplines_lost
    FROM tmp_team_match_results
    GROUP BY team_code
)
SELECT
    st.team_code,
    COALESCE(i.team_name, st.requested_team) AS team_name,
    t.team_matches,
    t.team_match_wins,
    t.team_match_losses,
    t.team_match_draws,
    ROUND(100.0 * t.team_match_wins / NULLIF(t.team_matches, 0), 2) AS team_match_win_pct,
    t.disciplines_won,
    t.disciplines_lost,
    i.individual_matches,
    i.individual_wins,
    i.individual_losses,
    ROUND(100.0 * i.individual_wins / NULLIF(i.individual_matches, 0), 2) AS individual_win_pct,
    i.walkovers,
    i.non_walkover_matches,
    i.non_walkover_wins,
    ROUND(100.0 * i.non_walkover_wins / NULLIF(i.non_walkover_matches, 0), 2) AS non_walkover_win_pct,
    i.sets_won,
    i.sets_lost,
    ROUND(100.0 * i.sets_won / NULLIF(i.sets_won + i.sets_lost, 0), 2) AS set_win_pct,
    i.points_won,
    i.points_lost,
    ROUND(100.0 * i.points_won / NULLIF(i.points_won + i.points_lost, 0), 2) AS point_win_pct
FROM tmp_selected_teams st
LEFT JOIN individual i
    ON i.team_code = st.team_code
LEFT JOIN team_match t
    ON t.team_code = st.team_code
ORDER BY st.team_code;

\echo ''
\echo 'Key Delta (A minus B)'
WITH per_team AS (
    SELECT
        st.team_code,
        COALESCE(i.team_name, st.requested_team) AS team_name,
        ROUND(100.0 * t.team_match_wins / NULLIF(t.team_matches, 0), 2) AS team_match_win_pct,
        ROUND(100.0 * i.individual_wins / NULLIF(i.individual_matches, 0), 2) AS individual_win_pct,
        ROUND(100.0 * i.sets_won / NULLIF(i.sets_won + i.sets_lost, 0), 2) AS set_win_pct,
        ROUND(100.0 * i.points_won / NULLIF(i.points_won + i.points_lost, 0), 2) AS point_win_pct
    FROM tmp_selected_teams st
    LEFT JOIN (
        SELECT
            team_code,
            MAX(team_name) AS team_name,
            COUNT(*) AS individual_matches,
            COUNT(*) FILTER (WHERE is_win) AS individual_wins,
            COALESCE(SUM(sets_won), 0) AS sets_won,
            COALESCE(SUM(sets_lost), 0) AS sets_lost,
            COALESCE(SUM(points_won), 0) AS points_won,
            COALESCE(SUM(points_lost), 0) AS points_lost
        FROM tmp_team_individual_matches
        GROUP BY team_code
    ) i
        ON i.team_code = st.team_code
    LEFT JOIN (
        SELECT
            team_code,
            COUNT(*) AS team_matches,
            COUNT(*) FILTER (WHERE disciplines_won > disciplines_lost) AS team_match_wins
        FROM tmp_team_match_results
        GROUP BY team_code
    ) t
        ON t.team_code = st.team_code
),
pivoted AS (
    SELECT
        MAX(CASE WHEN team_code = 'A' THEN team_name END) AS team_a_name,
        MAX(CASE WHEN team_code = 'B' THEN team_name END) AS team_b_name,
        MAX(CASE WHEN team_code = 'A' THEN team_match_win_pct END) AS team_a_team_match_win_pct,
        MAX(CASE WHEN team_code = 'B' THEN team_match_win_pct END) AS team_b_team_match_win_pct,
        MAX(CASE WHEN team_code = 'A' THEN individual_win_pct END) AS team_a_individual_win_pct,
        MAX(CASE WHEN team_code = 'B' THEN individual_win_pct END) AS team_b_individual_win_pct,
        MAX(CASE WHEN team_code = 'A' THEN set_win_pct END) AS team_a_set_win_pct,
        MAX(CASE WHEN team_code = 'B' THEN set_win_pct END) AS team_b_set_win_pct,
        MAX(CASE WHEN team_code = 'A' THEN point_win_pct END) AS team_a_point_win_pct,
        MAX(CASE WHEN team_code = 'B' THEN point_win_pct END) AS team_b_point_win_pct
    FROM per_team
)
SELECT
    team_a_name,
    team_b_name,
    team_a_team_match_win_pct,
    team_b_team_match_win_pct,
    ROUND(team_a_team_match_win_pct - team_b_team_match_win_pct, 2) AS delta_team_match_win_pct,
    team_a_individual_win_pct,
    team_b_individual_win_pct,
    ROUND(team_a_individual_win_pct - team_b_individual_win_pct, 2) AS delta_individual_win_pct,
    team_a_set_win_pct,
    team_b_set_win_pct,
    ROUND(team_a_set_win_pct - team_b_set_win_pct, 2) AS delta_set_win_pct,
    team_a_point_win_pct,
    team_b_point_win_pct,
    ROUND(team_a_point_win_pct - team_b_point_win_pct, 2) AS delta_point_win_pct
FROM pivoted;

\echo ''
\echo 'Discipline Comparison (HS/DS/HD/DD/MD)'
WITH stats AS (
    SELECT
        team_code,
        discipline_code,
        COUNT(*) AS matches,
        COUNT(*) FILTER (WHERE is_win) AS wins,
        COALESCE(SUM(sets_won), 0) AS sets_won,
        COALESCE(SUM(sets_lost), 0) AS sets_lost,
        COALESCE(SUM(points_won), 0) AS points_won,
        COALESCE(SUM(points_lost), 0) AS points_lost
    FROM tmp_team_individual_matches
    GROUP BY team_code, discipline_code
),
a AS (
    SELECT * FROM stats WHERE team_code = 'A'
),
b AS (
    SELECT * FROM stats WHERE team_code = 'B'
),
comp AS (
    SELECT
        COALESCE(a.discipline_code, b.discipline_code) AS discipline_code,
        COALESCE(a.matches, 0) AS team_a_matches,
        COALESCE(a.wins, 0) AS team_a_wins,
        ROUND(100.0 * COALESCE(a.wins, 0) / NULLIF(COALESCE(a.matches, 0), 0), 2) AS team_a_win_pct,
        COALESCE(b.matches, 0) AS team_b_matches,
        COALESCE(b.wins, 0) AS team_b_wins,
        ROUND(100.0 * COALESCE(b.wins, 0) / NULLIF(COALESCE(b.matches, 0), 0), 2) AS team_b_win_pct,
        ROUND(
            ROUND(100.0 * COALESCE(a.wins, 0) / NULLIF(COALESCE(a.matches, 0), 0), 2)
            - ROUND(100.0 * COALESCE(b.wins, 0) / NULLIF(COALESCE(b.matches, 0), 0), 2),
            2
        ) AS win_pct_delta_a_minus_b,
        COALESCE(a.sets_won, 0) AS team_a_sets_won,
        COALESCE(a.sets_lost, 0) AS team_a_sets_lost,
        COALESCE(b.sets_won, 0) AS team_b_sets_won,
        COALESCE(b.sets_lost, 0) AS team_b_sets_lost,
        COALESCE(a.points_won, 0) AS team_a_points_won,
        COALESCE(a.points_lost, 0) AS team_a_points_lost,
        COALESCE(b.points_won, 0) AS team_b_points_won,
        COALESCE(b.points_lost, 0) AS team_b_points_lost
    FROM a
    FULL OUTER JOIN b
        ON b.discipline_code = a.discipline_code
)
SELECT
    discipline_code,
    team_a_matches,
    team_a_wins,
    team_a_win_pct,
    team_b_matches,
    team_b_wins,
    team_b_win_pct,
    win_pct_delta_a_minus_b,
    team_a_sets_won,
    team_a_sets_lost,
    team_b_sets_won,
    team_b_sets_lost,
    team_a_points_won,
    team_a_points_lost,
    team_b_points_won,
    team_b_points_lost
FROM comp
ORDER BY discipline_code;

\echo ''
\echo 'Biggest Discipline Edge (A minus B, sorted)'
WITH stats AS (
    SELECT
        team_code,
        discipline_code,
        COUNT(*) AS matches,
        COUNT(*) FILTER (WHERE is_win) AS wins
    FROM tmp_team_individual_matches
    GROUP BY team_code, discipline_code
),
a AS (
    SELECT * FROM stats WHERE team_code = 'A'
),
b AS (
    SELECT * FROM stats WHERE team_code = 'B'
)
SELECT
    COALESCE(a.discipline_code, b.discipline_code) AS discipline_code,
    ROUND(100.0 * COALESCE(a.wins, 0) / NULLIF(COALESCE(a.matches, 0), 0), 2) AS team_a_win_pct,
    ROUND(100.0 * COALESCE(b.wins, 0) / NULLIF(COALESCE(b.matches, 0), 0), 2) AS team_b_win_pct,
    ROUND(
        ROUND(100.0 * COALESCE(a.wins, 0) / NULLIF(COALESCE(a.matches, 0), 0), 2)
        - ROUND(100.0 * COALESCE(b.wins, 0) / NULLIF(COALESCE(b.matches, 0), 0), 2),
        2
    ) AS win_pct_delta_a_minus_b
FROM a
FULL OUTER JOIN b
    ON b.discipline_code = a.discipline_code
ORDER BY win_pct_delta_a_minus_b DESC NULLS LAST, discipline_code;

\echo ''
\echo 'Winrate by Match Type (1.hd, 2.hd, etc.)'
WITH stats AS (
    SELECT
        team_code,
        discipline_no,
        lower(discipline_code) AS discipline_code,
        MAX(discipline_label) AS discipline_label,
        COUNT(*) AS matches,
        COUNT(*) FILTER (WHERE is_win) AS wins,
        COALESCE(SUM(sets_won), 0) AS sets_won,
        COALESCE(SUM(sets_lost), 0) AS sets_lost
    FROM tmp_team_individual_matches
    GROUP BY team_code, discipline_no, lower(discipline_code)
),
a AS (
    SELECT * FROM stats WHERE team_code = 'A'
),
b AS (
    SELECT * FROM stats WHERE team_code = 'B'
)
SELECT
    COALESCE(a.discipline_no, b.discipline_no)::text || '.' || COALESCE(a.discipline_code, b.discipline_code) AS match_type,
    COALESCE(a.discipline_label, b.discipline_label) AS discipline_label,
    COALESCE(a.matches, 0) AS team_a_matches,
    COALESCE(a.wins, 0) AS team_a_wins,
    ROUND(100.0 * COALESCE(a.wins, 0) / NULLIF(COALESCE(a.matches, 0), 0), 2) AS team_a_win_pct,
    COALESCE(b.matches, 0) AS team_b_matches,
    COALESCE(b.wins, 0) AS team_b_wins,
    ROUND(100.0 * COALESCE(b.wins, 0) / NULLIF(COALESCE(b.matches, 0), 0), 2) AS team_b_win_pct,
    ROUND(
        ROUND(100.0 * COALESCE(a.wins, 0) / NULLIF(COALESCE(a.matches, 0), 0), 2)
        - ROUND(100.0 * COALESCE(b.wins, 0) / NULLIF(COALESCE(b.matches, 0), 0), 2),
        2
    ) AS win_pct_delta_a_minus_b,
    COALESCE(a.sets_won, 0) AS team_a_sets_won,
    COALESCE(a.sets_lost, 0) AS team_a_sets_lost,
    COALESCE(b.sets_won, 0) AS team_b_sets_won,
    COALESCE(b.sets_lost, 0) AS team_b_sets_lost
FROM a
FULL OUTER JOIN b
    ON b.discipline_no = a.discipline_no
   AND b.discipline_code = a.discipline_code
ORDER BY
    COALESCE(a.discipline_no, b.discipline_no),
    COALESCE(a.discipline_code, b.discipline_code);

\echo ''
\echo 'Direct Head-to-Head Summary (Team A perspective)'
WITH h2h AS (
    SELECT *
    FROM tmp_team_match_results
    WHERE team_code = 'A'
      AND lower(opponent_team_name) = lower(:'team_b')
)
SELECT
    COUNT(*) AS direct_team_matches,
    COUNT(*) FILTER (WHERE disciplines_won > disciplines_lost) AS team_a_wins,
    COUNT(*) FILTER (WHERE disciplines_won < disciplines_lost) AS team_a_losses,
    COUNT(*) FILTER (WHERE disciplines_won = disciplines_lost) AS team_a_draws,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE disciplines_won > disciplines_lost)
        / NULLIF(COUNT(*), 0),
        2
    ) AS team_a_win_pct,
    COALESCE(SUM(disciplines_won), 0) AS team_a_disciplines_won,
    COALESCE(SUM(disciplines_lost), 0) AS team_b_disciplines_won,
    COALESCE(SUM(sets_won), 0) AS team_a_sets_won,
    COALESCE(SUM(sets_lost), 0) AS team_b_sets_won,
    COALESCE(SUM(points_won), 0) AS team_a_points_won,
    COALESCE(SUM(points_lost), 0) AS team_b_points_won
FROM h2h;

\echo ''
\echo 'Direct Head-to-Head Matches (latest 20, Team A perspective)'
SELECT
    season_id,
    match_date,
    round_no,
    match_id,
    team_name AS team_a,
    opponent_team_name AS team_b,
    CASE
        WHEN disciplines_won > disciplines_lost THEN 'W'
        WHEN disciplines_won < disciplines_lost THEN 'L'
        ELSE 'D'
    END AS result_for_team_a,
    disciplines_won || '-' || disciplines_lost AS discipline_score_from_team_a,
    sets_won || '-' || sets_lost AS sets_score_from_team_a,
    points_won || '-' || points_lost AS points_score_from_team_a
FROM tmp_team_match_results
WHERE team_code = 'A'
  AND lower(opponent_team_name) = lower(:'team_b')
ORDER BY match_date DESC, round_no DESC, match_id DESC
LIMIT 20;

\echo ''
\echo 'Common Opponent Comparison (team-match level)'
WITH by_opp AS (
    SELECT
        team_code,
        opponent_team_name,
        COUNT(*) AS team_matches,
        COUNT(*) FILTER (WHERE disciplines_won > disciplines_lost) AS wins,
        COALESCE(SUM(disciplines_won), 0) AS disciplines_won,
        COALESCE(SUM(disciplines_lost), 0) AS disciplines_lost
    FROM tmp_team_match_results
    GROUP BY team_code, opponent_team_name
),
a AS (
    SELECT * FROM by_opp WHERE team_code = 'A'
),
b AS (
    SELECT * FROM by_opp WHERE team_code = 'B'
)
SELECT
    a.opponent_team_name,
    a.team_matches AS team_a_matches,
    ROUND(100.0 * a.wins / NULLIF(a.team_matches, 0), 2) AS team_a_win_pct,
    a.disciplines_won AS team_a_disciplines_won,
    a.disciplines_lost AS team_a_disciplines_lost,
    b.team_matches AS team_b_matches,
    ROUND(100.0 * b.wins / NULLIF(b.team_matches, 0), 2) AS team_b_win_pct,
    b.disciplines_won AS team_b_disciplines_won,
    b.disciplines_lost AS team_b_disciplines_lost,
    ROUND(
        ROUND(100.0 * a.wins / NULLIF(a.team_matches, 0), 2)
        - ROUND(100.0 * b.wins / NULLIF(b.team_matches, 0), 2),
        2
    ) AS win_pct_delta_a_minus_b
FROM a
JOIN b
    ON lower(b.opponent_team_name) = lower(a.opponent_team_name)
ORDER BY ABS(
    ROUND(
        ROUND(100.0 * a.wins / NULLIF(a.team_matches, 0), 2)
        - ROUND(100.0 * b.wins / NULLIF(b.team_matches, 0), 2),
        2
    )
) DESC,
   a.opponent_team_name;

\endif
