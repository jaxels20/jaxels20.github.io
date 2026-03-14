\set ON_ERROR_STOP on

\if :{?player_name}
\else
\echo 'Missing required variable: player_name'
\echo 'Example:'
\echo '  /opt/homebrew/Cellar/postgresql@18/18.3/bin/psql -h /tmp -d badminton_dw_individual -v player_name=''Anna Simonsen'' -f sql/player_stats_report.sql'
\quit 1
\endif

\if :{?season_id}
\else
\set season_id ''
\endif

\pset border 2
\pset linestyle ascii
\pset null '-'
\pset pager off

SET search_path TO dw, public;

DROP VIEW IF EXISTS tmp_player_matches;

CREATE TEMP VIEW tmp_player_matches AS
SELECT
    dp.player_key,
    dp.player_name,
    dseason.season_id,
    f.individual_match_key,
    f.match_id,
    dd.full_date AS match_date,
    dr.round_no,
    dr.round_label,
    ddisc.discipline_code,
    ddisc.discipline_no,
    ddisc.discipline_label,
    b.side_code,
    CASE
        WHEN b.side_code = 'H' THEN ht.team_name
        ELSE at.team_name
    END AS player_team_name,
    CASE
        WHEN b.side_code = 'H' THEN at.team_name
        ELSE ht.team_name
    END AS opponent_team_name,
    f.is_walkover,
    f.walkover_code,
    CASE
        WHEN (b.side_code = 'H' AND f.winner_side = 'home')
          OR (b.side_code = 'A' AND f.winner_side = 'away')
        THEN true
        ELSE false
    END AS is_win,
    CASE
        WHEN b.side_code = 'H' THEN f.home_sets_won
        ELSE f.away_sets_won
    END AS sets_won,
    CASE
        WHEN b.side_code = 'H' THEN f.away_sets_won
        ELSE f.home_sets_won
    END AS sets_lost,
    CASE
        WHEN b.side_code = 'H' THEN f.home_points_scored
        ELSE f.away_points_scored
    END AS points_won,
    CASE
        WHEN b.side_code = 'H' THEN f.away_points_scored
        ELSE f.home_points_scored
    END AS points_lost,
    f.sets_played,
    f.set_scores_raw
FROM bridge_individual_match_player b
JOIN dim_player dp
    ON dp.player_key = b.player_key
JOIN fact_individual_match f
    ON f.individual_match_key = b.individual_match_key
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
WHERE lower(dp.player_name) = lower(:'player_name')
  AND (
      NULLIF(:'season_id', '') IS NULL
      OR dseason.season_id = NULLIF(:'season_id', '')::integer
  );

SELECT
    EXISTS (SELECT 1 FROM tmp_player_matches) AS has_rows,
    COUNT(*) AS matched_rows
FROM tmp_player_matches
\gset

\echo ''
\echo '=============================='
\echo 'Player Stats Report (Individual Fact)'
\echo '=============================='
\echo ''
SELECT
    :'player_name' AS requested_player,
    NULLIF(:'season_id', '') AS requested_season_id,
    :matched_rows::int AS matched_rows;

\if :has_rows
\echo ''
\echo 'Overall Summary'
WITH s AS (
    SELECT
        MAX(player_name) AS player_name,
        COUNT(*) AS matches,
        COUNT(*) FILTER (WHERE is_win) AS wins,
        COUNT(*) FILTER (WHERE NOT is_win) AS losses,
        COUNT(*) FILTER (WHERE is_walkover) AS walkovers,
        COUNT(*) FILTER (WHERE is_walkover AND is_win) AS walkover_wins,
        COUNT(*) FILTER (WHERE NOT is_walkover) AS non_walkover_matches,
        COUNT(*) FILTER (WHERE NOT is_walkover AND is_win) AS non_walkover_wins,
        SUM(sets_won) AS sets_won,
        SUM(sets_lost) AS sets_lost,
        SUM(points_won) AS points_won,
        SUM(points_lost) AS points_lost,
        COUNT(*) FILTER (WHERE sets_played = 3) AS three_set_matches,
        COUNT(*) FILTER (WHERE sets_played = 3 AND is_win) AS three_set_wins,
        ROUND(AVG((sets_won - sets_lost)::numeric), 2) AS avg_set_margin,
        ROUND(AVG((points_won - points_lost)::numeric), 2) AS avg_point_margin
    FROM tmp_player_matches
)
SELECT
    player_name,
    matches AS matches_played,
    wins AS matches_won,
    losses AS matches_lost,
    ROUND(100.0 * wins / NULLIF(matches, 0), 2) AS win_pct,
    walkovers AS walkovers_played,
    walkover_wins AS walkovers_won,
    non_walkover_matches,
    non_walkover_wins,
    ROUND(100.0 * non_walkover_wins / NULLIF(non_walkover_matches, 0), 2) AS non_walkover_win_pct,
    sets_won,
    sets_lost,
    ROUND(100.0 * sets_won / NULLIF(sets_won + sets_lost, 0), 2) AS set_win_pct,
    points_won,
    points_lost,
    ROUND(100.0 * points_won / NULLIF(points_won + points_lost, 0), 2) AS point_win_pct,
    three_set_matches,
    three_set_wins,
    ROUND(100.0 * three_set_wins / NULLIF(three_set_matches, 0), 2) AS three_set_win_pct,
    avg_set_margin,
    avg_point_margin
