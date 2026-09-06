from __future__ import annotations

from typing import Any

from ..settings import Settings
from .common import DOUBLES_CODES, SINGLES_CODES, entity, individual_cursor, pct, player_entity, ratio, rows

PLAYER_QUERY = """
WITH base AS (
  SELECT b.player_key, f.match_id, d.discipline_code, f.sets_played,
         CASE WHEN b.side_code = 'H' THEN f.home_team_key ELSE f.away_team_key END AS team_key,
         (f.winner_side = CASE WHEN b.side_code = 'H' THEN 'home' ELSE 'away' END) AS won,
         CASE WHEN b.side_code = 'H' THEN f.home_points_scored - f.away_points_scored
              ELSE f.away_points_scored - f.home_points_scored END AS margin,
         CASE WHEN b.side_code = 'H' THEN f.home_sets_won ELSE f.away_sets_won END AS sets_won,
         CASE WHEN b.side_code = 'H' THEN f.away_sets_won ELSE f.home_sets_won END AS sets_lost
  FROM fact_individual_match f
  JOIN bridge_individual_match_player b ON b.individual_match_key = f.individual_match_key
  JOIN dim_season s ON s.season_key = f.season_key
  JOIN dim_group g ON g.group_key = f.group_key
  JOIN dim_division dv ON dv.division_key = g.division_key
  JOIN dim_discipline d ON d.discipline_key = f.discipline_key
  WHERE s.season_id = %(season)s
    AND (%(division)s::text IS NULL OR dv.division_name = %(division)s::text)
    AND NOT f.is_walkover
), per_player AS (
  SELECT player_key,
         count(*) AS matches, count(*) FILTER (WHERE won) AS wins,
         count(DISTINCT match_id) AS team_matches,
         sum(margin) AS margin_sum,
         sum(sets_won) AS sets_won, sum(sets_lost) AS sets_lost,
         count(*) FILTER (WHERE sets_played = 3) AS three_set,
         count(*) FILTER (WHERE sets_played = 3 AND won) AS three_set_wins,
         count(*) FILTER (WHERE discipline_code = ANY(%(singles)s)) AS singles,
         count(*) FILTER (WHERE discipline_code = ANY(%(singles)s) AND won) AS singles_wins,
         count(*) FILTER (WHERE discipline_code = ANY(%(doubles)s)) AS doubles,
         count(*) FILTER (WHERE discipline_code = ANY(%(doubles)s) AND won) AS doubles_wins,
         mode() WITHIN GROUP (ORDER BY team_key) AS team_key
  FROM base GROUP BY player_key
)
SELECT p.player_name, p.player_id, t.team_name, pp.*
FROM per_player pp
JOIN dim_player p ON p.player_key = pp.player_key AND NOT p.is_placeholder
JOIN dim_team t ON t.team_key = pp.team_key
"""

PAIR_QUERY = """
WITH base AS (
  SELECT f.individual_match_key, f.match_id, d.discipline_code,
         least(b1.player_key, b2.player_key) AS k1, greatest(b1.player_key, b2.player_key) AS k2,
         CASE WHEN b1.side_code = 'H' THEN f.home_team_key ELSE f.away_team_key END AS team_key,
         (f.winner_side = CASE WHEN b1.side_code = 'H' THEN 'home' ELSE 'away' END) AS won
  FROM fact_individual_match f
  JOIN bridge_individual_match_player b1 ON b1.individual_match_key = f.individual_match_key AND b1.player_slot = 1
  JOIN bridge_individual_match_player b2 ON b2.individual_match_key = f.individual_match_key AND b2.player_slot = 2
                                        AND b2.side_code = b1.side_code
  JOIN dim_season s ON s.season_key = f.season_key
  JOIN dim_group g ON g.group_key = f.group_key
  JOIN dim_division dv ON dv.division_key = g.division_key
  JOIN dim_discipline d ON d.discipline_key = f.discipline_key
  WHERE s.season_id = %(season)s
    AND (%(division)s::text IS NULL OR dv.division_name = %(division)s::text)
    AND NOT f.is_walkover
    AND d.discipline_code = ANY(%(doubles)s)
), pairs AS (
  SELECT k1, k2, mode() WITHIN GROUP (ORDER BY team_key) AS team_key,
         string_agg(DISTINCT discipline_code, ',') AS codes,
         count(*) AS played, count(*) FILTER (WHERE won) AS wins
  FROM base GROUP BY k1, k2
  HAVING count(*) >= %(min_pair)s
)
SELECT pa.player_name AS a, pa.player_id AS a_id, pb.player_name AS b, pb.player_id AS b_id,
       t.team_name, pairs.codes, pairs.played, pairs.wins
FROM pairs
JOIN dim_player pa ON pa.player_key = pairs.k1 AND NOT pa.is_placeholder
JOIN dim_player pb ON pb.player_key = pairs.k2 AND NOT pb.is_placeholder
JOIN dim_team t ON t.team_key = pairs.team_key
"""


def _player_entry(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "player": player_entity(r["player_name"], r["player_id"]),
        "team": entity(r["team_name"]),
        "matches": r["matches"],
        "wins": r["wins"],
        "losses": r["matches"] - r["wins"],
        "winPct": pct(r["wins"], r["matches"]),
    }


