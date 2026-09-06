from __future__ import annotations

from typing import Any

import psycopg

from ..settings import Settings
from .common import (
    NotFound,
    discipline_sort_key,
    entity,
    individual_cursor,
    match_type_label,
    one,
    pct,
    ratio,
    rows,
    slug_sql,
)

# One row per individual match the player took part in, from the player's side.
PLAYER_BASE = """
WITH pm AS (
  SELECT f.individual_match_key, f.match_id, s.season_id, g.league_group_id, g.group_name, dv.division_name,
         dd.full_date AS match_date, r.round_no, d.discipline_code, d.discipline_no, d.discipline_label,
         b.side_code AS side,
         CASE WHEN b.side_code = 'H' THEN f.home_team_key ELSE f.away_team_key END AS team_key,
         CASE WHEN b.side_code = 'H' THEN f.away_team_key ELSE f.home_team_key END AS opponent_team_key,
         (f.winner_side = CASE WHEN b.side_code = 'H' THEN 'home' ELSE 'away' END) AS won,
         CASE WHEN b.side_code = 'H' THEN f.home_sets_won ELSE f.away_sets_won END AS sets_won,
         CASE WHEN b.side_code = 'H' THEN f.away_sets_won ELSE f.home_sets_won END AS sets_lost,
         CASE WHEN b.side_code = 'H' THEN f.home_points_scored ELSE f.away_points_scored END AS points_won,
         CASE WHEN b.side_code = 'H' THEN f.away_points_scored ELSE f.home_points_scored END AS points_lost,
         f.sets_played, f.is_walkover, f.walkover_code, f.set_scores_raw
  FROM bridge_individual_match_player b
  JOIN fact_individual_match f ON f.individual_match_key = b.individual_match_key
  JOIN dim_season s ON s.season_key = f.season_key
  JOIN dim_group g ON g.group_key = f.group_key
  JOIN dim_division dv ON dv.division_key = g.division_key
  JOIN dim_date dd ON dd.date_key = f.match_date_key
  JOIN dim_round r ON r.round_key = f.round_key
  JOIN dim_discipline d ON d.discipline_key = f.discipline_key
  WHERE b.player_key = %(player_key)s
    AND (%(season)s::int IS NULL OR s.season_id = %(season)s::int)
)
"""


def resolve_player(cur: psycopg.Cursor[Any], slug: str) -> dict[str, Any]:
    cur.execute(
        f"SELECT player_key, player_name FROM dim_player WHERE NOT is_placeholder AND {slug_sql('player_name')} = %(slug)s LIMIT 1",
        {"slug": slug},
    )
    row = one(cur)
    if not row:
        raise NotFound(f"Spilleren '{slug}' blev ikke fundet")
    return row


def player_summary(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> dict[str, Any]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT count(*) AS matches,
               count(*) FILTER (WHERE won) AS wins,
               count(DISTINCT match_id) AS team_matches,
               count(*) FILTER (WHERE is_walkover) AS walkovers,
               count(*) FILTER (WHERE NOT is_walkover) AS nw_matches,
               count(*) FILTER (WHERE won AND NOT is_walkover) AS nw_wins,
               coalesce(sum(sets_won) FILTER (WHERE NOT is_walkover), 0) AS sets_won,
               coalesce(sum(sets_lost) FILTER (WHERE NOT is_walkover), 0) AS sets_lost,
               coalesce(sum(points_won) FILTER (WHERE NOT is_walkover), 0) AS points_won,
               coalesce(sum(points_lost) FILTER (WHERE NOT is_walkover), 0) AS points_lost,
               count(*) FILTER (WHERE sets_played = 3 AND NOT is_walkover) AS three_set,
               count(*) FILTER (WHERE sets_played = 3 AND NOT is_walkover AND won) AS three_set_wins,
               count(*) FILTER (WHERE sets_played = 2 AND NOT is_walkover AND won) AS straight_wins,
               count(*) FILTER (WHERE sets_played = 2 AND NOT is_walkover AND NOT won) AS straight_losses
        FROM pm
        """,
        params,
    )
    r = one(cur) or {}
    matches = r.get("matches", 0) or 0
    wins = r.get("wins", 0) or 0
    return {
        "matches": matches,
        "wins": wins,
        "losses": matches - wins,
        "winPct": pct(wins, matches),
        "teamMatches": r.get("team_matches", 0),
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
        "straightSetWins": r.get("straight_wins", 0),
        "straightSetLosses": r.get("straight_losses", 0),
    }


def player_by_discipline(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT discipline_code, count(*) AS played, count(*) FILTER (WHERE won) AS wins,
               coalesce(sum(sets_won) FILTER (WHERE NOT is_walkover), 0) AS sets_won,
               coalesce(sum(sets_lost) FILTER (WHERE NOT is_walkover), 0) AS sets_lost,
               coalesce(sum(points_won) FILTER (WHERE NOT is_walkover), 0) AS points_won,
               coalesce(sum(points_lost) FILTER (WHERE NOT is_walkover), 0) AS points_lost
        FROM pm GROUP BY 1
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


def player_by_match_type(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT discipline_code, discipline_no, count(*) AS played, count(*) FILTER (WHERE won) AS wins
        FROM pm GROUP BY 1, 2
        """,
        params,
    )
    out = [
        {
            "matchType": match_type_label(r["discipline_code"], r["discipline_no"]),
            "code": r["discipline_code"],
            "number": r["discipline_no"],
            "played": r["played"],
            "wins": r["wins"],
            "losses": r["played"] - r["wins"],
            "winPct": pct(r["wins"], r["played"]),
        }
        for r in rows(cur)
    ]
    out.sort(key=lambda x: (x["number"] or 0, discipline_sort_key(x["code"])))
    return out


