from __future__ import annotations

from typing import Any

import psycopg

from ..settings import Settings
from .common import (
    DOUBLES_CODES,
    NotFound,
    discipline_sort_key,
    entity,
    individual_cursor,
    match_type_label,
    one,
    pct,
    ratio,
    result_code,
    rows,
    slug_sql,
)

# One row per individual match involving the team, normalised to the team's
# perspective, plus a roll-up to one row per team match.
TEAM_BASE = f"""
WITH m AS (
  SELECT f.individual_match_key, f.match_id, s.season_id, g.league_group_id, g.group_name, dv.division_name,
         dd.full_date AS match_date, r.round_no, d.discipline_code, d.discipline_no, d.discipline_label,
         CASE WHEN f.home_team_key = %(team_key)s THEN 'H' ELSE 'A' END AS side,
         CASE WHEN f.home_team_key = %(team_key)s THEN f.away_team_key ELSE f.home_team_key END AS opponent_key,
         (f.winner_side = CASE WHEN f.home_team_key = %(team_key)s THEN 'home' ELSE 'away' END) AS won,
         CASE WHEN f.home_team_key = %(team_key)s THEN f.home_sets_won ELSE f.away_sets_won END AS sets_won,
         CASE WHEN f.home_team_key = %(team_key)s THEN f.away_sets_won ELSE f.home_sets_won END AS sets_lost,
         CASE WHEN f.home_team_key = %(team_key)s THEN f.home_points_scored ELSE f.away_points_scored END AS points_won,
         CASE WHEN f.home_team_key = %(team_key)s THEN f.away_points_scored ELSE f.home_points_scored END AS points_lost,
         f.sets_played, f.is_walkover, f.set_scores_raw
  FROM fact_individual_match f
  JOIN dim_season s ON s.season_key = f.season_key
  JOIN dim_group g ON g.group_key = f.group_key
  JOIN dim_division dv ON dv.division_key = g.division_key
  JOIN dim_date dd ON dd.date_key = f.match_date_key
  JOIN dim_round r ON r.round_key = f.round_key
  JOIN dim_discipline d ON d.discipline_key = f.discipline_key
  WHERE (f.home_team_key = %(team_key)s OR f.away_team_key = %(team_key)s)
    AND (%(season)s::int IS NULL OR s.season_id = %(season)s::int)
), tm AS (
  SELECT match_id, season_id, league_group_id, group_name, division_name, match_date, round_no, side, opponent_key,
         count(*) FILTER (WHERE won) AS disc_won,
         count(*) FILTER (WHERE NOT won) AS disc_lost,
         coalesce(sum(sets_won) FILTER (WHERE NOT is_walkover), 0) AS sets_won,
         coalesce(sum(sets_lost) FILTER (WHERE NOT is_walkover), 0) AS sets_lost,
         coalesce(sum(points_won) FILTER (WHERE NOT is_walkover), 0) AS points_won,
         coalesce(sum(points_lost) FILTER (WHERE NOT is_walkover), 0) AS points_lost
  FROM m
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
)
"""


def resolve_team(cur: psycopg.Cursor[Any], slug: str) -> dict[str, Any]:
    cur.execute(
        f"SELECT team_key, team_name FROM dim_team WHERE {slug_sql('team_name')} = %(slug)s LIMIT 1",
        {"slug": slug},
    )
    row = one(cur)
    if not row:
        raise NotFound(f"Holdet '{slug}' blev ikke fundet")
    return row


