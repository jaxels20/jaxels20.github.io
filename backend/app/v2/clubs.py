from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

import psycopg

from ..settings import Settings
from .common import (
    NotFound,
    discipline_sort_key,
    entity,
    individual_cursor,
    pct,
    player_entity,
    result_code,
    rows,
    slugify,
    team_cursor,
)
from .leagues import division_tier

# A club's teams share a name and differ by a trailing number: "Vendsyssel",
# "Vendsyssel 2", "Vendsyssel 3". The club page groups those together.
CLUB_BASE_SQL = r"regexp_replace(team_name, '\s+\d+$', '')"

# Fixture placeholders live in dim_team too ("Vinder af semifinale 1", "Nr. 2 fra kvalifikation").
# Real clubs such as "Nr. Åby" keep letters after the "Nr.".
PLACEHOLDER_SQL = (
    r"(team_name ~ '^\d+ fra ' OR team_name ~ '^Nr\. \d' OR team_name ~* '^(vinder|taber) af' OR team_name = 'Oversidder')"
)

GROUP_KEYS = ("division", "groupName", "groupId", "position", "groupSize", "played", "wins", "draws", "losses", "points")


def club_base(team_name: str) -> tuple[str, int]:
    match = re.match(r"^(.*\S)\s+(\d+)$", team_name)
    if match:
        return match.group(1), int(match.group(2))
    return team_name, 1


def club_entity(name: str) -> dict[str, Any]:
    return {"name": name, "slug": slugify(name)}


def resolve_club(cur: psycopg.Cursor[Any], slug: str) -> str:
    """The club's base name for a slug, from the teams in the warehouse."""
    cur.execute(f"SELECT DISTINCT {CLUB_BASE_SQL} AS base FROM dim_team")
    for r in rows(cur):
        if slugify(r["base"]) == slug:
            return r["base"]
    raise NotFound(f"Klubben '{slug}' blev ikke fundet")


def _team_filter() -> str:
    return "(t.team_name = %(base)s OR t.team_name ~ %(pattern)s)"


def _club_params(base: str) -> dict[str, Any]:
    return {"base": base, "pattern": rf"^{re.escape(base)}\s+\d+$"}


# --- team warehouse: which teams, which divisions, how they stand ------------------

STANDINGS_SQL = f"""
WITH club_teams AS (
  SELECT t.team_key, t.team_name FROM dim_team t WHERE {_team_filter()}
), member AS (
  SELECT DISTINCT f.season_key, f.group_key, ct.team_key
  FROM fact_team_match f
  JOIN club_teams ct ON ct.team_key IN (f.home_team_key, f.away_team_key)
), played AS (
  SELECT f.*
  FROM fact_team_match f
  WHERE f.home_team_points IS NOT NULL
    AND (f.season_key, f.group_key) IN (SELECT season_key, group_key FROM member)
), sides AS (
  SELECT season_key, group_key, home_team_key AS team_key, home_disciplines_won AS df, away_disciplines_won AS da,
         home_team_points AS pts, away_team_points AS opts, home_win AS won, is_draw AS draw
  FROM played
  UNION ALL
  SELECT season_key, group_key, away_team_key, away_disciplines_won, home_disciplines_won,
         away_team_points, home_team_points, away_win, is_draw
  FROM played
), tbl AS (
  SELECT season_key, group_key, team_key, count(*) AS played,
         count(*) FILTER (WHERE won) AS wins,
         count(*) FILTER (WHERE draw) AS draws,
         count(*) FILTER (WHERE NOT won AND NOT draw) AS losses,
         coalesce(sum(df), 0) AS disc_for, coalesce(sum(da), 0) AS disc_against,
         coalesce(sum(pts), 0) AS points
  FROM sides GROUP BY 1, 2, 3
), ranked AS (
  SELECT tbl.*, 
         row_number() OVER (PARTITION BY season_key, group_key
                            ORDER BY points DESC, (disc_for - disc_against) DESC, wins DESC, t.team_name) AS pos,
         count(*) OVER (PARTITION BY season_key, group_key) AS group_size
  FROM tbl JOIN dim_team t ON t.team_key = tbl.team_key
)
SELECT s.season_id, g.league_group_id, g.group_name, dv.division_name, ct.team_name,
       r.played, r.wins, r.draws, r.losses, r.disc_for, r.disc_against, r.points, r.pos, r.group_size,
       (SELECT count(DISTINCT x.team_key) FROM (
          SELECT home_team_key AS team_key FROM fact_team_match f2 WHERE f2.season_key = m.season_key AND f2.group_key = m.group_key
          UNION SELECT away_team_key FROM fact_team_match f2 WHERE f2.season_key = m.season_key AND f2.group_key = m.group_key
        ) x) AS teams_in_group
FROM member m
JOIN club_teams ct ON ct.team_key = m.team_key
JOIN dim_season s ON s.season_key = m.season_key
JOIN dim_group g ON g.group_key = m.group_key
JOIN dim_division dv ON dv.division_key = g.division_key
LEFT JOIN ranked r ON r.season_key = m.season_key AND r.group_key = m.group_key AND r.team_key = m.team_key
ORDER BY s.season_id DESC, ct.team_name
"""

