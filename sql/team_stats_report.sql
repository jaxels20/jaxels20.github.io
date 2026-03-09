\set ON_ERROR_STOP on

\if :{?team_name}
\else
\echo 'Missing required variable: team_name'
\echo 'Example:'
\echo '  /opt/homebrew/Cellar/postgresql@18/18.3/bin/psql -h /tmp -d badminton_dw_individual -v team_name=''Viby J 2'' -f sql/team_stats_report.sql'
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

DROP VIEW IF EXISTS tmp_team_match_results;
DROP VIEW IF EXISTS tmp_team_individual_matches;

CREATE TEMP VIEW tmp_team_individual_matches AS
SELECT
    dseason.season_id,
    f.individual_match_key,
    f.match_id,
    dd.full_date AS match_date,
    dr.round_no,
    dr.round_label,
    ddisc.discipline_code,
    ddisc.discipline_no,
    ddisc.discipline_label,
    CASE
        WHEN lower(ht.team_name) = lower(:'team_name') THEN 'H'
        ELSE 'A'
    END AS team_side_code,
    CASE
        WHEN lower(ht.team_name) = lower(:'team_name') THEN ht.team_name
        ELSE at.team_name
    END AS team_name,
    CASE
        WHEN lower(ht.team_name) = lower(:'team_name') THEN at.team_name
        ELSE ht.team_name
    END AS opponent_team_name,
    f.is_walkover,
    f.walkover_code,
    CASE
        WHEN (lower(ht.team_name) = lower(:'team_name') AND f.winner_side = 'home')
          OR (lower(at.team_name) = lower(:'team_name') AND f.winner_side = 'away')
        THEN true
        ELSE false
    END AS is_win,
    CASE
        WHEN lower(ht.team_name) = lower(:'team_name') THEN f.home_sets_won
        ELSE f.away_sets_won
    END AS sets_won,
    CASE
        WHEN lower(ht.team_name) = lower(:'team_name') THEN f.away_sets_won
        ELSE f.home_sets_won
    END AS sets_lost,
    CASE
        WHEN lower(ht.team_name) = lower(:'team_name') THEN f.home_points_scored
        ELSE f.away_points_scored
    END AS points_won,
    CASE
        WHEN lower(ht.team_name) = lower(:'team_name') THEN f.away_points_scored
        ELSE f.home_points_scored
    END AS points_lost,
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
WHERE (
      lower(ht.team_name) = lower(:'team_name')
   OR lower(at.team_name) = lower(:'team_name')
  )
  AND (
      NULLIF(:'season_id', '') IS NULL
      OR dseason.season_id = NULLIF(:'season_id', '')::integer
  );

CREATE TEMP VIEW tmp_team_match_results AS
SELECT
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
GROUP BY season_id, match_id, match_date, round_no, round_label;

SELECT
    EXISTS (SELECT 1 FROM tmp_team_individual_matches) AS has_rows,
    COUNT(*) AS matched_individual_rows,
    (SELECT COUNT(*) FROM tmp_team_match_results) AS matched_team_matches
FROM tmp_team_individual_matches
\gset

\echo ''
\echo '============================='
\echo 'Team Stats Report (Individual Fact)'
\echo '============================='
\echo ''
SELECT
    :'team_name' AS requested_team,
    NULLIF(:'season_id', '') AS requested_season_id,
    :matched_individual_rows::int AS matched_individual_rows,
    :matched_team_matches::int AS matched_team_matches;

