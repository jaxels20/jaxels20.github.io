from __future__ import annotations

from typing import Any

import psycopg

from .settings import Settings


def get_connection(settings: Settings) -> psycopg.Connection[Any]:
    return psycopg.connect(
        dbname=settings.db_name,
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        options="-c search_path=dw,public",
        row_factory=psycopg.rows.dict_row,
    )


def fetch_seasons(settings: Settings) -> list[dict[str, Any]]:
    sql = """
    SELECT season_id, season_label
    FROM dim_season
    ORDER BY season_id DESC;
    """
    with get_connection(settings) as conn, conn.cursor() as cur:
        cur.execute(sql)
        return list(cur.fetchall())


def search_players(
    settings: Settings, *, query: str, season_id: int | None, limit: int
) -> list[dict[str, Any]]:
    sql = """
    SELECT DISTINCT p.player_name AS name
    FROM dim_player p
    JOIN bridge_individual_match_player b
      ON b.player_key = p.player_key
    JOIN fact_individual_match f
      ON f.individual_match_key = b.individual_match_key
    JOIN dim_season s
      ON s.season_key = f.season_key
    WHERE p.player_name ILIKE %(query)s
      AND (%(season_id)s::int IS NULL OR s.season_id = %(season_id)s::int)
    ORDER BY p.player_name
    LIMIT %(limit)s;
    """
    with get_connection(settings) as conn, conn.cursor() as cur:
        cur.execute(
            sql,
            {
                "query": f"%{query}%",
                "season_id": season_id,
                "limit": limit,
            },
        )
        return list(cur.fetchall())


def search_teams(
    settings: Settings, *, query: str, season_id: int | None, limit: int
) -> list[dict[str, Any]]:
    sql = """
    SELECT DISTINCT t.team_name AS name
    FROM dim_team t
    WHERE t.team_name ILIKE %(query)s
      AND EXISTS (
        SELECT 1
        FROM fact_individual_match f
        JOIN dim_season s
          ON s.season_key = f.season_key
        WHERE (%(season_id)s::int IS NULL OR s.season_id = %(season_id)s::int)
          AND (f.home_team_key = t.team_key OR f.away_team_key = t.team_key)
      )
    ORDER BY t.team_name
    LIMIT %(limit)s;
    """
    with get_connection(settings) as conn, conn.cursor() as cur:
        cur.execute(
            sql,
            {
                "query": f"%{query}%",
                "season_id": season_id,
                "limit": limit,
            },
        )
        return list(cur.fetchall())
