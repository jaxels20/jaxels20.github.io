from __future__ import annotations

from typing import Any

from ..settings import Settings
from .common import NotFound, discipline_sort_key, entity, individual_cursor, match_type_label, one, pct, player_entities, rows, team_cursor

DIVISION_TIER = {
    "Badmintonligaen": 1,
    "1. division": 2,
    "2. division": 3,
    "3. division": 4,
    "Danmarksserien": 5,
}


def division_tier(name: str) -> int:
    for key, tier in DIVISION_TIER.items():
        if name == key:
            return tier
    for key, tier in DIVISION_TIER.items():
        if name.startswith(key):
            return tier + 10
    return 99


def list_seasons(settings: Settings) -> list[dict[str, Any]]:
    with team_cursor(settings) as cur:
        cur.execute("SELECT season_id, season_label FROM dim_season ORDER BY season_id DESC")
        return [{"seasonId": r["season_id"], "label": r["season_label"]} for r in rows(cur)]


def list_leagues(settings: Settings, season: int) -> dict[str, Any]:
    with team_cursor(settings) as cur:
        cur.execute(
            """
            SELECT dv.division_name, g.league_group_id, g.group_name,
                   count(*) AS matches,
                   count(*) FILTER (WHERE f.home_team_points IS NOT NULL) AS played,
                   count(DISTINCT f.home_team_key) AS teams,
                   min(dd.full_date) AS first_date, max(dd.full_date) AS last_date
            FROM fact_team_match f
            JOIN dim_season s ON s.season_key = f.season_key
            JOIN dim_group g ON g.group_key = f.group_key
            JOIN dim_division dv ON dv.division_key = g.division_key
            LEFT JOIN dim_date dd ON dd.date_key = f.match_date_key
            WHERE s.season_id = %(season)s
            GROUP BY 1, 2, 3
            """,
            {"season": season},
        )
        groups = rows(cur)

    divisions: dict[str, dict[str, Any]] = {}
    for g in groups:
        div = divisions.setdefault(
            g["division_name"],
            {"name": g["division_name"], "tier": division_tier(g["division_name"]), "groups": []},
        )
        div["groups"].append(
            {
                "groupId": g["league_group_id"],
                "name": g["group_name"],
                "teams": g["teams"],
                "matches": g["matches"],
                "played": g["played"],
                "firstDate": g["first_date"],
                "lastDate": g["last_date"],
            }
        )
    ordered = sorted(divisions.values(), key=lambda d: (d["tier"], d["name"]))
    for d in ordered:
        d["groups"].sort(key=lambda x: (x["name"].lower().startswith(("kval", "nedryk", "oprykning")), x["name"]))
    return {"seasonId": season, "divisions": ordered}