\if :has_rows
\echo ''
\echo 'Overall Summary'
WITH individual_summary AS (
    SELECT
        MAX(team_name) AS team_name,
        COUNT(*) AS individual_matches,
        COUNT(*) FILTER (WHERE is_win) AS individual_wins,
        COUNT(*) FILTER (WHERE NOT is_win) AS individual_losses,
        COUNT(*) FILTER (WHERE is_walkover) AS walkovers,
        COUNT(*) FILTER (WHERE is_walkover AND is_win) AS walkover_wins,
        COUNT(*) FILTER (WHERE NOT is_walkover) AS non_walkover_matches,
        COUNT(*) FILTER (WHERE NOT is_walkover AND is_win) AS non_walkover_wins,
        COALESCE(SUM(sets_won), 0) AS sets_won,
        COALESCE(SUM(sets_lost), 0) AS sets_lost,
        COALESCE(SUM(points_won), 0) AS points_won,
        COALESCE(SUM(points_lost), 0) AS points_lost,
        COUNT(*) FILTER (WHERE sets_played = 3) AS three_set_matches,
        COUNT(*) FILTER (WHERE sets_played = 3 AND is_win) AS three_set_wins,
        ROUND(AVG((sets_won - sets_lost)::numeric), 2) AS avg_set_margin,
        ROUND(AVG((points_won - points_lost)::numeric), 2) AS avg_point_margin
    FROM tmp_team_individual_matches
),
team_match_summary AS (
    SELECT
        COUNT(*) AS team_matches,
        COUNT(*) FILTER (WHERE disciplines_won > disciplines_lost) AS team_match_wins,
        COUNT(*) FILTER (WHERE disciplines_won < disciplines_lost) AS team_match_losses,
        COUNT(*) FILTER (WHERE disciplines_won = disciplines_lost) AS team_match_draws,
        COALESCE(SUM(disciplines_won), 0) AS total_disciplines_won,
        COALESCE(SUM(disciplines_lost), 0) AS total_disciplines_lost
    FROM tmp_team_match_results
)
SELECT
    i.team_name,
    t.team_matches AS team_matches_played,
    t.team_match_wins,
    t.team_match_losses,
    t.team_match_draws,
    ROUND(100.0 * t.team_match_wins / NULLIF(t.team_matches, 0), 2) AS team_match_win_pct,
    t.total_disciplines_won,
    t.total_disciplines_lost,
    i.individual_matches AS individual_matches_played,
    i.individual_wins,
    i.individual_losses,
    ROUND(100.0 * i.individual_wins / NULLIF(i.individual_matches, 0), 2) AS individual_win_pct,
    i.walkovers AS walkovers_played,
    i.walkover_wins AS walkovers_won,
    i.non_walkover_matches,
    i.non_walkover_wins,
    ROUND(100.0 * i.non_walkover_wins / NULLIF(i.non_walkover_matches, 0), 2) AS non_walkover_win_pct,
    i.sets_won,
    i.sets_lost,
    ROUND(100.0 * i.sets_won / NULLIF(i.sets_won + i.sets_lost, 0), 2) AS set_win_pct,
    i.points_won,
    i.points_lost,
    ROUND(100.0 * i.points_won / NULLIF(i.points_won + i.points_lost, 0), 2) AS point_win_pct,
    i.three_set_matches,
    i.three_set_wins,
    ROUND(100.0 * i.three_set_wins / NULLIF(i.three_set_matches, 0), 2) AS three_set_win_pct,
    i.avg_set_margin,
    i.avg_point_margin
FROM individual_summary i
CROSS JOIN team_match_summary t;