FROM s;

\echo ''
\echo 'Discipline Pivot (overall + discipline columns)'
WITH played AS (
    SELECT
        lower(discipline_code) AS col,
        CASE upper(discipline_code)
            WHEN 'HS' THEN 1
            WHEN 'DS' THEN 2
            WHEN 'HD' THEN 3
            WHEN 'DD' THEN 4
            WHEN 'MD' THEN 5
            ELSE 99
        END AS ord
    FROM tmp_player_matches
    GROUP BY lower(discipline_code), upper(discipline_code)
    HAVING COUNT(*) > 0
),
dyn_cols AS (
    SELECT
        COALESCE(
            string_agg(
                format(
                    ', COALESCE(MAX(value) FILTER (WHERE col = %L), 0) AS %I',
                    col,
                    col
                ),
                ''
                ORDER BY ord, col
            ),
            ''
        ) AS cols
    FROM played
)
SELECT format($sql$
WITH by_disc AS (
    SELECT
        lower(discipline_code) AS col,
        COUNT(*)::numeric AS matches,
        COUNT(*) FILTER (WHERE is_win)::numeric AS wins,
        COUNT(*) FILTER (WHERE NOT is_win)::numeric AS losses,
        COALESCE(SUM(sets_won), 0)::numeric AS sets_won,
        COALESCE(SUM(sets_lost), 0)::numeric AS sets_lost,
        COALESCE(SUM(points_won), 0)::numeric AS points_won,
        COALESCE(SUM(points_lost), 0)::numeric AS points_lost
    FROM tmp_player_matches
    GROUP BY lower(discipline_code)
),
metrics AS (
    SELECT 1 AS metric_order, 'matches' AS metric, 'overall'::text AS col, COUNT(*)::numeric AS value
    FROM tmp_player_matches
    UNION ALL
    SELECT 2, 'wins', 'overall', COUNT(*) FILTER (WHERE is_win)::numeric
    FROM tmp_player_matches
    UNION ALL
    SELECT 3, 'losses', 'overall', COUNT(*) FILTER (WHERE NOT is_win)::numeric
    FROM tmp_player_matches
    UNION ALL
    SELECT 4, 'win_pct', 'overall', ROUND(100.0 * COUNT(*) FILTER (WHERE is_win) / NULLIF(COUNT(*), 0), 2)
    FROM tmp_player_matches
    UNION ALL
    SELECT 5, 'sets_won', 'overall', COALESCE(SUM(sets_won), 0)::numeric
    FROM tmp_player_matches
    UNION ALL
    SELECT 6, 'sets_lost', 'overall', COALESCE(SUM(sets_lost), 0)::numeric
    FROM tmp_player_matches
    UNION ALL
    SELECT 7, 'set_win_pct', 'overall', ROUND(
        100.0 * COALESCE(SUM(sets_won), 0) / NULLIF(COALESCE(SUM(sets_won), 0) + COALESCE(SUM(sets_lost), 0), 0),
        2
    )
    FROM tmp_player_matches
    UNION ALL
    SELECT 8, 'points_won', 'overall', COALESCE(SUM(points_won), 0)::numeric
    FROM tmp_player_matches
    UNION ALL
    SELECT 9, 'points_lost', 'overall', COALESCE(SUM(points_lost), 0)::numeric
    FROM tmp_player_matches
    UNION ALL
    SELECT 10, 'point_win_pct', 'overall', ROUND(
        100.0 * COALESCE(SUM(points_won), 0) / NULLIF(COALESCE(SUM(points_won), 0) + COALESCE(SUM(points_lost), 0), 0),
        2
    )
    FROM tmp_player_matches
    UNION ALL
    SELECT 1, 'matches', col, matches FROM by_disc
    UNION ALL
    SELECT 2, 'wins', col, wins FROM by_disc
    UNION ALL
    SELECT 3, 'losses', col, losses FROM by_disc
    UNION ALL
    SELECT 4, 'win_pct', col, ROUND(100.0 * wins / NULLIF(matches, 0), 2) FROM by_disc
    UNION ALL
    SELECT 5, 'sets_won', col, sets_won FROM by_disc
    UNION ALL
    SELECT 6, 'sets_lost', col, sets_lost FROM by_disc
    UNION ALL
    SELECT 7, 'set_win_pct', col, ROUND(100.0 * sets_won / NULLIF(sets_won + sets_lost, 0), 2) FROM by_disc
    UNION ALL
    SELECT 8, 'points_won', col, points_won FROM by_disc
    UNION ALL
    SELECT 9, 'points_lost', col, points_lost FROM by_disc
    UNION ALL
    SELECT 10, 'point_win_pct', col, ROUND(100.0 * points_won / NULLIF(points_won + points_lost, 0), 2) FROM by_disc
)
SELECT
    metric,
    COALESCE(MAX(value) FILTER (WHERE col = 'overall'), 0) AS overall%s
FROM metrics
GROUP BY metric, metric_order
ORDER BY metric_order;
$sql$, cols)
FROM dyn_cols
\gexec

