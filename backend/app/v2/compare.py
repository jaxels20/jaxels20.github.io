from __future__ import annotations

from typing import Any

from ..settings import Settings
from .common import (
    discipline_sort_key,
    entity,
    individual_cursor,
    match_type_label,
    pct,
    player_entities,
    player_entity,
    result_code,
    rows,
)
from .players import (
    player_by_discipline,
    player_by_match_type,
    player_matches,
    player_summary,
    player_teams,
    resolve_player,
)
from .teams import (
    TEAM_BASE,
    resolve_team,
    team_by_discipline,
    team_by_match_type,
    team_matches,
    team_summary,
)

DIRECT_TEAM_BASE = """
WITH dm AS (
  SELECT f.individual_match_key, f.match_id, s.season_id, g.league_group_id, g.group_name, dv.division_name,
         dd.full_date AS match_date, r.round_no, d.discipline_code, d.discipline_no,
         (f.home_team_key = %(a)s) AS a_home,
         (f.winner_side = CASE WHEN f.home_team_key = %(a)s THEN 'home' ELSE 'away' END) AS a_won,
         f.is_walkover
  FROM fact_individual_match f
  JOIN dim_season s ON s.season_key = f.season_key
  JOIN dim_group g ON g.group_key = f.group_key
  JOIN dim_division dv ON dv.division_key = g.division_key
  JOIN dim_date dd ON dd.date_key = f.match_date_key
  JOIN dim_round r ON r.round_key = f.round_key
  JOIN dim_discipline d ON d.discipline_key = f.discipline_key
  WHERE ((f.home_team_key = %(a)s AND f.away_team_key = %(b)s) OR (f.home_team_key = %(b)s AND f.away_team_key = %(a)s))
    AND (%(season)s::int IS NULL OR s.season_id = %(season)s::int)
)
"""


def _opponent_map(cur, team_key: int, season: int | None) -> dict[str, dict[str, Any]]:
    cur.execute(
        TEAM_BASE
        + """
        SELECT t.team_name, count(*) AS played,
               count(*) FILTER (WHERE disc_won > disc_lost) AS wins,
               sum(disc_won) AS disc_won, sum(disc_lost) AS disc_lost
        FROM tm JOIN dim_team t ON t.team_key = tm.opponent_key GROUP BY t.team_name
        """,
        {"team_key": team_key, "season": season},
    )
    return {r["team_name"]: r for r in rows(cur)}