\echo ''
\echo 'Discipline Pivot (overall + discipline columns)'
WITH s AS (
    SELECT
        COUNT(*) AS matches_all,
        COUNT(*) FILTER (WHERE is_win) AS wins_all,
        COUNT(*) FILTER (WHERE NOT is_win) AS losses_all,
        COALESCE(SUM(sets_won), 0) AS sets_won_all,
        COALESCE(SUM(sets_lost), 0) AS sets_lost_all,
        COALESCE(SUM(points_won), 0) AS points_won_all,
        COALESCE(SUM(points_lost), 0) AS points_lost_all,

        COUNT(*) FILTER (WHERE discipline_code = 'HS') AS matches_hs,
        COUNT(*) FILTER (WHERE discipline_code = 'HS' AND is_win) AS wins_hs,
        COUNT(*) FILTER (WHERE discipline_code = 'HS' AND NOT is_win) AS losses_hs,
        COALESCE(SUM(sets_won) FILTER (WHERE discipline_code = 'HS'), 0) AS sets_won_hs,
        COALESCE(SUM(sets_lost) FILTER (WHERE discipline_code = 'HS'), 0) AS sets_lost_hs,
        COALESCE(SUM(points_won) FILTER (WHERE discipline_code = 'HS'), 0) AS points_won_hs,
        COALESCE(SUM(points_lost) FILTER (WHERE discipline_code = 'HS'), 0) AS points_lost_hs,

        COUNT(*) FILTER (WHERE discipline_code = 'DS') AS matches_ds,
        COUNT(*) FILTER (WHERE discipline_code = 'DS' AND is_win) AS wins_ds,
        COUNT(*) FILTER (WHERE discipline_code = 'DS' AND NOT is_win) AS losses_ds,
        COALESCE(SUM(sets_won) FILTER (WHERE discipline_code = 'DS'), 0) AS sets_won_ds,
        COALESCE(SUM(sets_lost) FILTER (WHERE discipline_code = 'DS'), 0) AS sets_lost_ds,
        COALESCE(SUM(points_won) FILTER (WHERE discipline_code = 'DS'), 0) AS points_won_ds,
        COALESCE(SUM(points_lost) FILTER (WHERE discipline_code = 'DS'), 0) AS points_lost_ds,

        COUNT(*) FILTER (WHERE discipline_code = 'HD') AS matches_hd,
        COUNT(*) FILTER (WHERE discipline_code = 'HD' AND is_win) AS wins_hd,
        COUNT(*) FILTER (WHERE discipline_code = 'HD' AND NOT is_win) AS losses_hd,
        COALESCE(SUM(sets_won) FILTER (WHERE discipline_code = 'HD'), 0) AS sets_won_hd,
        COALESCE(SUM(sets_lost) FILTER (WHERE discipline_code = 'HD'), 0) AS sets_lost_hd,
        COALESCE(SUM(points_won) FILTER (WHERE discipline_code = 'HD'), 0) AS points_won_hd,
        COALESCE(SUM(points_lost) FILTER (WHERE discipline_code = 'HD'), 0) AS points_lost_hd,

        COUNT(*) FILTER (WHERE discipline_code = 'DD') AS matches_dd,
        COUNT(*) FILTER (WHERE discipline_code = 'DD' AND is_win) AS wins_dd,
        COUNT(*) FILTER (WHERE discipline_code = 'DD' AND NOT is_win) AS losses_dd,
        COALESCE(SUM(sets_won) FILTER (WHERE discipline_code = 'DD'), 0) AS sets_won_dd,
        COALESCE(SUM(sets_lost) FILTER (WHERE discipline_code = 'DD'), 0) AS sets_lost_dd,
        COALESCE(SUM(points_won) FILTER (WHERE discipline_code = 'DD'), 0) AS points_won_dd,
        COALESCE(SUM(points_lost) FILTER (WHERE discipline_code = 'DD'), 0) AS points_lost_dd,

        COUNT(*) FILTER (WHERE discipline_code = 'MD') AS matches_md,
        COUNT(*) FILTER (WHERE discipline_code = 'MD' AND is_win) AS wins_md,
        COUNT(*) FILTER (WHERE discipline_code = 'MD' AND NOT is_win) AS losses_md,
        COALESCE(SUM(sets_won) FILTER (WHERE discipline_code = 'MD'), 0) AS sets_won_md,
        COALESCE(SUM(sets_lost) FILTER (WHERE discipline_code = 'MD'), 0) AS sets_lost_md,
        COALESCE(SUM(points_won) FILTER (WHERE discipline_code = 'MD'), 0) AS points_won_md,
        COALESCE(SUM(points_lost) FILTER (WHERE discipline_code = 'MD'), 0) AS points_lost_md
    FROM tmp_team_individual_matches
),
pivoted AS (
    SELECT
        'matches' AS metric,
        matches_all::numeric AS overall,
        matches_hs::numeric AS hs,
        matches_ds::numeric AS ds,
        matches_hd::numeric AS hd,
        matches_dd::numeric AS dd,
        matches_md::numeric AS md
    FROM s
    UNION ALL
    SELECT
        'wins',
        wins_all::numeric,
        wins_hs::numeric,
        wins_ds::numeric,
        wins_hd::numeric,
        wins_dd::numeric,
        wins_md::numeric
    FROM s
    UNION ALL
    SELECT
        'losses',
        losses_all::numeric,
        losses_hs::numeric,
        losses_ds::numeric,
        losses_hd::numeric,
        losses_dd::numeric,
        losses_md::numeric
    FROM s
    UNION ALL
    SELECT
        'win_pct',
        ROUND(100.0 * wins_all / NULLIF(matches_all, 0), 2),
        ROUND(100.0 * wins_hs / NULLIF(matches_hs, 0), 2),
        ROUND(100.0 * wins_ds / NULLIF(matches_ds, 0), 2),
        ROUND(100.0 * wins_hd / NULLIF(matches_hd, 0), 2),
        ROUND(100.0 * wins_dd / NULLIF(matches_dd, 0), 2),
        ROUND(100.0 * wins_md / NULLIF(matches_md, 0), 2)
    FROM s
    UNION ALL
    SELECT
        'sets_won',
        sets_won_all::numeric,
        sets_won_hs::numeric,
        sets_won_ds::numeric,
        sets_won_hd::numeric,
        sets_won_dd::numeric,
        sets_won_md::numeric
    FROM s
    UNION ALL
    SELECT
        'sets_lost',
        sets_lost_all::numeric,
        sets_lost_hs::numeric,
        sets_lost_ds::numeric,
        sets_lost_hd::numeric,
        sets_lost_dd::numeric,
        sets_lost_md::numeric
    FROM s
    UNION ALL
    SELECT
        'set_win_pct',
        ROUND(100.0 * sets_won_all / NULLIF(sets_won_all + sets_lost_all, 0), 2),
        ROUND(100.0 * sets_won_hs / NULLIF(sets_won_hs + sets_lost_hs, 0), 2),
        ROUND(100.0 * sets_won_ds / NULLIF(sets_won_ds + sets_lost_ds, 0), 2),
        ROUND(100.0 * sets_won_hd / NULLIF(sets_won_hd + sets_lost_hd, 0), 2),
        ROUND(100.0 * sets_won_dd / NULLIF(sets_won_dd + sets_lost_dd, 0), 2),
        ROUND(100.0 * sets_won_md / NULLIF(sets_won_md + sets_lost_md, 0), 2)
    FROM s
    UNION ALL
    SELECT
        'points_won',
        points_won_all::numeric,
        points_won_hs::numeric,
        points_won_ds::numeric,
        points_won_hd::numeric,
        points_won_dd::numeric,
        points_won_md::numeric
    FROM s
    UNION ALL
    SELECT
        'points_lost',
        points_lost_all::numeric,
        points_lost_hs::numeric,
        points_lost_ds::numeric,
        points_lost_hd::numeric,
        points_lost_dd::numeric,
        points_lost_md::numeric
    FROM s
    UNION ALL
    SELECT
        'point_win_pct',
        ROUND(100.0 * points_won_all / NULLIF(points_won_all + points_lost_all, 0), 2),
        ROUND(100.0 * points_won_hs / NULLIF(points_won_hs + points_lost_hs, 0), 2),
        ROUND(100.0 * points_won_ds / NULLIF(points_won_ds + points_lost_ds, 0), 2),
        ROUND(100.0 * points_won_hd / NULLIF(points_won_hd + points_lost_hd, 0), 2),
        ROUND(100.0 * points_won_dd / NULLIF(points_won_dd + points_lost_dd, 0), 2),
        ROUND(100.0 * points_won_md / NULLIF(points_won_md + points_lost_md, 0), 2)
    FROM s
)
SELECT
    metric,
    COALESCE(overall, 0) AS overall,
    COALESCE(hs, 0) AS hs,
    COALESCE(ds, 0) AS ds,
    COALESCE(hd, 0) AS hd,
    COALESCE(dd, 0) AS dd,
    COALESCE(md, 0) AS md