def player_home_away(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> dict[str, Any]:
    cur.execute(
        PLAYER_BASE
        + "SELECT side, count(*) AS played, count(*) FILTER (WHERE won) AS wins FROM pm GROUP BY side",
        params,
    )
    out: dict[str, Any] = {"home": None, "away": None}
    for r in rows(cur):
        out["home" if r["side"] == "H" else "away"] = {
            "played": r["played"],
            "wins": r["wins"],
            "losses": r["played"] - r["wins"],
            "winPct": pct(r["wins"], r["played"]),
        }
    return out


def player_teams(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT t.team_name, min(season_id) AS first_season, max(season_id) AS last_season,
               string_agg(DISTINCT division_name, ' / ') AS divisions,
               count(*) AS played, count(*) FILTER (WHERE won) AS wins
        FROM pm JOIN dim_team t ON t.team_key = pm.team_key
        GROUP BY t.team_name ORDER BY last_season DESC, played DESC
        """,
        params,
    )
    return [
        {
            "team": entity(r["team_name"]),
            "firstSeason": r["first_season"],
            "lastSeason": r["last_season"],
            "divisions": r["divisions"],
            "played": r["played"],
            "wins": r["wins"],
            "winPct": pct(r["wins"], r["played"]),
        }
        for r in rows(cur)
    ]


def player_opponent_teams(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT t.team_name, count(*) AS played, count(*) FILTER (WHERE won) AS wins
        FROM pm JOIN dim_team t ON t.team_key = pm.opponent_team_key
        GROUP BY t.team_name ORDER BY played DESC, wins DESC, t.team_name LIMIT 30
        """,
        params,
    )
    return [
        {"team": entity(r["team_name"]), "played": r["played"], "wins": r["wins"], "winPct": pct(r["wins"], r["played"])}
        for r in rows(cur)
    ]


def player_partners(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT p.player_name, string_agg(DISTINCT pm.discipline_code, ',') AS codes,
               count(*) AS played, count(*) FILTER (WHERE pm.won) AS wins
        FROM pm
        JOIN bridge_individual_match_player b2
          ON b2.individual_match_key = pm.individual_match_key AND b2.side_code = pm.side
         AND b2.player_key <> %(player_key)s
        JOIN dim_player p ON p.player_key = b2.player_key AND NOT p.is_placeholder
        GROUP BY p.player_name ORDER BY played DESC, wins DESC, p.player_name LIMIT 20
        """,
        params,
    )
    return [
        {
            "player": entity(r["player_name"]),
            "disciplines": sorted((r["codes"] or "").split(","), key=discipline_sort_key),
            "played": r["played"],
            "wins": r["wins"],
            "losses": r["played"] - r["wins"],
            "winPct": pct(r["wins"], r["played"]),
        }
        for r in rows(cur)
    ]


def player_rivals(cur: psycopg.Cursor[Any], params: dict[str, Any]) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT p.player_name, count(*) AS played, count(*) FILTER (WHERE pm.won) AS wins
        FROM pm
        JOIN bridge_individual_match_player b2
          ON b2.individual_match_key = pm.individual_match_key AND b2.side_code <> pm.side
        JOIN dim_player p ON p.player_key = b2.player_key AND NOT p.is_placeholder
        GROUP BY p.player_name ORDER BY played DESC, wins DESC, p.player_name LIMIT 20
        """,
        params,
    )
    return [
        {
            "player": entity(r["player_name"]),
            "played": r["played"],
            "wins": r["wins"],
            "losses": r["played"] - r["wins"],
            "winPct": pct(r["wins"], r["played"]),
        }
        for r in rows(cur)
    ]


def player_season_trend(cur: psycopg.Cursor[Any], player_key: int) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT season_id, string_agg(DISTINCT division_name, ' / ') AS divisions,
               count(*) AS played, count(*) FILTER (WHERE won) AS wins,
               coalesce(sum(points_won) FILTER (WHERE NOT is_walkover), 0) AS points_won,
               coalesce(sum(points_lost) FILTER (WHERE NOT is_walkover), 0) AS points_lost
        FROM pm GROUP BY season_id ORDER BY season_id
        """,
        {"player_key": player_key, "season": None},
    )
    return [
        {
            "seasonId": r["season_id"],
            "divisions": r["divisions"],
            "played": r["played"],
            "wins": r["wins"],
            "losses": r["played"] - r["wins"],
            "winPct": pct(r["wins"], r["played"]),
            "pointsWon": r["points_won"],
            "pointsLost": r["points_lost"],
            "pointDelta": r["points_won"] - r["points_lost"],
        }
        for r in rows(cur)
    ]


def player_matches(cur: psycopg.Cursor[Any], params: dict[str, Any], limit: int = 80) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT pm.match_id, pm.season_id, pm.league_group_id, pm.group_name, pm.division_name, pm.match_date, pm.round_no,
               pm.discipline_code, pm.discipline_no, pm.side, pm.won, pm.sets_won, pm.sets_lost,
               pm.points_won, pm.points_lost, pm.sets_played, pm.is_walkover, pm.walkover_code, pm.set_scores_raw,
               t.team_name AS team_name, o.team_name AS opponent_name,
               (SELECT string_agg(p.player_name, ' / ' ORDER BY b2.player_slot)
                  FROM bridge_individual_match_player b2 JOIN dim_player p ON p.player_key = b2.player_key
                 WHERE b2.individual_match_key = pm.individual_match_key AND b2.side_code = pm.side
                   AND b2.player_key <> %(player_key)s AND NOT p.is_placeholder) AS partner,
               (SELECT string_agg(p.player_name, ' / ' ORDER BY b2.player_slot)
                  FROM bridge_individual_match_player b2 JOIN dim_player p ON p.player_key = b2.player_key
                 WHERE b2.individual_match_key = pm.individual_match_key AND b2.side_code <> pm.side) AS opponents
        FROM pm JOIN dim_team t ON t.team_key = pm.team_key JOIN dim_team o ON o.team_key = pm.opponent_team_key
        ORDER BY pm.match_date DESC, pm.match_id DESC, pm.discipline_no
        LIMIT %(limit)s
        """,
        {**params, "limit": limit},
    )
    out = []
    for r in rows(cur):
        scores = r["set_scores_raw"] or ""
        if r["side"] == "A" and scores:
            # set_scores_raw is stored home-vs-away; flip so the player's points come first
            flipped = []
            for part in scores.split(","):
                bits = part.strip().split("-")
                flipped.append("-".join(reversed(bits)) if len(bits) == 2 else part.strip())
            scores = ", ".join(flipped)
        out.append(
            {
                "matchId": r["match_id"],
                "seasonId": r["season_id"],
                "groupId": r["league_group_id"],
                "groupName": r["group_name"],
                "division": r["division_name"],
                "date": r["match_date"],
                "round": r["round_no"],
                "matchType": match_type_label(r["discipline_code"], r["discipline_no"]),
                "code": r["discipline_code"],
                "home": r["side"] == "H",
                "team": entity(r["team_name"]),
                "opponentTeam": entity(r["opponent_name"]),
                "partner": entity(r["partner"]) if r["partner"] else None,
                "opponents": [entity(n.strip()) for n in (r["opponents"] or "").split(" / ") if n.strip()],
                "result": "W" if r["won"] else "L",
                "setsWon": r["sets_won"],
                "setsLost": r["sets_lost"],
                "pointsWon": r["points_won"],
                "pointsLost": r["points_lost"],
                "setsPlayed": r["sets_played"],
                "walkover": r["is_walkover"],
                "walkoverCode": r["walkover_code"],
                "setScores": scores,
            }
        )
    return out