def team_head_to_head(settings: Settings, slug_a: str, slug_b: str, season: int | None) -> dict[str, Any]:
    with individual_cursor(settings) as cur:
        a = resolve_team(cur, slug_a)
        b = resolve_team(cur, slug_b)
        pa = {"team_key": a["team_key"], "season": season}
        pb = {"team_key": b["team_key"], "season": season}

        sides = []
        for team, params in ((a, pa), (b, pb)):
            matches = team_matches(cur, params, limit=10)
            sides.append(
                {
                    "team": entity(team["team_name"]),
                    "summary": team_summary(cur, params),
                    "form": [m["result"] for m in matches[:8]],
                    "byMatchType": team_by_match_type(cur, params),
                    "byDiscipline": team_by_discipline(cur, params),
                }
            )

        direct_params = {"a": a["team_key"], "b": b["team_key"], "season": season}
        cur.execute(
            DIRECT_TEAM_BASE
            + """
            SELECT match_id, season_id, league_group_id, group_name, division_name, match_date, round_no, a_home,
                   count(*) FILTER (WHERE a_won) AS a_disc, count(*) FILTER (WHERE NOT a_won) AS b_disc
            FROM dm GROUP BY 1, 2, 3, 4, 5, 6, 7, 8 ORDER BY match_date DESC, match_id DESC
            """,
            direct_params,
        )
        direct_matches = [
            {
                "matchId": r["match_id"],
                "seasonId": r["season_id"],
                "groupId": r["league_group_id"],
                "groupName": r["group_name"],
                "division": r["division_name"],
                "date": r["match_date"],
                "round": r["round_no"],
                "aHome": r["a_home"],
                "aDisciplines": r["a_disc"],
                "bDisciplines": r["b_disc"],
                "result": result_code(r["a_disc"], r["b_disc"]),
            }
            for r in rows(cur)
        ]
        cur.execute(
            DIRECT_TEAM_BASE
            + """
            SELECT discipline_code, discipline_no, count(*) AS played, count(*) FILTER (WHERE a_won) AS a_wins
            FROM dm GROUP BY 1, 2
            """,
            direct_params,
        )
        direct_types = [
            {
                "matchType": match_type_label(r["discipline_code"], r["discipline_no"]),
                "code": r["discipline_code"],
                "number": r["discipline_no"],
                "played": r["played"],
                "aWins": r["a_wins"],
                "bWins": r["played"] - r["a_wins"],
            }
            for r in rows(cur)
        ]
        direct_types.sort(key=lambda x: (x["number"] or 0, discipline_sort_key(x["code"])))

        opp_a = _opponent_map(cur, a["team_key"], season)
        opp_b = _opponent_map(cur, b["team_key"], season)

    a_wins = sum(1 for m in direct_matches if m["result"] == "W")
    b_wins = sum(1 for m in direct_matches if m["result"] == "L")
    draws = len(direct_matches) - a_wins - b_wins
    common = []
    for name in set(opp_a) & set(opp_b):
        if name in (a["team_name"], b["team_name"]):
            continue
        ra, rb = opp_a[name], opp_b[name]
        common.append(
            {
                "team": entity(name),
                "a": {"played": ra["played"], "wins": ra["wins"], "winPct": pct(ra["wins"], ra["played"]),
                      "disciplinesWon": ra["disc_won"], "disciplinesLost": ra["disc_lost"]},
                "b": {"played": rb["played"], "wins": rb["wins"], "winPct": pct(rb["wins"], rb["played"]),
                      "disciplinesWon": rb["disc_won"], "disciplinesLost": rb["disc_lost"]},
            }
        )
    common.sort(key=lambda c: -(c["a"]["played"] + c["b"]["played"]))

    return {
        "seasonId": season,
        "a": sides[0],
        "b": sides[1],
        "direct": {
            "played": len(direct_matches),
            "aWins": a_wins,
            "bWins": b_wins,
            "draws": draws,
            "aDisciplines": sum(m["aDisciplines"] for m in direct_matches),
            "bDisciplines": sum(m["bDisciplines"] for m in direct_matches),
            "matches": direct_matches,
            "byMatchType": direct_types,
        },
        "commonOpponents": common,
    }