def group_detail(settings: Settings, season: int, group_id: int) -> dict[str, Any]:
    with team_cursor(settings) as cur:
        cur.execute(
            """
            SELECT g.group_name, dv.division_name, s.season_label
            FROM dim_group g
            JOIN dim_season s ON s.season_key = g.season_key
            JOIN dim_division dv ON dv.division_key = g.division_key
            WHERE s.season_id = %(season)s AND g.league_group_id = %(group)s
            """,
            {"season": season, "group": group_id},
        )
        meta = one(cur)
        if not meta:
            raise NotFound("Puljen blev ikke fundet")

        cur.execute(
            """
            WITH played AS (
              SELECT f.*
              FROM fact_team_match f
              JOIN dim_season s ON s.season_key = f.season_key
              JOIN dim_group g ON g.group_key = f.group_key
              WHERE s.season_id = %(season)s AND g.league_group_id = %(group)s
                AND f.home_team_points IS NOT NULL
            ), sides AS (
              SELECT home_team_key AS team_key, home_disciplines_won AS df, away_disciplines_won AS da,
                     home_team_points AS pts, away_team_points AS opts, home_win AS won, is_draw AS draw
              FROM played
              UNION ALL
              SELECT away_team_key, away_disciplines_won, home_disciplines_won,
                     away_team_points, home_team_points, away_win, is_draw
              FROM played
            )
            SELECT t.team_name, count(*) AS played,
                   count(*) FILTER (WHERE won) AS wins,
                   count(*) FILTER (WHERE draw) AS draws,
                   count(*) FILTER (WHERE NOT won AND NOT draw) AS losses,
                   coalesce(sum(df), 0) AS disc_for, coalesce(sum(da), 0) AS disc_against,
                   coalesce(sum(pts), 0) AS points, coalesce(sum(opts), 0) AS points_against
            FROM sides JOIN dim_team t ON t.team_key = sides.team_key
            GROUP BY t.team_name
            ORDER BY points DESC, (coalesce(sum(df), 0) - coalesce(sum(da), 0)) DESC, wins DESC, t.team_name
            """,
            {"season": season, "group": group_id},
        )
        standings = []
        for i, r in enumerate(rows(cur), start=1):
            standings.append(
                {
                    "rank": i,
                    "team": entity(r["team_name"]),
                    "played": r["played"],
                    "wins": r["wins"],
                    "draws": r["draws"],
                    "losses": r["losses"],
                    "disciplinesFor": r["disc_for"],
                    "disciplinesAgainst": r["disc_against"],
                    "disciplineDiff": r["disc_for"] - r["disc_against"],
                    "points": r["points"],
                    "pointsAgainst": r["points_against"],
                }
            )

        cur.execute(
            """
            SELECT r.round_no, r.round_label, rd.full_date AS round_date,
                   f.match_id, dd.full_date AS match_date, f.scheduled_time_raw, f.scheduled_time,
                   ht.team_name AS home, at.team_name AS away,
                   f.home_disciplines_won, f.away_disciplines_won, f.home_team_points, f.away_team_points,
                   f.has_walkover, v.venue_name, (f.home_team_points IS NOT NULL) AS played
            FROM fact_team_match f
            JOIN dim_season s ON s.season_key = f.season_key
            JOIN dim_group g ON g.group_key = f.group_key
            JOIN dim_team ht ON ht.team_key = f.home_team_key
            JOIN dim_team at ON at.team_key = f.away_team_key
            LEFT JOIN dim_round r ON r.round_key = f.round_key
            LEFT JOIN dim_date rd ON rd.date_key = r.round_date_key
            LEFT JOIN dim_date dd ON dd.date_key = f.match_date_key
            LEFT JOIN dim_venue v ON v.venue_key = f.venue_key
            WHERE s.season_id = %(season)s AND g.league_group_id = %(group)s
            ORDER BY r.round_no NULLS LAST, dd.full_date NULLS LAST, f.match_id
            """,
            {"season": season, "group": group_id},
        )
        rounds: dict[Any, dict[str, Any]] = {}
        for r in rows(cur):
            key = r["round_no"]
            rnd = rounds.setdefault(
                key,
                {"round": key, "label": r["round_label"], "date": r["round_date"], "matches": []},
            )
            rnd["matches"].append(
                {
                    "matchId": r["match_id"],
                    "date": r["match_date"],
                    "time": str(r["scheduled_time"])[:5] if r["scheduled_time"] else None,
                    "scheduled": r["scheduled_time_raw"],
                    "home": entity(r["home"]),
                    "away": entity(r["away"]),
                    "played": r["played"],
                    "homeDisciplines": r["home_disciplines_won"],
                    "awayDisciplines": r["away_disciplines_won"],
                    "homePoints": r["home_team_points"],
                    "awayPoints": r["away_team_points"],
                    "walkover": r["has_walkover"],
                    "venue": r["venue_name"],
                }
            )

    return {
        "seasonId": season,
        "seasonLabel": meta["season_label"],
        "groupId": group_id,
        "name": meta["group_name"],
        "division": meta["division_name"],
        "standings": standings,
        "rounds": list(rounds.values()),
    }