def team_summary(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> dict[str, Any]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT
          (SELECT count(*) FROM tm) AS team_matches,
          (SELECT count(*) FROM tm WHERE disc_won > disc_lost) AS team_wins,
          (SELECT count(*) FROM tm WHERE disc_won = disc_lost) AS team_draws,
          (SELECT count(*) FROM tm WHERE disc_won < disc_lost) AS team_losses,
          count(*) AS matches,
          count(*) FILTER (WHERE won) AS wins,
          count(*) FILTER (WHERE is_walkover) AS walkovers,
          count(*) FILTER (WHERE NOT is_walkover) AS nw_matches,
          count(*) FILTER (WHERE won AND NOT is_walkover) AS nw_wins,
          coalesce(sum(sets_won) FILTER (WHERE NOT is_walkover), 0) AS sets_won,
          coalesce(sum(sets_lost) FILTER (WHERE NOT is_walkover), 0) AS sets_lost,
          coalesce(sum(points_won) FILTER (WHERE NOT is_walkover), 0) AS points_won,
          coalesce(sum(points_lost) FILTER (WHERE NOT is_walkover), 0) AS points_lost,
          count(*) FILTER (WHERE sets_played = 3 AND NOT is_walkover) AS three_set,
          count(*) FILTER (WHERE sets_played = 3 AND NOT is_walkover AND won) AS three_set_wins
        FROM m
        """,
        params,
    )
    r = one(cur) or {}
    tm = r.get("team_matches", 0)
    return {
        "teamMatches": tm,
        "teamWins": r.get("team_wins", 0),
        "teamDraws": r.get("team_draws", 0),
        "teamLosses": r.get("team_losses", 0),
        "teamWinPct": pct(r.get("team_wins"), tm),
        "matches": r.get("matches", 0),
        "wins": r.get("wins", 0),
        "losses": (r.get("matches", 0) or 0) - (r.get("wins", 0) or 0),
        "winPct": pct(r.get("wins"), r.get("matches")),
        "walkovers": r.get("walkovers", 0),
        "nonWalkoverMatches": r.get("nw_matches", 0),
        "nonWalkoverWinPct": pct(r.get("nw_wins"), r.get("nw_matches")),
        "setsWon": r.get("sets_won", 0),
        "setsLost": r.get("sets_lost", 0),
        "setWinPct": pct(r.get("sets_won"), (r.get("sets_won", 0) or 0) + (r.get("sets_lost", 0) or 0)),
        "pointsWon": r.get("points_won", 0),
        "pointsLost": r.get("points_lost", 0),
        "pointWinPct": pct(r.get("points_won"), (r.get("points_won", 0) or 0) + (r.get("points_lost", 0) or 0)),
        "avgPointMargin": ratio((r.get("points_won", 0) or 0) - (r.get("points_lost", 0) or 0), r.get("nw_matches")),
        "threeSetMatches": r.get("three_set", 0),
        "threeSetWins": r.get("three_set_wins", 0),
        "threeSetWinPct": pct(r.get("three_set_wins"), r.get("three_set")),
    }


def team_by_match_type(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT discipline_code, discipline_no, discipline_label,
               count(*) AS played, count(*) FILTER (WHERE won) AS wins,
               coalesce(sum(sets_won) FILTER (WHERE NOT is_walkover), 0) AS sets_won,
               coalesce(sum(sets_lost) FILTER (WHERE NOT is_walkover), 0) AS sets_lost
        FROM m GROUP BY 1, 2, 3
        """,
        params,
    )
    out = []
    for r in rows(cur):
        out.append(
            {
                "matchType": match_type_label(r["discipline_code"], r["discipline_no"]),
                "code": r["discipline_code"],
                "number": r["discipline_no"],
                "played": r["played"],
                "wins": r["wins"],
                "losses": r["played"] - r["wins"],
                "winPct": pct(r["wins"], r["played"]),
                "setsWon": r["sets_won"],
                "setsLost": r["sets_lost"],
            }
        )
    out.sort(key=lambda x: (x["number"] or 0, discipline_sort_key(x["code"])))
    return out


def team_by_discipline(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT discipline_code, count(*) AS played, count(*) FILTER (WHERE won) AS wins,
               coalesce(sum(sets_won) FILTER (WHERE NOT is_walkover), 0) AS sets_won,
               coalesce(sum(sets_lost) FILTER (WHERE NOT is_walkover), 0) AS sets_lost,
               coalesce(sum(points_won) FILTER (WHERE NOT is_walkover), 0) AS points_won,
               coalesce(sum(points_lost) FILTER (WHERE NOT is_walkover), 0) AS points_lost
        FROM m GROUP BY 1
        """,
        params,
    )
    out = []
    for r in rows(cur):
        out.append(
            {
                "code": r["discipline_code"],
                "played": r["played"],
                "wins": r["wins"],
                "losses": r["played"] - r["wins"],
                "winPct": pct(r["wins"], r["played"]),
                "setWinPct": pct(r["sets_won"], r["sets_won"] + r["sets_lost"]),
                "pointWinPct": pct(r["points_won"], r["points_won"] + r["points_lost"]),
            }
        )
    out.sort(key=lambda x: discipline_sort_key(x["code"]))
    return out


def team_home_away(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> dict[str, Any]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT side, count(*) AS played,
               count(*) FILTER (WHERE disc_won > disc_lost) AS wins,
               count(*) FILTER (WHERE disc_won = disc_lost) AS draws,
               count(*) FILTER (WHERE disc_won < disc_lost) AS losses
        FROM tm GROUP BY side
        """,
        params,
    )
    out = {"home": None, "away": None}
    for r in rows(cur):
        key = "home" if r["side"] == "H" else "away"
        out[key] = {
            "played": r["played"],
            "wins": r["wins"],
            "draws": r["draws"],
            "losses": r["losses"],
            "winPct": pct(r["wins"], r["played"]),
        }
    return out