def player_comparison(settings: Settings, slug_a: str, slug_b: str, season: int | None) -> dict[str, Any]:
    with individual_cursor(settings) as cur:
        a = resolve_player(cur, slug_a)
        b = resolve_player(cur, slug_b)
        sides = []
        for player in (a, b):
            params = {"player_key": player["player_key"], "season": season}
            matches = player_matches(cur, params, limit=10)
            teams = player_teams(cur, params)
            sides.append(
                {
                    "player": player_entity(player["player_name"], player["player_id"]),
                    "currentTeam": teams[0]["team"] if teams else None,
                    "summary": player_summary(cur, params),
                    "form": [m["result"] for m in matches[:10]],
                    "byDiscipline": player_by_discipline(cur, params),
                    "byMatchType": player_by_match_type(cur, params),
                }
            )

        cur.execute(
            """
            SELECT f.match_id, s.season_id, g.league_group_id, g.group_name, dv.division_name, dd.full_date AS match_date,
                   d.discipline_code, d.discipline_no, ba.side_code AS a_side, (bb.side_code = ba.side_code) AS together,
                   (f.winner_side = CASE WHEN ba.side_code = 'H' THEN 'home' ELSE 'away' END) AS a_won,
                   CASE WHEN ba.side_code = 'H' THEN f.home_sets_won ELSE f.away_sets_won END AS a_sets,
                   CASE WHEN ba.side_code = 'H' THEN f.away_sets_won ELSE f.home_sets_won END AS b_sets,
                   f.is_walkover, f.set_scores_raw,
                   ht.team_name AS home_team, at.team_name AS away_team,
                   (SELECT string_agg(p.player_name, ' / ' ORDER BY x.player_slot)
                      FROM bridge_individual_match_player x JOIN dim_player p ON p.player_key = x.player_key
                     WHERE x.individual_match_key = f.individual_match_key AND x.side_code = ba.side_code
                       AND x.player_key NOT IN (%(a)s, %(b)s) AND NOT p.is_placeholder) AS a_partner,
                   (SELECT string_agg(p.player_name, ' / ' ORDER BY x.player_slot)
                      FROM bridge_individual_match_player x JOIN dim_player p ON p.player_key = x.player_key
                     WHERE x.individual_match_key = f.individual_match_key AND x.side_code = bb.side_code
                       AND x.player_key NOT IN (%(a)s, %(b)s) AND NOT p.is_placeholder) AS b_partner
            FROM fact_individual_match f
            JOIN bridge_individual_match_player ba ON ba.individual_match_key = f.individual_match_key AND ba.player_key = %(a)s
            JOIN bridge_individual_match_player bb ON bb.individual_match_key = f.individual_match_key AND bb.player_key = %(b)s
            JOIN dim_season s ON s.season_key = f.season_key
            JOIN dim_group g ON g.group_key = f.group_key
            JOIN dim_division dv ON dv.division_key = g.division_key
            JOIN dim_date dd ON dd.date_key = f.match_date_key
            JOIN dim_discipline d ON d.discipline_key = f.discipline_key
            JOIN dim_team ht ON ht.team_key = f.home_team_key
            JOIN dim_team at ON at.team_key = f.away_team_key
            WHERE (%(season)s::int IS NULL OR s.season_id = %(season)s::int)
            ORDER BY dd.full_date DESC, f.match_id DESC
            """,
            {"a": a["player_key"], "b": b["player_key"], "season": season},
        )
        meetings = []
        together = []
        for r in rows(cur):
            scores = r["set_scores_raw"] or ""
            if r["a_side"] == "A" and scores:
                scores = ", ".join(
                    "-".join(reversed(p.strip().split("-"))) if p.count("-") == 1 else p.strip()
                    for p in scores.split(",")
                )
            item = {
                "matchId": r["match_id"],
                "seasonId": r["season_id"],
                "groupId": r["league_group_id"],
                "groupName": r["group_name"],
                "division": r["division_name"],
                "date": r["match_date"],
                "matchType": match_type_label(r["discipline_code"], r["discipline_no"]),
                "code": r["discipline_code"],
                "aHome": r["a_side"] == "H",
                "homeTeam": entity(r["home_team"]),
                "awayTeam": entity(r["away_team"]),
                "aWon": r["a_won"],
                "aSets": r["a_sets"],
                "bSets": r["b_sets"],
                "walkover": r["is_walkover"],
                "setScores": scores,
                "aPartner": (player_entities(r["a_partner"]) or [None])[0],
                "bPartner": (player_entities(r["b_partner"]) or [None])[0],
            }
            (together if r["together"] else meetings).append(item)

    return {
        "seasonId": season,
        "a": sides[0],
        "b": sides[1],
        "meetings": {
            "played": len(meetings),
            "aWins": sum(1 for m in meetings if m["aWon"]),
            "bWins": sum(1 for m in meetings if not m["aWon"]),
            "matches": meetings,
        },
        "together": {
            "played": len(together),
            "wins": sum(1 for m in together if m["aWon"]),
            "matches": together,
        },
    }