def auto_min_matches(players: list[dict[str, Any]]) -> int:
    """A fixed threshold empties every list early in a season, when nobody has played
    many matches yet. Scale it to how far the season has come: half the busiest
    player's match count, never above 8 and never below 2."""
    if not players:
        return 2
    busiest = max(p["matches"] for p in players)
    return max(2, min(8, busiest // 2))


def leaderboards(
    settings: Settings, season: int, division: str | None, min_matches: int | None
) -> dict[str, Any]:
    with individual_cursor(settings) as cur:
        cur.execute(
            """
            SELECT DISTINCT dv.division_name
            FROM fact_individual_match f
            JOIN dim_season s ON s.season_key = f.season_key
            JOIN dim_group g ON g.group_key = f.group_key
            JOIN dim_division dv ON dv.division_key = g.division_key
            WHERE s.season_id = %(season)s
            """,
            {"season": season},
        )
        from .leagues import division_tier  # local import to avoid a cycle

        divisions = sorted((r["division_name"] for r in rows(cur)), key=lambda n: (division_tier(n), n))

        params = {
            "season": season,
            "division": division,
            "singles": list(SINGLES_CODES),
            "doubles": list(DOUBLES_CODES),
        }
        cur.execute(PLAYER_QUERY, params)
        players = rows(cur)
        if min_matches is None:
            min_matches = auto_min_matches(players)
        cur.execute(PAIR_QUERY, {**params, "min_pair": max(2, min_matches // 2)})
        pairs = rows(cur)

    def top(items: list[dict[str, Any]], key, extra, limit: int = 15) -> list[dict[str, Any]]:
        ordered = sorted(items, key=key, reverse=True)[:limit]
        return [{**_player_entry(r), **extra(r)} for r in ordered]

    qualified = [p for p in players if p["matches"] >= min_matches]
    singles_q = [p for p in players if p["singles"] >= min_matches]
    doubles_q = [p for p in players if p["doubles"] >= min_matches]
    three_q = [p for p in players if p["three_set"] >= max(2, min_matches // 2)]

    lists = {
        "winPct": top(
            qualified,
            key=lambda r: (r["wins"] / r["matches"], r["wins"], -r["matches"]),
            extra=lambda r: {"value": pct(r["wins"], r["matches"]), "unit": "%"},
        ),
        "mostWins": top(
            players,
            key=lambda r: (r["wins"], r["wins"] / max(r["matches"], 1)),
            extra=lambda r: {"value": r["wins"], "unit": "sejre"},
        ),
        "mostMatches": top(
            players,
            key=lambda r: (r["matches"], r["wins"]),
            extra=lambda r: {"value": r["matches"], "unit": "kampe"},
        ),
        "singles": top(
            singles_q,
            key=lambda r: (r["singles_wins"] / r["singles"], r["singles_wins"]),
            extra=lambda r: {
                "value": pct(r["singles_wins"], r["singles"]),
                "unit": "%",
                "matches": r["singles"],
                "wins": r["singles_wins"],
                "losses": r["singles"] - r["singles_wins"],
                "winPct": pct(r["singles_wins"], r["singles"]),
            },
        ),
        "doubles": top(
            doubles_q,
            key=lambda r: (r["doubles_wins"] / r["doubles"], r["doubles_wins"]),
            extra=lambda r: {
                "value": pct(r["doubles_wins"], r["doubles"]),
                "unit": "%",
                "matches": r["doubles"],
                "wins": r["doubles_wins"],
                "losses": r["doubles"] - r["doubles_wins"],
                "winPct": pct(r["doubles_wins"], r["doubles"]),
            },
        ),
        "threeSet": top(
            three_q,
            key=lambda r: (r["three_set_wins"] / r["three_set"], r["three_set_wins"]),
            extra=lambda r: {
                "value": pct(r["three_set_wins"], r["three_set"]),
                "unit": "%",
                "threeSetMatches": r["three_set"],
                "threeSetWins": r["three_set_wins"],
            },
        ),
        "pointMargin": top(
            qualified,
            key=lambda r: (r["margin_sum"] / r["matches"], r["wins"]),
            extra=lambda r: {"value": ratio(r["margin_sum"], r["matches"], 1), "unit": "point/kamp"},
        ),
        "pairs": [
            {
                "players": [player_entity(r["a"], r["a_id"]), player_entity(r["b"], r["b_id"])],
                "team": entity(r["team_name"]),
                "disciplines": (r["codes"] or "").split(","),
                "matches": r["played"],
                "wins": r["wins"],
                "losses": r["played"] - r["wins"],
                "winPct": pct(r["wins"], r["played"]),
                "value": pct(r["wins"], r["played"]),
                "unit": "%",
            }
            for r in sorted(pairs, key=lambda r: (r["wins"] / r["played"], r["wins"]), reverse=True)[:15]
        ],
    }
    return {
        "seasonId": season,
        "division": division,
        "divisions": divisions,
        "minMatches": min_matches,
        "playerCount": len(players),
        "lists": lists,
    }