FROM pivoted
ORDER BY CASE metric
    WHEN 'matches' THEN 1
    WHEN 'wins' THEN 2
    WHEN 'losses' THEN 3
    WHEN 'win_pct' THEN 4
    WHEN 'sets_won' THEN 5
    WHEN 'sets_lost' THEN 6
    WHEN 'set_win_pct' THEN 7
    WHEN 'points_won' THEN 8
    WHEN 'points_lost' THEN 9
    WHEN 'point_win_pct' THEN 10
    ELSE 99
END;

\echo ''
\echo 'Home vs Away (Team Match Level)'
SELECT
    COUNT(*) FILTER (WHERE team_side_code = 'H') AS home_team_matches,
    COUNT(*) FILTER (WHERE team_side_code = 'H' AND disciplines_won > disciplines_lost) AS home_team_match_wins,
    COUNT(*) FILTER (WHERE team_side_code = 'H' AND disciplines_won = disciplines_lost) AS home_team_match_draws,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE team_side_code = 'H' AND disciplines_won > disciplines_lost)
        / NULLIF(COUNT(*) FILTER (WHERE team_side_code = 'H'), 0),
        2
    ) AS home_team_match_win_pct,
    COUNT(*) FILTER (WHERE team_side_code = 'A') AS away_team_matches,
    COUNT(*) FILTER (WHERE team_side_code = 'A' AND disciplines_won > disciplines_lost) AS away_team_match_wins,
    COUNT(*) FILTER (WHERE team_side_code = 'A' AND disciplines_won = disciplines_lost) AS away_team_match_draws,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE team_side_code = 'A' AND disciplines_won > disciplines_lost)
        / NULLIF(COUNT(*) FILTER (WHERE team_side_code = 'A'), 0),
        2
    ) AS away_team_match_win_pct