def team_opponents(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT t.team_name, count(*) AS played,
               count(*) FILTER (WHERE disc_won > disc_lost) AS wins,
               count(*) FILTER (WHERE disc_won = disc_lost) AS draws,
               count(*) FILTER (WHERE disc_won < disc_lost) AS losses,
               sum(disc_won) AS disc_won, sum(disc_lost) AS disc_lost
        FROM tm JOIN dim_team t ON t.team_key = tm.opponent_key
        GROUP BY t.team_name
        ORDER BY played DESC, wins DESC, t.team_name
        """,
        params,
    )
    return [
        {
            "team": entity(r["team_name"]),
            "played": r["played"],
            "wins": r["wins"],
            "draws": r["draws"],
            "losses": r["losses"],
            "winPct": pct(r["wins"], r["played"]),
            "disciplinesWon": r["disc_won"],
            "disciplinesLost": r["disc_lost"],
        }
        for r in rows(cur)
    ]


def team_players(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT p.player_name,
               count(DISTINCT m.match_id) AS team_matches,
               count(*) AS matches,
               count(*) FILTER (WHERE m.won) AS wins,
               count(*) FILTER (WHERE NOT m.is_walkover) AS nw_matches,
               count(*) FILTER (WHERE m.won AND NOT m.is_walkover) AS nw_wins,
               coalesce(sum(m.sets_won) FILTER (WHERE NOT m.is_walkover), 0) AS sets_won,
               coalesce(sum(m.sets_lost) FILTER (WHERE NOT m.is_walkover), 0) AS sets_lost,
               string_agg(DISTINCT m.discipline_code, ',') AS codes
        FROM m
        JOIN bridge_individual_match_player b
          ON b.individual_match_key = m.individual_match_key AND b.side_code = m.side
        JOIN dim_player p ON p.player_key = b.player_key AND NOT p.is_placeholder
        GROUP BY p.player_name
        ORDER BY team_matches DESC, matches DESC, wins DESC, p.player_name
        LIMIT 60
        """,
        params,
    )
    out = []
    for r in rows(cur):
        codes = sorted((r["codes"] or "").split(","), key=discipline_sort_key)
        out.append(
            {
                "player": entity(r["player_name"]),
                "teamMatches": r["team_matches"],
                "matches": r["matches"],
                "wins": r["wins"],
                "losses": r["matches"] - r["wins"],
                "winPct": pct(r["wins"], r["matches"]),
                "nonWalkoverWinPct": pct(r["nw_wins"], r["nw_matches"]),
                "setsWon": r["sets_won"],
                "setsLost": r["sets_lost"],
                "disciplines": [c for c in codes if c],
            }
        )
    return out