\echo ''
\echo 'Home vs Away Pivot'
SELECT
    COUNT(*) FILTER (WHERE side_code = 'H') AS home_matches,
    COUNT(*) FILTER (WHERE side_code = 'H' AND is_win) AS home_wins,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE side_code = 'H' AND is_win)
        / NULLIF(COUNT(*) FILTER (WHERE side_code = 'H'), 0),
        2
    ) AS home_win_pct,
    COUNT(*) FILTER (WHERE side_code = 'A') AS away_matches,
    COUNT(*) FILTER (WHERE side_code = 'A' AND is_win) AS away_wins,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE side_code = 'A' AND is_win)
        / NULLIF(COUNT(*) FILTER (WHERE side_code = 'A'), 0),
        2
    ) AS away_win_pct
FROM tmp_player_matches;

\echo ''
\echo 'Team Breakdown'
SELECT
    player_team_name,
    COUNT(*) AS matches_played,
    COUNT(*) FILTER (WHERE is_win) AS wins,
    ROUND(100.0 * COUNT(*) FILTER (WHERE is_win) / NULLIF(COUNT(*), 0), 2) AS win_pct
FROM tmp_player_matches
GROUP BY player_team_name
ORDER BY matches_played DESC, player_team_name;

\echo ''
\echo 'Opponent Breakdown'
SELECT
    opponent_team_name,
    COUNT(*) AS matches_against,
    COUNT(*) FILTER (WHERE is_win) AS wins,
    ROUND(100.0 * COUNT(*) FILTER (WHERE is_win) / NULLIF(COUNT(*), 0), 2) AS win_pct
FROM tmp_player_matches
GROUP BY opponent_team_name
ORDER BY matches_against DESC, opponent_team_name;

\echo ''
\echo 'Top Partners'
WITH partner_rows AS (
    SELECT
        dp2.player_name AS partner_name,
        pm.is_win
    FROM tmp_player_matches pm
    JOIN bridge_individual_match_player b2
        ON b2.individual_match_key = pm.individual_match_key
       AND b2.side_code = pm.side_code
       AND b2.player_key <> pm.player_key
    JOIN dim_player dp2
        ON dp2.player_key = b2.player_key
)
SELECT
    partner_name,
    COUNT(*) AS matches_together,
    COUNT(*) FILTER (WHERE is_win) AS wins_together,
    ROUND(100.0 * COUNT(*) FILTER (WHERE is_win) / NULLIF(COUNT(*), 0), 2) AS win_pct_together
FROM partner_rows
GROUP BY partner_name
ORDER BY matches_together DESC, wins_together DESC, partner_name
LIMIT 10;

\echo ''
\echo 'Season Point Differential'
SELECT
    season_id,
    COUNT(*) AS matches_played,
    COALESCE(SUM(points_won), 0) AS points_won,
    COALESCE(SUM(points_lost), 0) AS points_lost,
    COALESCE(SUM(points_won), 0) - COALESCE(SUM(points_lost), 0) AS point_delta
FROM tmp_player_matches
GROUP BY season_id
ORDER BY season_id;

\echo ''
\echo 'Recent Matches (latest 20)'
SELECT
    season_id,
    match_date,
    round_no,
    match_id,
    side_code AS player_side,
    discipline_code,
    discipline_label,
    player_team_name AS player_team,
    opponent_team_name AS opponent_team,
    CASE WHEN is_win THEN 'W' ELSE 'L' END AS result,
    sets_won || '-' || sets_lost AS sets_result,
    points_won || '-' || points_lost AS points_result,
    is_walkover,
    walkover_code,
    set_scores_raw AS set_scores_home_vs_away
FROM tmp_player_matches
ORDER BY match_date DESC, round_no DESC, match_id DESC, discipline_code, discipline_no
LIMIT 20;

\else
\echo ''
\echo 'No exact player match found.'
\echo 'Similar names:'
SELECT
    player_name AS similar_player_name
FROM dim_player
WHERE player_name ILIKE '%' || :'player_name' || '%'
ORDER BY player_name
LIMIT 20;
\endif