FROM tmp_team_match_results;

\echo ''
\echo 'Opponent Breakdown (Team Match Level)'
SELECT
    opponent_team_name,
    COUNT(*) AS team_matches,
    COUNT(*) FILTER (WHERE disciplines_won > disciplines_lost) AS team_match_wins,
    COUNT(*) FILTER (WHERE disciplines_won < disciplines_lost) AS team_match_losses,
    COUNT(*) FILTER (WHERE disciplines_won = disciplines_lost) AS team_match_draws,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE disciplines_won > disciplines_lost)
        / NULLIF(COUNT(*), 0),
        2
    ) AS team_match_win_pct,
    COALESCE(SUM(disciplines_won), 0) AS disciplines_won,
    COALESCE(SUM(disciplines_lost), 0) AS disciplines_lost
FROM tmp_team_match_results
GROUP BY opponent_team_name
ORDER BY team_matches DESC, opponent_team_name;

\echo ''
\echo 'Winrate by Match Type (discipline_no + code)'
SELECT
    discipline_no || '.' || lower(discipline_code) AS match_type,
    MAX(discipline_label) AS discipline_label,
    COUNT(*) AS matches_played,
    COUNT(*) FILTER (WHERE is_win) AS wins,
    COUNT(*) FILTER (WHERE NOT is_win) AS losses,
    ROUND(100.0 * COUNT(*) FILTER (WHERE is_win) / NULLIF(COUNT(*), 0), 2) AS win_pct,
    COALESCE(SUM(sets_won), 0) AS sets_won,
    COALESCE(SUM(sets_lost), 0) AS sets_lost,
    ROUND(
        100.0 * COALESCE(SUM(sets_won), 0)
        / NULLIF(COALESCE(SUM(sets_won), 0) + COALESCE(SUM(sets_lost), 0), 0),
        2
    ) AS set_win_pct