def player_seasons(cur: psycopg.Cursor[Any], player_key: int) -> list[dict[str, Any]]:
    cur.execute(
        PLAYER_BASE
        + """
        SELECT season_id, t.team_name, division_name, count(*) AS played
        FROM pm JOIN dim_team t ON t.team_key = pm.team_key
        GROUP BY 1, 2, 3 ORDER BY season_id DESC, played DESC
        """,
        {"player_key": player_key, "season": None},
    )
    return [
        {"seasonId": r["season_id"], "team": entity(r["team_name"]), "division": r["division_name"], "played": r["played"]}
        for r in rows(cur)
    ]


def player_profile(settings: Settings, slug: str, season: int | None) -> dict[str, Any]:
    with individual_cursor(settings) as cur:
        player = resolve_player(cur, slug)
        params = {"player_key": player["player_key"], "season": season}
        matches = player_matches(cur, params)
        teams = player_teams(cur, params)
        return {
            "player": entity(player["player_name"]),
            "seasonId": season,
            "seasons": player_seasons(cur, player["player_key"]),
            "currentTeam": teams[0]["team"] if teams else None,
            "summary": player_summary(cur, params),
            "form": [m["result"] for m in matches[:10]],
            "byDiscipline": player_by_discipline(cur, params),
            "byMatchType": player_by_match_type(cur, params),
            "homeAway": player_home_away(cur, params),
            "teams": teams,
            "opponentTeams": player_opponent_teams(cur, params),
            "partners": player_partners(cur, params),
            "rivals": player_rivals(cur, params),
            "seasonTrend": player_season_trend(cur, player["player_key"]),
            "matches": matches,
        }
