"""Data for the lineup checker (holdopstilling).

Supplies what the rules in DH-reglementet §37-38 need: the team's format, the
players who can be picked, each player's sex (inferred from the categories they
have played), the club's higher-ranked team and its latest lineup, and ranking
points from badmintonplayer.dk. The rule checks themselves run in the browser.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..settings import Settings
from .common import cached, entity, individual_cursor, one, player_entity, rows
from .ranking import SourceUnavailable, _season_snapshot, current_season
from .teams import resolve_team

# §37: Badmintonligaen and 1. division play 9 matches, everything below plays 13.
NINE_MATCH_DIVISIONS = ("Badmintonligaen", "1. division")


def team_format(division: str | None) -> dict[str, Any]:
    name = division or ""
    if name.startswith("Badmintonligaen"):
        return {"matches": 9, "minMen": 5, "minWomen": 4, "maxPerPlayer": None, "division": name}
    if name.startswith("1. division"):
        return {"matches": 9, "minMen": 4, "minWomen": 3, "maxPerPlayer": None, "division": name}
    return {"matches": 13, "minMen": 6, "minWomen": 4, "maxPerPlayer": 2, "division": name}


def club_base(team_name: str) -> tuple[str, int]:
    """'Vendsyssel 2' -> ('Vendsyssel', 2); 'Vendsyssel' -> ('Vendsyssel', 1)."""
    match = re.match(r"^(.*\S)\s+(\d+)$", team_name)
    if match:
        return match.group(1), int(match.group(2))
    return team_name, 1


SEX_SQL = """
SELECT b.player_key,
       bool_or(d.discipline_code IN ('HS', 'HD')) AS male_cat,
       bool_or(d.discipline_code IN ('DS', 'DD')) AS female_cat
FROM bridge_individual_match_player b
JOIN fact_individual_match f ON f.individual_match_key = b.individual_match_key
JOIN dim_discipline d ON d.discipline_key = f.discipline_key
WHERE b.player_key = ANY(%(keys)s)
GROUP BY b.player_key
"""


def _sex_map(cur, keys: list[int]) -> dict[int, str | None]:
    if not keys:
        return {}
    cur.execute(SEX_SQL, {"keys": keys})
    out: dict[int, str | None] = {}
    for r in rows(cur):
        if r["male_cat"] and not r["female_cat"]:
            out[r["player_key"]] = "M"
        elif r["female_cat"] and not r["male_cat"]:
            out[r["player_key"]] = "F"
        else:
            out[r["player_key"]] = None
    return out


def _team_players(cur, team_key: int, season: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT p.player_key, p.player_id, p.player_name,
               count(DISTINCT f.match_id) AS team_matches,
               count(*) AS matches,
               string_agg(DISTINCT d.discipline_code, ',') AS codes
        FROM fact_individual_match f
        JOIN dim_season s ON s.season_key = f.season_key
        JOIN bridge_individual_match_player b ON b.individual_match_key = f.individual_match_key
         AND b.side_code = CASE WHEN f.home_team_key = %(team_key)s THEN 'H' ELSE 'A' END
        JOIN dim_player p ON p.player_key = b.player_key AND NOT p.is_placeholder AND p.player_id IS NOT NULL
        JOIN dim_discipline d ON d.discipline_key = f.discipline_key
        WHERE (f.home_team_key = %(team_key)s OR f.away_team_key = %(team_key)s)
          AND s.season_id = %(season)s
        GROUP BY p.player_key, p.player_id, p.player_name
        ORDER BY team_matches DESC, p.player_name
        """,
        {"team_key": team_key, "season": season},
    )
    return rows(cur)