MATCHES_SQL = f"""
SELECT s.season_id, g.league_group_id, g.group_name, dv.division_name, f.match_id,
       dd.full_date AS match_date, r.round_no,
       ht.team_name AS home_name, at.team_name AS away_name,
       f.home_disciplines_won, f.away_disciplines_won, f.home_team_points IS NOT NULL AS played
FROM fact_team_match f
JOIN dim_season s ON s.season_key = f.season_key
JOIN dim_group g ON g.group_key = f.group_key
JOIN dim_division dv ON dv.division_key = g.division_key
JOIN dim_team ht ON ht.team_key = f.home_team_key
JOIN dim_team at ON at.team_key = f.away_team_key
LEFT JOIN dim_round r ON r.round_key = f.round_key
LEFT JOIN dim_date dd ON dd.date_key = f.match_date_key
WHERE s.season_id = %(season)s
  AND (EXISTS (SELECT 1 FROM dim_team t WHERE t.team_key = f.home_team_key AND {_team_filter()})
       OR EXISTS (SELECT 1 FROM dim_team t WHERE t.team_key = f.away_team_key AND {_team_filter()}))
ORDER BY dd.full_date DESC NULLS LAST, f.match_id DESC
"""


def _standings(cur: psycopg.Cursor[Any], base: str) -> list[dict[str, Any]]:
    cur.execute(STANDINGS_SQL, _club_params(base))
    out = []
    for r in rows(cur):
        _, rank = club_base(r["team_name"])
        out.append(
            {
                "team": entity(r["team_name"]),
                "rank": rank,
                "seasonId": r["season_id"],
                "division": r["division_name"],
                "tier": division_tier(r["division_name"]),
                "groupName": r["group_name"],
                "groupId": r["league_group_id"],
                "position": r["pos"],
                "groupSize": r["teams_in_group"] or r["group_size"],
                "played": r["played"] or 0,
                "wins": r["wins"] or 0,
                "draws": r["draws"] or 0,
                "losses": r["losses"] or 0,
                "disciplinesFor": r["disc_for"] or 0,
                "disciplinesAgainst": r["disc_against"] or 0,
                "points": r["points"] or 0,
            }
        )
    return out