def match_detail(settings: Settings, season: int, group_id: int, match_id: int) -> dict[str, Any]:
    with team_cursor(settings) as cur:
        cur.execute(
            """
            SELECT f.match_id, g.group_name, g.league_group_id, dv.division_name, s.season_label,
                   r.round_no, r.round_label, dd.full_date AS match_date, f.scheduled_time_raw, f.scheduled_time,
                   ht.team_name AS home, at.team_name AS away,
                   f.home_disciplines_won, f.away_disciplines_won, f.home_team_points, f.away_team_points,
                   f.has_walkover, f.walkover_code, v.venue_name, o.organizer_name, f.livescore_url,
                   (f.home_team_points IS NOT NULL) AS played
            FROM fact_team_match f
            JOIN dim_season s ON s.season_key = f.season_key
            JOIN dim_group g ON g.group_key = f.group_key
            JOIN dim_division dv ON dv.division_key = g.division_key
            JOIN dim_team ht ON ht.team_key = f.home_team_key
            JOIN dim_team at ON at.team_key = f.away_team_key
            LEFT JOIN dim_round r ON r.round_key = f.round_key
            LEFT JOIN dim_date dd ON dd.date_key = f.match_date_key
            LEFT JOIN dim_venue v ON v.venue_key = f.venue_key
            LEFT JOIN dim_organizer o ON o.organizer_key = f.organizer_key
            WHERE s.season_id = %(season)s AND g.league_group_id = %(group)s AND f.match_id = %(match_id)s
            """,
            {"season": season, "group": group_id, "match_id": match_id},
        )
        meta = one(cur)
        if not meta:
            raise NotFound("Holdkampen blev ikke fundet")

    with individual_cursor(settings) as cur:
        cur.execute(
            """
            SELECT d.discipline_code, d.discipline_no, d.discipline_label, f.winner_side,
                   f.home_sets_won, f.away_sets_won, f.sets_played, f.home_points_scored, f.away_points_scored,
                   f.is_walkover, f.walkover_code, f.set_scores_raw,
                   (SELECT json_agg(json_build_object('name', p.player_name, 'id', p.player_id, 'placeholder', p.is_placeholder) ORDER BY b.player_slot)
                      FROM bridge_individual_match_player b JOIN dim_player p ON p.player_key = b.player_key
                     WHERE b.individual_match_key = f.individual_match_key AND b.side_code = 'H') AS home_players,
                   (SELECT json_agg(json_build_object('name', p.player_name, 'id', p.player_id, 'placeholder', p.is_placeholder) ORDER BY b.player_slot)
                      FROM bridge_individual_match_player b JOIN dim_player p ON p.player_key = b.player_key
                     WHERE b.individual_match_key = f.individual_match_key AND b.side_code = 'A') AS away_players
            FROM fact_individual_match f
            JOIN dim_season s ON s.season_key = f.season_key
            JOIN dim_group g ON g.group_key = f.group_key
            JOIN dim_discipline d ON d.discipline_key = f.discipline_key
            WHERE s.season_id = %(season)s AND g.league_group_id = %(group)s AND f.match_id = %(match_id)s
            """,
            {"season": season, "group": group_id, "match_id": match_id},
        )
        games = []
        for r in rows(cur):
            games.append(
                {
                    "matchType": match_type_label(r["discipline_code"], r["discipline_no"]),
                    "code": r["discipline_code"],
                    "number": r["discipline_no"],
                    "homePlayers": player_entities(r["home_players"]),
                    "awayPlayers": player_entities(r["away_players"]),
                    "winner": r["winner_side"],
                    "homeSets": r["home_sets_won"],
                    "awaySets": r["away_sets_won"],
                    "setsPlayed": r["sets_played"],
                    "homePoints": r["home_points_scored"],
                    "awayPoints": r["away_points_scored"],
                    "walkover": r["is_walkover"],
                    "walkoverCode": r["walkover_code"],
                    "setScores": r["set_scores_raw"],
                }
            )
        games.sort(key=lambda g: discipline_sort_key(g["code"], g["number"]))

    home_won = sum(1 for g in games if g["winner"] == "home")
    away_won = sum(1 for g in games if g["winner"] == "away")
    return {
        "matchId": meta["match_id"],
        "seasonId": season,
        "seasonLabel": meta["season_label"],
        "groupId": meta["league_group_id"],
        "groupName": meta["group_name"],
        "division": meta["division_name"],
        "round": meta["round_no"],
        "roundLabel": meta["round_label"],
        "date": meta["match_date"],
        "time": str(meta["scheduled_time"])[:5] if meta["scheduled_time"] else None,
        "scheduled": meta["scheduled_time_raw"],
        "venue": meta["venue_name"],
        "organizer": meta["organizer_name"],
        "livescoreUrl": meta["livescore_url"],
        "played": meta["played"],
        "home": entity(meta["home"]),
        "away": entity(meta["away"]),
        "homeDisciplines": meta["home_disciplines_won"] if meta["played"] else home_won,
        "awayDisciplines": meta["away_disciplines_won"] if meta["played"] else away_won,
        "homePoints": meta["home_team_points"],
        "awayPoints": meta["away_team_points"],
        "walkover": meta["has_walkover"],
        "games": games,
    }