def _latest_lineup(cur, team_key: int) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT f.match_id, s.season_id, g.league_group_id, dd.full_date AS match_date,
               o.team_name AS opponent
        FROM fact_individual_match f
        JOIN dim_season s ON s.season_key = f.season_key
        JOIN dim_group g ON g.group_key = f.group_key
        JOIN dim_date dd ON dd.date_key = f.match_date_key
        JOIN dim_team o ON o.team_key = CASE WHEN f.home_team_key = %(team_key)s THEN f.away_team_key ELSE f.home_team_key END
        WHERE f.home_team_key = %(team_key)s OR f.away_team_key = %(team_key)s
        ORDER BY dd.full_date DESC, f.match_id DESC
        LIMIT 1
        """,
        {"team_key": team_key},
    )
    meta = one(cur)
    if not meta:
        return None
    cur.execute(
        """
        SELECT p.player_key, p.player_id, p.player_name, d.discipline_code, d.discipline_no
        FROM fact_individual_match f
        JOIN dim_season s ON s.season_key = f.season_key
        JOIN dim_group g ON g.group_key = f.group_key
        JOIN dim_discipline d ON d.discipline_key = f.discipline_key
        JOIN bridge_individual_match_player b ON b.individual_match_key = f.individual_match_key
         AND b.side_code = CASE WHEN f.home_team_key = %(team_key)s THEN 'H' ELSE 'A' END
        JOIN dim_player p ON p.player_key = b.player_key AND NOT p.is_placeholder AND p.player_id IS NOT NULL
        WHERE s.season_id = %(season)s AND g.league_group_id = %(group)s AND f.match_id = %(match_id)s
        ORDER BY d.discipline_no, d.discipline_code
        """,
        {"team_key": team_key, "season": meta["season_id"], "group": meta["league_group_id"], "match_id": meta["match_id"]},
    )
    players: dict[int, dict[str, Any]] = {}
    for r in rows(cur):
        item = players.setdefault(
            r["player_key"],
            {**player_entity(r["player_name"], r["player_id"]), "playerKey": r["player_key"], "slots": []},
        )
        item["slots"].append(f"{r['discipline_no']}. {r['discipline_code']}")
    return {
        "matchId": meta["match_id"],
        "seasonId": meta["season_id"],
        "groupId": meta["league_group_id"],
        "date": meta["match_date"],
        "opponent": entity(meta["opponent"]),
        "players": list(players.values()),
    }


def lineup_setup(settings: Settings, slug: str) -> dict[str, Any]:
    with individual_cursor(settings) as cur:
        team = resolve_team(cur, slug)
        cur.execute(
            """
            SELECT s.season_id, dv.division_name, count(DISTINCT f.match_id) AS team_matches
            FROM fact_individual_match f
            JOIN dim_season s ON s.season_key = f.season_key
            JOIN dim_group g ON g.group_key = f.group_key
            JOIN dim_division dv ON dv.division_key = g.division_key
            WHERE f.home_team_key = %(team_key)s OR f.away_team_key = %(team_key)s
            GROUP BY 1, 2 ORDER BY s.season_id DESC, team_matches DESC
            """,
            {"team_key": team["team_key"]},
        )
        history = rows(cur)
        season = history[0]["season_id"] if history else current_season()
        division = history[0]["division_name"] if history else None

        base, rank = club_base(team["team_name"])
        cur.execute(
            "SELECT team_key, team_name FROM dim_team WHERE team_name = %(base)s OR team_name ~ %(pattern)s",
            {"base": base, "pattern": rf"^{re.escape(base)} \d+$"},
        )
        siblings = [
            {**r, "rank": club_base(r["team_name"])[1]} for r in rows(cur) if r["team_key"] != team["team_key"]
        ]
        siblings.sort(key=lambda r: r["rank"])
        higher = [s for s in siblings if s["rank"] < rank]
        nearest_higher = higher[-1] if higher else None

        roster = _team_players(cur, team["team_key"], season)
        for r in roster:
            r["team"] = entity(team["team_name"])
        for sib in siblings:
            for r in _team_players(cur, sib["team_key"], season):
                if not any(x["player_key"] == r["player_key"] for x in roster):
                    roster.append({**r, "team": entity(sib["team_name"])})

        higher_lineup = _latest_lineup(cur, nearest_higher["team_key"]) if nearest_higher else None

        keys = [r["player_key"] for r in roster] + [p["playerKey"] for p in (higher_lineup or {}).get("players", [])]
        sexes = _sex_map(cur, keys)

    players = [
        {
            **player_entity(r["player_name"], r["player_id"]),
            "sex": sexes.get(r["player_key"]),
            "team": r["team"],
            "teamMatches": r["team_matches"],
            "matches": r["matches"],
            "disciplines": sorted((r["codes"] or "").split(",")),
        }
        for r in roster
    ]
    if higher_lineup:
        for p in higher_lineup["players"]:
            p["sex"] = sexes.get(p.pop("playerKey"))

    return {
        "team": entity(team["team_name"]),
        "seasonId": season,
        "format": team_format(division),
        "players": players,
        "higherTeam": (
            {"team": entity(nearest_higher["team_name"]), "lineup": higher_lineup} if nearest_higher else None
        ),
        "otherTeams": [entity(s["team_name"]) for s in siblings],
    }


def _points_one(player_id: int) -> dict[str, Any]:
    def build() -> dict[str, Any]:
        snapshot = _season_snapshot(current_season(), player_id)
        by_list = {row["list"].lower(): row for row in snapshot["lists"]}
        return {
            "id": player_id,
            "club": snapshot["club"],
            "single": by_list.get("single", {}).get("points"),
            "double": by_list.get("double", {}).get("points"),
            "mix": by_list.get("mix", {}).get("points"),
            "seasonId": snapshot["seasonId"],
        }

    return cached(f"points:{player_id}", build, ttl=86400)


def lineup_points(player_ids: list[int]) -> dict[str, Any]:
    ids = sorted({int(i) for i in player_ids})[:60]
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(_points_one, ids))
    except Exception as exc:  # noqa: BLE001 - any failure talking to the source
        raise SourceUnavailable(str(exc)) from exc
    return {"seasonId": current_season(), "points": {str(r["id"]): r for r in results}}
