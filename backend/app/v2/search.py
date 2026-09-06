from __future__ import annotations

from typing import Any

from ..settings import Settings
from .common import entity, individual_cursor, rows


def search(settings: Settings, query: str, season: int | None, limit: int) -> dict[str, Any]:
    pattern = f"%{query}%"
    with individual_cursor(settings) as cur:
        cur.execute(
            """
            SELECT t.team_name, count(DISTINCT f.season_key) AS seasons, max(s.season_id) AS last_season,
                   count(DISTINCT f.match_id) AS team_matches
            FROM dim_team t
            JOIN fact_individual_match f ON f.home_team_key = t.team_key OR f.away_team_key = t.team_key
            JOIN dim_season s ON s.season_key = f.season_key
            WHERE t.team_name ILIKE %(pattern)s
              AND (%(season)s::int IS NULL OR s.season_id = %(season)s::int)
            GROUP BY t.team_name
            ORDER BY position(lower(%(q)s) IN lower(t.team_name)), team_matches DESC, t.team_name
            LIMIT %(limit)s
            """,
            {"pattern": pattern, "q": query, "season": season, "limit": limit},
        )
        teams = [
            {**entity(r["team_name"]), "seasons": r["seasons"], "lastSeason": r["last_season"], "teamMatches": r["team_matches"]}
            for r in rows(cur)
        ]
        cur.execute(
            """
            SELECT p.player_name, count(*) AS matches, max(s.season_id) AS last_season,
                   (SELECT t.team_name
                      FROM bridge_individual_match_player b2
                      JOIN fact_individual_match f2 ON f2.individual_match_key = b2.individual_match_key
                      JOIN dim_team t ON t.team_key = CASE WHEN b2.side_code = 'H' THEN f2.home_team_key ELSE f2.away_team_key END
                     WHERE b2.player_key = p.player_key
                     GROUP BY t.team_name ORDER BY max(f2.match_date_key) DESC, count(*) DESC LIMIT 1) AS team_name
            FROM dim_player p
            JOIN bridge_individual_match_player b ON b.player_key = p.player_key
            JOIN fact_individual_match f ON f.individual_match_key = b.individual_match_key
            JOIN dim_season s ON s.season_key = f.season_key
            WHERE NOT p.is_placeholder AND p.player_name ILIKE %(pattern)s
              AND (%(season)s::int IS NULL OR s.season_id = %(season)s::int)
            GROUP BY p.player_key, p.player_name
            ORDER BY position(lower(%(q)s) IN lower(p.player_name)), matches DESC, p.player_name
            LIMIT %(limit)s
            """,
            {"pattern": pattern, "q": query, "season": season, "limit": limit},
        )
        players = [
            {
                **entity(r["player_name"]),
                "matches": r["matches"],
                "lastSeason": r["last_season"],
                "team": entity(r["team_name"]) if r["team_name"] else None,
            }
            for r in rows(cur)
        ]
    return {"query": query, "teams": teams, "players": players}