def team_pairs(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT least(p1.player_name, p2.player_name) AS a,
               greatest(p1.player_name, p2.player_name) AS b,
               m.discipline_code,
               count(*) AS played, count(*) FILTER (WHERE m.won) AS wins
        FROM m
        JOIN bridge_individual_match_player b1
          ON b1.individual_match_key = m.individual_match_key AND b1.side_code = m.side AND b1.player_slot = 1
        JOIN bridge_individual_match_player b2
          ON b2.individual_match_key = m.individual_match_key AND b2.side_code = m.side AND b2.player_slot = 2
        JOIN dim_player p1 ON p1.player_key = b1.player_key AND NOT p1.is_placeholder
        JOIN dim_player p2 ON p2.player_key = b2.player_key AND NOT p2.is_placeholder
        WHERE m.discipline_code = ANY(%(doubles)s)
        GROUP BY 1, 2, 3
        ORDER BY played DESC, wins DESC, a, b
        LIMIT 25
        """,
        {**params, "doubles": list(DOUBLES_CODES)},
    )
    return [
        {
            "players": [entity(r["a"]), entity(r["b"])],
            "code": r["discipline_code"],
            "played": r["played"],
            "wins": r["wins"],
            "losses": r["played"] - r["wins"],
            "winPct": pct(r["wins"], r["played"]),
        }
        for r in rows(cur)
    ]


def team_season_trend(cur: psycopg.Cursor[Any], team_key: int) -> list[dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT season_id,
               string_agg(DISTINCT division_name, ' / ') AS divisions,
               count(*) AS team_matches,
               count(*) FILTER (WHERE disc_won > disc_lost) AS wins,
               count(*) FILTER (WHERE disc_won = disc_lost) AS draws,
               count(*) FILTER (WHERE disc_won < disc_lost) AS losses,
               sum(disc_won) AS disc_won, sum(disc_lost) AS disc_lost,
               sum(points_won) AS points_won, sum(points_lost) AS points_lost
        FROM tm GROUP BY season_id ORDER BY season_id
        """,
        {"team_key": team_key, "season": None},
    )
    return [
        {
            "seasonId": r["season_id"],
            "divisions": r["divisions"],
            "teamMatches": r["team_matches"],
            "wins": r["wins"],
            "draws": r["draws"],
            "losses": r["losses"],
            "teamWinPct": pct(r["wins"], r["team_matches"]),
            "disciplinesWon": r["disc_won"],
            "disciplinesLost": r["disc_lost"],
            "disciplineWinPct": pct(r["disc_won"], r["disc_won"] + r["disc_lost"]),
            "pointsWon": r["points_won"],
            "pointsLost": r["points_lost"],
            "pointDelta": r["points_won"] - r["points_lost"],
        }
        for r in rows(cur)
    ]


def team_matches(cur: psycopg.Cursor[Any], params: dict[str, Any], limit: int = 60) -> list[dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT tm.*, t.team_name AS opponent_name
        FROM tm JOIN dim_team t ON t.team_key = tm.opponent_key
        ORDER BY match_date DESC, match_id DESC
        LIMIT %(limit)s
        """,
        {**params, "limit": limit},
    )
    out = []
    for r in rows(cur):
        out.append(
            {
                "matchId": r["match_id"],
                "seasonId": r["season_id"],
                "groupId": r["league_group_id"],
                "groupName": r["group_name"],
                "division": r["division_name"],
                "date": r["match_date"],
                "round": r["round_no"],
                "home": r["side"] == "H",
                "opponent": entity(r["opponent_name"]),
                "result": result_code(r["disc_won"], r["disc_lost"]),
                "disciplinesWon": r["disc_won"],
                "disciplinesLost": r["disc_lost"],
                "setsWon": r["sets_won"],
                "setsLost": r["sets_lost"],
                "pointsWon": r["points_won"],
                "pointsLost": r["points_lost"],
            }
        )
    return out


def team_seasons(cur: psycopg.Cursor[Any], team_key: int) -> list[dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT season_id, division_name, group_name, league_group_id, count(DISTINCT match_id) AS team_matches
        FROM m GROUP BY 1, 2, 3, 4 ORDER BY season_id DESC, division_name, group_name
        """,
        {"team_key": team_key, "season": None},
    )
    return [
        {
            "seasonId": r["season_id"],
            "division": r["division_name"],
            "groupName": r["group_name"],
            "groupId": r["league_group_id"],
            "teamMatches": r["team_matches"],
        }
        for r in rows(cur)
    ]


def team_profile(settings: Settings, slug: str, season: int | None) -> dict[str, Any]:
    with individual_cursor(settings) as cur:
        team = resolve_team(cur, slug)
        params = {"team_key": team["team_key"], "season": season}
        summary = team_summary(cur, params)
        matches = team_matches(cur, params)
        return {
            "team": entity(team["team_name"]),
            "seasonId": season,
            "seasons": team_seasons(cur, team["team_key"]),
            "summary": summary,
            "form": [m["result"] for m in matches[:8]],
            "byMatchType": team_by_match_type(cur, params),
            "byDiscipline": team_by_discipline(cur, params),
            "homeAway": team_home_away(cur, params),
            "opponents": team_opponents(cur, params),
            "players": team_players(cur, params),
            "pairs": team_pairs(cur, params),
            "seasonTrend": team_season_trend(cur, team["team_key"]),
            "matches": matches,
        }