def _merge_groups(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per team: the group it played most in, with playoffs and the like under `alsoIn`."""
    by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in entries:
        by_team[row["team"]["slug"]].append(row)
    out = []
    for group in by_team.values():
        group.sort(key=lambda e: (-e["played"], e["tier"], e["groupId"]))
        primary = dict(group[0])
        primary["alsoIn"] = [{k: e[k] for k in GROUP_KEYS} for e in group[1:]]
        out.append(primary)
    return sorted(out, key=lambda r: (r["tier"], r["rank"], r["team"]["name"]))


def _matches(cur: psycopg.Cursor[Any], base: str, season: int) -> list[dict[str, Any]]:
    cur.execute(MATCHES_SQL, {**_club_params(base), "season": season})
    out = []
    for r in rows(cur):
        home_base, _ = club_base(r["home_name"])
        ours_home = home_base == base
        own = r["home_name"] if ours_home else r["away_name"]
        opponent = r["away_name"] if ours_home else r["home_name"]
        won = r["home_disciplines_won"] if ours_home else r["away_disciplines_won"]
        lost = r["away_disciplines_won"] if ours_home else r["home_disciplines_won"]
        out.append(
            {
                "matchId": r["match_id"],
                "seasonId": r["season_id"],
                "groupId": r["league_group_id"],
                "groupName": r["group_name"],
                "division": r["division_name"],
                "date": r["match_date"],
                "round": r["round_no"],
                "team": entity(own),
                "opponent": entity(opponent),
                "home": ours_home,
                "played": bool(r["played"]),
                "result": result_code(won, lost) if r["played"] else None,
                "disciplinesWon": won if r["played"] else None,
                "disciplinesLost": lost if r["played"] else None,
            }
        )
    return out


# --- individual warehouse: who played -----------------------------------------------

PLAYERS_SQL = f"""
WITH club_teams AS (
  SELECT t.team_key, t.team_name FROM dim_team t WHERE {_team_filter()}
), m AS (
  SELECT f.individual_match_key, f.match_id, s.season_id, f.is_walkover, d.discipline_code,
         ct.team_name,
         CASE WHEN f.home_team_key = ct.team_key THEN 'H' ELSE 'A' END AS side,
         (f.winner_side = CASE WHEN f.home_team_key = ct.team_key THEN 'home' ELSE 'away' END) AS won
  FROM fact_individual_match f
  JOIN club_teams ct ON ct.team_key IN (f.home_team_key, f.away_team_key)
  JOIN dim_season s ON s.season_key = f.season_key
  JOIN dim_discipline d ON d.discipline_key = f.discipline_key
  WHERE (%(season)s::int IS NULL OR s.season_id = %(season)s::int)
)
SELECT p.player_name, p.player_id,
       count(DISTINCT m.match_id) AS team_matches,
       count(*) AS matches,
       count(*) FILTER (WHERE m.won) AS wins,
       count(DISTINCT m.season_id) AS seasons,
       max(m.season_id) AS last_season,
       string_agg(DISTINCT m.discipline_code, ',') AS codes,
       (SELECT json_agg(json_build_object('name', x.team_name, 'n', x.n) ORDER BY x.n DESC)
          FROM (SELECT m2.team_name, count(DISTINCT m2.match_id) AS n
                  FROM m m2 JOIN bridge_individual_match_player b2
                    ON b2.individual_match_key = m2.individual_match_key AND b2.side_code = m2.side
                 WHERE b2.player_key = p.player_key GROUP BY m2.team_name) x) AS teams
FROM m
JOIN bridge_individual_match_player b ON b.individual_match_key = m.individual_match_key AND b.side_code = m.side
JOIN dim_player p ON p.player_key = b.player_key AND NOT p.is_placeholder
GROUP BY p.player_key, p.player_name, p.player_id
ORDER BY team_matches DESC, matches DESC, wins DESC, p.player_name
LIMIT %(limit)s
"""

SEASONS_SQL = f"""
SELECT s.season_id, count(DISTINCT t.team_name) AS teams, count(DISTINCT f.match_id) AS team_matches
FROM fact_individual_match f
JOIN dim_team t ON t.team_key IN (f.home_team_key, f.away_team_key)
JOIN dim_season s ON s.season_key = f.season_key
WHERE {_team_filter()}
GROUP BY s.season_id ORDER BY s.season_id DESC
"""


def _players(cur: psycopg.Cursor[Any], base: str, season: int | None, limit: int) -> list[dict[str, Any]]:
    cur.execute(PLAYERS_SQL, {**_club_params(base), "season": season, "limit": limit})
    out = []
    for r in rows(cur):
        codes = sorted((r["codes"] or "").split(","), key=discipline_sort_key)
        out.append(
            {
                "player": player_entity(r["player_name"], r["player_id"]),
                "teamMatches": r["team_matches"],
                "matches": r["matches"],
                "wins": r["wins"],
                "losses": r["matches"] - r["wins"],
                "winPct": pct(r["wins"], r["matches"]),
                "seasons": r["seasons"],
                "lastSeason": r["last_season"],
                "disciplines": [c for c in codes if c],
                "teams": [{"team": entity(x["name"]), "teamMatches": x["n"]} for x in (r["teams"] or [])],
            }
        )
    return out


def club_profile(settings: Settings, slug: str, season: int | None) -> dict[str, Any]:
    with team_cursor(settings) as cur:
        base = resolve_club(cur, slug)
        standings = _standings(cur, base)
        seasons_played = sorted({row["seasonId"] for row in standings}, reverse=True)
        if season is None or season not in seasons_played:
            season = seasons_played[0] if seasons_played else season
        teams = _merge_groups([row for row in standings if row["seasonId"] == season])
        matches = _matches(cur, base, season) if season else []

    # Form and the latest result per team, from this season's team matches (newest first).
    form: dict[str, list[str]] = defaultdict(list)
    latest: dict[str, dict[str, Any]] = {}
    for m in matches:
        if not m["played"]:
            continue
        slug_ = m["team"]["slug"]
        if len(form[slug_]) < 5:
            form[slug_].append(m["result"])
        latest.setdefault(slug_, m)
    for t in teams:
        t["form"] = list(reversed(form.get(t["team"]["slug"], [])))
        t["latest"] = latest.get(t["team"]["slug"])

    played = [m for m in matches if m["played"]]
    wins = sum(1 for m in played if m["result"] == "W")
    draws = sum(1 for m in played if m["result"] == "D")
    losses = sum(1 for m in played if m["result"] == "L")

    with individual_cursor(settings) as cur:
        cur.execute(SEASONS_SQL, _club_params(base))
        seasons = [{"seasonId": r["season_id"], "teams": r["teams"], "teamMatches": r["team_matches"]} for r in rows(cur)]
        players = _players(cur, base, season, 300) if season else []
        all_time = _players(cur, base, None, 25)

    # The seasons list drives the picker; standings may know a season the individual
    # warehouse does not (unplayed fixtures only), so merge the two.
    known = {s["seasonId"] for s in seasons}
    for sid in seasons_played:
        if sid not in known:
            seasons.append({"seasonId": sid, "teams": sum(1 for row in standings if row["seasonId"] == sid), "teamMatches": 0})
    seasons.sort(key=lambda s: -s["seasonId"])

    # Which divisions the club's teams played in, season by season, for the history table.
    history: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in standings:
        history[row["seasonId"]].append(row)
    history_rows = [{"seasonId": sid, "teams": _merge_groups(entries)} for sid, entries in sorted(history.items(), key=lambda kv: -kv[0])]

    return {
        "club": club_entity(base),
        "seasonId": season,
        "seasons": seasons,
        "summary": {
            "teams": len(teams),
            "teamMatches": len(played),
            "teamWins": wins,
            "teamDraws": draws,
            "teamLosses": losses,
            "teamWinPct": pct(wins, len(played)),
            "players": len(players),
            "multiTeamPlayers": sum(1 for p in players if len(p["teams"]) > 1),
        },
        "teams": teams,
        "players": players[:60],
        "allTimePlayers": all_time,
        "matches": [m for m in matches if m["played"]][:40],
        "history": history_rows,
    }


def search_clubs(cur: psycopg.Cursor[Any], query: str, limit: int) -> list[dict[str, Any]]:
    """Clubs whose name matches, with how many teams they have fielded and when."""
    cur.execute(
        f"""
        WITH teams AS (
          SELECT {CLUB_BASE_SQL} AS base, t.team_name, max(s.season_id) AS last_season
          FROM dim_team t
          JOIN fact_individual_match f ON t.team_key IN (f.home_team_key, f.away_team_key)
          JOIN dim_season s ON s.season_key = f.season_key
          GROUP BY 1, 2
        )
        SELECT base, count(*) AS teams, max(last_season) AS last_season,
               count(*) FILTER (WHERE last_season = (SELECT max(last_season) FROM teams x WHERE x.base = teams.base)) AS current_teams
        FROM teams
        WHERE base ILIKE %(pattern)s AND NOT {PLACEHOLDER_SQL}
        GROUP BY base
        HAVING count(*) > 1
        ORDER BY position(lower(%(q)s) IN lower(base)), teams DESC, base
        LIMIT %(limit)s
        """,
        {"pattern": f"%{query}%", "q": query, "limit": limit},
    )
    return [{**club_entity(r["base"]), "teams": r["current_teams"], "lastSeason": r["last_season"]} for r in rows(cur)]


CLUB_INDEX_SQL = f"""
WITH tm AS (
  SELECT dv.division_name, ht.team_name AS home_name, at.team_name AS away_name,
         f.home_win, f.away_win, f.is_draw, f.home_team_points IS NOT NULL AS played
  FROM fact_team_match f
  JOIN dim_season s ON s.season_key = f.season_key
  JOIN dim_group g ON g.group_key = f.group_key
  JOIN dim_division dv ON dv.division_key = g.division_key
  JOIN dim_team ht ON ht.team_key = f.home_team_key
  JOIN dim_team at ON at.team_key = f.away_team_key
  WHERE s.season_id = %(season)s
), sides AS (
  SELECT home_name AS team_name, division_name, played, home_win AS won, is_draw AS draw FROM tm
  UNION ALL
  SELECT away_name, division_name, played, away_win, is_draw FROM tm
)
SELECT {CLUB_BASE_SQL} AS base,
       count(DISTINCT team_name) AS teams,
       count(*) FILTER (WHERE played) AS played,
       count(*) FILTER (WHERE played AND won) AS wins,
       count(*) FILTER (WHERE played AND draw) AS draws,
       array_agg(DISTINCT division_name) AS divisions
FROM sides
WHERE NOT {PLACEHOLDER_SQL}
GROUP BY 1
ORDER BY 1
"""


def list_clubs(settings: Settings, season: int) -> dict[str, Any]:
    """Every club with a team in the season: how many teams, their best division, and the record."""
    with team_cursor(settings) as cur:
        cur.execute(CLUB_INDEX_SQL, {"season": season})
        clubs = []
        for r in rows(cur):
            divisions = sorted(r["divisions"] or [], key=division_tier)
            top = divisions[0] if divisions else None
            losses = r["played"] - r["wins"] - r["draws"]
            clubs.append(
                {
                    "club": club_entity(r["base"]),
                    "teams": r["teams"],
                    "topDivision": top,
                    "tier": division_tier(top) if top else 99,
                    "played": r["played"],
                    "wins": r["wins"],
                    "draws": r["draws"],
                    "losses": losses,
                    "winPct": pct(r["wins"], r["played"]),
                }
            )
    clubs.sort(key=lambda c: (c["tier"], -c["teams"], c["club"]["name"]))
    return {"seasonId": season, "clubs": clubs}