FROM tmp_team_individual_matches
GROUP BY discipline_no, discipline_code
ORDER BY discipline_no, discipline_code;

\echo ''
\echo 'Top Players (for selected team)'
WITH player_rows AS (
    SELECT
        dp.player_name,
        tim.is_win,
        tim.sets_won,
        tim.sets_lost,
        tim.points_won,
        tim.points_lost
    FROM tmp_team_individual_matches tim
    JOIN bridge_individual_match_player b
        ON b.individual_match_key = tim.individual_match_key
       AND b.side_code = tim.team_side_code
    JOIN dim_player dp
        ON dp.player_key = b.player_key
)
SELECT
    player_name,
    COUNT(*) AS matches_played,
    COUNT(*) FILTER (WHERE is_win) AS wins,
    ROUND(100.0 * COUNT(*) FILTER (WHERE is_win) / NULLIF(COUNT(*), 0), 2) AS win_pct,
    COALESCE(SUM(sets_won), 0) AS sets_won,
    COALESCE(SUM(sets_lost), 0) AS sets_lost,
    COALESCE(SUM(points_won), 0) AS points_won,
    COALESCE(SUM(points_lost), 0) AS points_lost
FROM player_rows
GROUP BY player_name
ORDER BY matches_played DESC, wins DESC, player_name
LIMIT 20;

\echo ''
\echo 'Top Doubles Pairs (HD/DD/MD)'
WITH pair_rows AS (
    SELECT
        CASE
            WHEN dp1.player_name <= dp2.player_name
            THEN dp1.player_name || ' + ' || dp2.player_name
            ELSE dp2.player_name || ' + ' || dp1.player_name
        END AS pair_name,
        tim.discipline_code,
        tim.is_win
    FROM tmp_team_individual_matches tim
    JOIN bridge_individual_match_player b1
        ON b1.individual_match_key = tim.individual_match_key
       AND b1.side_code = tim.team_side_code
       AND b1.player_slot = 1
    JOIN bridge_individual_match_player b2
        ON b2.individual_match_key = tim.individual_match_key
       AND b2.side_code = tim.team_side_code
       AND b2.player_slot = 2
    JOIN dim_player dp1
        ON dp1.player_key = b1.player_key
    JOIN dim_player dp2
        ON dp2.player_key = b2.player_key
    WHERE tim.discipline_code IN ('HD', 'DD', 'MD')
)
SELECT
    pair_name,
    discipline_code,
    COUNT(*) AS matches_together,
    COUNT(*) FILTER (WHERE is_win) AS wins_together,
    ROUND(100.0 * COUNT(*) FILTER (WHERE is_win) / NULLIF(COUNT(*), 0), 2) AS win_pct_together
FROM pair_rows
GROUP BY pair_name, discipline_code
ORDER BY matches_together DESC, wins_together DESC, pair_name, discipline_code
LIMIT 20;

\echo ''
\echo 'Recent Team Matches (latest 20)'
SELECT
    season_id,
    match_date,
    round_no,
    match_id,
    team_side_code AS team_side,
    team_name,
    opponent_team_name,
    CASE
        WHEN disciplines_won > disciplines_lost THEN 'W'
        WHEN disciplines_won < disciplines_lost THEN 'L'
        ELSE 'D'
    END AS team_result,
    disciplines_won || '-' || disciplines_lost AS discipline_score,
    walkovers_in_match,
    sets_won || '-' || sets_lost AS sets_score,
    points_won || '-' || points_lost AS points_score
FROM tmp_team_match_results
ORDER BY match_date DESC, round_no DESC, match_id DESC
LIMIT 20;

\else
\echo ''
\echo 'No exact team match found.'
\echo 'Similar names:'
SELECT
    team_name AS similar_team_name
FROM dim_team
WHERE team_name ILIKE '%' || :'team_name' || '%'
ORDER BY team_name
LIMIT 20;
\endif
