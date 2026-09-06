"""Lineup optimiser: the legal lineup with the highest expected number of won matches
against a specific opponent.

Strength comes from an Elo-style rating per player and discipline (single, double,
mix), computed in date order over every league match in the warehouse. Doubles pairs
count as the mean of the two ratings. The opponent is assumed to field its most recent
lineup. The search enumerates every legal split of the available players into
categories, orders each category by ranking points as §38 requires, and maximises the
sum of win probabilities. The top three lineups are returned with the reasoning.
"""

from __future__ import annotations

import math
from itertools import combinations
from typing import Any

from ..settings import Settings
from .common import NotFound, cached, entity, individual_cursor, player_entity, rows
from .leagues import division_tier
from .lineup import _latest_lineup, _sex_map, club_base, lineup_points, team_format
from .teams import resolve_team

RATING_KEY = {"HS": "single", "DS": "single", "S": "single", "HD": "double", "DD": "double", "D": "double", "MD": "mix"}
PRIOR_BY_TIER = {1: 1800, 2: 1700, 3: 1600, 4: 1500, 5: 1400}
DEFAULT_PRIOR = 1450
MAX_PER_PLAYER = 2


def expected(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


# --- ratings ----------------------------------------------------------------


def compute_ratings(settings: Settings) -> dict[int, dict[str, dict[str, float | int]]]:
    """player_id -> {'single': {'rating', 'matches'}, 'double': ..., 'mix': ...}"""

    def build() -> dict[int, dict[str, dict[str, float | int]]]:
        with individual_cursor(settings) as cur:
            cur.execute(
                """
                SELECT dd.full_date, f.match_id, d.discipline_code, d.discipline_no, f.winner_side, dv.division_name,
                       (SELECT array_agg(p.player_id ORDER BY b.player_slot)
                          FROM bridge_individual_match_player b JOIN dim_player p ON p.player_key = b.player_key
                         WHERE b.individual_match_key = f.individual_match_key AND b.side_code = 'H'
                           AND p.player_id IS NOT NULL) AS home,
                       (SELECT array_agg(p.player_id ORDER BY b.player_slot)
                          FROM bridge_individual_match_player b JOIN dim_player p ON p.player_key = b.player_key
                         WHERE b.individual_match_key = f.individual_match_key AND b.side_code = 'A'
                           AND p.player_id IS NOT NULL) AS away
                FROM fact_individual_match f
                JOIN dim_date dd ON dd.date_key = f.match_date_key
                JOIN dim_discipline d ON d.discipline_key = f.discipline_key
                JOIN dim_group g ON g.group_key = f.group_key
                JOIN dim_division dv ON dv.division_key = g.division_key
                WHERE NOT f.is_walkover
                ORDER BY dd.full_date, f.match_id, d.discipline_no
                """
            )
            matches = rows(cur)

        ratings: dict[int, dict[str, dict[str, float | int]]] = {}

        def get(pid: int, key: str, prior: float) -> dict[str, float | int]:
            entry = ratings.setdefault(pid, {})
            if key not in entry:
                entry[key] = {"rating": prior, "matches": 0}
            return entry[key]

        for m in matches:
            key = RATING_KEY.get(m["discipline_code"])
            home, away = m["home"] or [], m["away"] or []
            if not key or not home or not away:
                continue
            prior = PRIOR_BY_TIER.get(division_tier(m["division_name"] or ""), DEFAULT_PRIOR)
            h = [get(pid, key, prior) for pid in home]
            a = [get(pid, key, prior) for pid in away]
            rh = sum(x["rating"] for x in h) / len(h)
            ra = sum(x["rating"] for x in a) / len(a)
            e_home = expected(rh, ra)
            s_home = 1.0 if m["winner_side"] == "home" else 0.0
            for side, score, exp_ in ((h, s_home, e_home), (a, 1.0 - s_home, 1.0 - e_home)):
                for x in side:
                    n = int(x["matches"])
                    k = (40 if n < 10 else 24) if key == "single" else (24 if n < 10 else 14)
                    x["rating"] = float(x["rating"]) + k * (score - exp_)
                    x["matches"] = n + 1
        return ratings

    return cached("elo-ratings", build, ttl=6 * 3600)


# --- helpers ----------------------------------------------------------------


def _rating(ratings: dict, pid: int, key: str) -> tuple[float, int]:
    entry = ratings.get(pid, {}).get(key)
    if not entry:
        return DEFAULT_PRIOR, 0
    return float(entry["rating"]), int(entry["matches"])


def _order(units: list[dict[str, Any]], opp_strength: list[float], tolerance: int) -> tuple[float, list[dict[str, Any]]]:
    """Order units (players or pairs) by points as §38 demands, using the permitted
    swaps to face the opponent's slots as favourably as possible. Returns
    (expected wins, ordered units)."""
    ordered = sorted(units, key=lambda u: -u["points"])

    def total(seq: list[dict[str, Any]]) -> float:
        return sum(expected(u["rating"], opp_strength[i]) for i, u in enumerate(seq))

    best = total(ordered)
    improved = True
    while improved:
        improved = False
        for i in range(len(ordered) - 1):
            if abs(ordered[i]["points"] - ordered[i + 1]["points"]) <= tolerance:
                swapped = ordered[:]
                swapped[i], swapped[i + 1] = swapped[i + 1], swapped[i]
                value = total(swapped)
                if value > best + 1e-9:
                    ordered, best, improved = swapped, value, True
    return best, ordered


def _pairings(members: tuple[int, ...]) -> list[list[tuple[int, int]]]:
    """All ways to split an even-sized tuple into unordered pairs."""
    if not members:
        return [[]]
    first, rest = members[0], members[1:]
    out = []
    for i, other in enumerate(rest):
        remaining = rest[:i] + rest[i + 1 :]
        for tail in _pairings(remaining):
            out.append([(first, other)] + tail)
    return out


# --- the search ----------------------------------------------------------------


def optimise(
    settings: Settings,
    team_slug: str,
    opponent_slug: str,
    available: list[int],
    matches: int,
    sex_override: dict[int, str] | None = None,
) -> dict[str, Any]:
    sex_override = sex_override or {}
    with individual_cursor(settings) as cur:
        team = resolve_team(cur, team_slug)
        opponent = resolve_team(cur, opponent_slug)
        if team["team_key"] == opponent["team_key"]:
            raise NotFound("Vælg et andet hold som modstander")

        cur.execute(
            """
            SELECT dv.division_name FROM fact_individual_match f
            JOIN dim_season s ON s.season_key = f.season_key
            JOIN dim_group g ON g.group_key = f.group_key JOIN dim_division dv ON dv.division_key = g.division_key
            WHERE f.home_team_key = %(k)s OR f.away_team_key = %(k)s
            ORDER BY s.season_id DESC LIMIT 1
            """,
            {"k": team["team_key"]},
        )
        row = cur.fetchone()
        fmt = team_format(row["division_name"] if row else None)
        if matches in (9, 13) and matches != fmt["matches"]:
            fmt = {"matches": 9, "minMen": 4, "minWomen": 3, "maxPerPlayer": None, "division": "1. division"} if matches == 9 else {
                "matches": 13, "minMen": 6, "minWomen": 4, "maxPerPlayer": 2, "division": "2. division"}

        cur.execute(
            "SELECT player_key, player_id, player_name FROM dim_player WHERE player_id = ANY(%(ids)s)",
            {"ids": [int(i) for i in available]},
        )
        players = rows(cur)
        sexes = _sex_map(cur, [p["player_key"] for p in players])

        opp_lineup = _latest_lineup(cur, opponent["team_key"])
        opp_keys = [p["playerKey"] for p in (opp_lineup or {}).get("players", [])]
        opp_sex = _sex_map(cur, opp_keys)

        # Club's higher team, for §38 stk. 4 exclusion of seniors.
        base, rank = club_base(team["team_name"])
        cur.execute("SELECT team_key, team_name FROM dim_team WHERE team_name = %(b)s OR team_name ~ %(p)s",
                    {"b": base, "p": rf"^{base} \d+$"})
        higher = [r for r in rows(cur) if club_base(r["team_name"])[1] < rank]
        higher.sort(key=lambda r: club_base(r["team_name"])[1])
        higher_lineup = _latest_lineup(cur, higher[-1]["team_key"]) if higher else None
        higher_sex = _sex_map(cur, [p["playerKey"] for p in (higher_lineup or {}).get("players", [])])

    ratings = compute_ratings(settings)
    point_ids = [p["player_id"] for p in players] + [p["id"] for p in (opp_lineup or {}).get("players", [])] + [
        p["id"] for p in (higher_lineup or {}).get("players", [])
    ]
    points = lineup_points(point_ids)["points"]

    def pts(pid: int, key: str) -> int:
        return int((points.get(str(pid)) or {}).get(key) or 0)

    def youth(pid: int) -> bool:
        return bool((points.get(str(pid)) or {}).get("youth"))

    # Exclude seniors who would be illegal below the higher team (§38 stk. 4).
    excluded: list[dict[str, Any]] = []
    cats_of = {"HS": "single", "DS": "single", "HD": "double", "DD": "double", "MD": "mix"}
    higher_players = []
    for hp in (higher_lineup or {}).get("players", []):
        cats = sorted({cats_of[s.split(". ")[1]] for s in hp["slots"] if s.split(". ")[1] in cats_of})
        higher_players.append({"id": hp["id"], "name": hp["name"], "sex": higher_sex.get(hp.pop("playerKey", None)),
                               "cats": cats, "youth": youth(hp["id"])})

    men: list[dict[str, Any]] = []
    women: list[dict[str, Any]] = []
    for p in players:
        pid = p["player_id"]
        sex = sex_override.get(pid) or sexes.get(p["player_key"])
        if sex not in ("M", "F"):
            excluded.append({"player": player_entity(p["player_name"], pid), "reason": "Køn kendes ikke; vælg det i spillerlisten."})
            continue
        if not youth(pid):
            blocker = None
            for hp in higher_players:
                # §38 stk. 5: a comparison involving a U17/U19 player on either side is an
                # assessment of strength, not a points test, so it cannot exclude anyone here.
                if hp["sex"] != sex or not hp["cats"] or hp["youth"]:
                    continue
                if not any(pts(pid, c) <= pts(hp["id"], c) + 50 for c in hp["cats"]):
                    blocker = hp
                    break
            if blocker:
                excluded.append({
                    "player": player_entity(p["player_name"], pid),
                    "reason": f"Ikke lovlig under {higher[-1]['team_name']}: over 50 point over {blocker['name']} i alle de kategorier {blocker['name']} spiller (§ 38 stk. 4).",
                })
                continue
        item = {
            "id": pid,
            "name": p["player_name"],
            "sex": sex,
            "youth": youth(pid),
            "points": {k: pts(pid, k) for k in ("single", "double", "mix")},
            "ratings": {k: _rating(ratings, pid, k) for k in ("single", "double", "mix")},
        }
        (men if sex == "M" else women).append(item)

    counts = {"MD": 2, "DS": 2, "HS": 2, "DD": 1, "HD": 2} if fmt["matches"] == 9 else {"MD": 2, "DS": 2, "HS": 4, "DD": 2, "HD": 3}
    need_men = counts["HS"] + counts["MD"] + 2 * counts["HD"]
    need_women = counts["DS"] + counts["MD"] + 2 * counts["DD"]
    notes: list[str] = []

    def too_few(label: str, needed: int, have: int, sex: str) -> NotFound:
        dropped = [e for e in excluded if e["player"]["id"] and (sex_override.get(e["player"]["id"]) or sexes.get(
            next((p["player_key"] for p in players if p["player_id"] == e["player"]["id"]), None))) == sex]
        message = f"Der skal være mindst {needed} {label} til rådighed; der er {have}."
        if dropped:
            message += " Udeladt: " + "; ".join(f"{e['player']['name']} ({e['reason']})" for e in dropped)
        else:
            message += " Marker flere spillere som til rådighed i spillerlisten."
        return NotFound(message)

    if len(men) * MAX_PER_PLAYER < need_men or len(men) < 2 * counts["HD"]:
        raise too_few("herrer", max(2 * counts["HD"], math.ceil(need_men / MAX_PER_PLAYER)), len(men), "M")
    if len(women) * MAX_PER_PLAYER < need_women or len(women) < 2 * counts["DD"]:
        raise too_few("damer", max(2 * counts["DD"], math.ceil(need_women / MAX_PER_PLAYER)), len(women), "F")

    # Opponent strength per slot from their latest lineup; unknown slots use their mean.
    opp_by_slot: dict[str, list[dict[str, Any]]] = {}
    for op in (opp_lineup or {}).get("players", []):
        for s in op["slots"]:
            number, _, code = s.partition(". ")  # "1. HD" -> key "HD1", matching our slot keys
            opp_by_slot.setdefault(f"{code}{number}", []).append(op)
    all_opp = [op for ops in opp_by_slot.values() for op in ops]

    def opp_strength(slot: str, key: str) -> tuple[float, list[dict[str, Any]]]:
        ops = opp_by_slot.get(slot, [])
        if ops:
            return sum(_rating(ratings, op["id"], key)[0] for op in ops) / len(ops), ops
        pool = [_rating(ratings, op["id"], key)[0] for op in all_opp] or [DEFAULT_PRIOR]
        return sum(pool) / len(pool), []

    def strengths(category: str, n: int) -> list[float]:
        return [opp_strength(f"{category}{i}", RATING_KEY[category])[0] for i in range(1, n + 1)]

    opp_hs, opp_ds = strengths("HS", counts["HS"]), strengths("DS", counts["DS"])
    opp_hd, opp_dd, opp_md = strengths("HD", counts["HD"]), strengths("DD", counts["DD"]), strengths("MD", counts["MD"])

    by_id = {p["id"]: p for p in men + women}

    def unit_single(pid: int) -> dict[str, Any]:
        p = by_id[pid]
        return {"ids": [pid], "points": p["points"]["single"], "rating": p["ratings"]["single"][0]}

    def unit_pair(a: int, b: int, key: str) -> dict[str, Any]:
        pa, pb = by_id[a], by_id[b]
        return {"ids": [a, b], "points": pa["points"][key] + pb["points"][key],
                "rating": (pa["ratings"][key][0] + pb["ratings"][key][0]) / 2}

    # Precompute singles sets and doubles pairings per sex, each with its ordered value.
    def singles_options(pool: list[int], n: int, opp: list[float]) -> list[tuple[float, tuple[int, ...], list]]:
        out = []
        for combo in combinations(pool, n):
            value, ordered = _order([unit_single(pid) for pid in combo], opp, 50)
            out.append((value, combo, ordered))
        out.sort(key=lambda x: -x[0])
        return out

    def doubles_options(pool: list[int], n_pairs: int, key: str, opp: list[float]) -> list[tuple[float, tuple[int, ...], list]]:
        out = []
        for subset in combinations(pool, 2 * n_pairs):
            for pairing in _pairings(subset):
                value, ordered = _order([unit_pair(a, b, key) for a, b in pairing], opp, 100)
                out.append((value, subset, ordered))
        out.sort(key=lambda x: -x[0])
        return out

    men_ids = [p["id"] for p in men]
    women_ids = [p["id"] for p in women]
    hs_opts = singles_options(men_ids, counts["HS"], opp_hs)
    ds_opts = singles_options(women_ids, counts["DS"], opp_ds)
    hd_opts = doubles_options(men_ids, counts["HD"], "double", opp_hd)
    dd_opts = doubles_options(women_ids, counts["DD"], "double", opp_dd)

    def best_rest(md_set: tuple[int, ...], pool: list[int], d_opts, s_opts, min_distinct: int):
        """Best doubles + singles given the players already used in mixed (cap 2 each)."""
        best = None
        for d_value, d_subset, d_ordered in d_opts:
            cap = {pid: MAX_PER_PLAYER for pid in pool}
            for pid in md_set:
                cap[pid] -= 1
            if any(cap[pid] < 1 for pid in d_subset):
                continue
            for pid in d_subset:
                cap[pid] -= 1
            for s_value, s_combo, s_ordered in s_opts:
                if any(cap[pid] < 1 for pid in s_combo):
                    continue
                distinct = set(md_set) | set(d_subset) | set(s_combo)
                if len(distinct) < min_distinct:
                    continue
                total = d_value + s_value
                if best is None or total > best[0]:
                    best = (total, d_ordered, s_ordered)
                break  # s_opts is sorted, so the first fit is the best for this pairing
            if best is not None and d_value + (s_opts[0][0] if s_opts else 0) <= best[0]:
                break  # d_opts is sorted too: nothing later can beat the incumbent
        return best

    candidates: list[dict[str, Any]] = []
    for md_men in combinations(men_ids, counts["MD"]):
        rest_men = best_rest(md_men, men_ids, hd_opts, hs_opts, fmt["minMen"])
        if rest_men is None:
            continue
        for md_women in combinations(women_ids, counts["MD"]):
            rest_women = best_rest(md_women, women_ids, dd_opts, ds_opts, fmt["minWomen"])
            if rest_women is None:
                continue
            best_md = None
            for perm in ([(md_men[0], md_women[0]), (md_men[1], md_women[1])], [(md_men[0], md_women[1]), (md_men[1], md_women[0])]):
                value, ordered = _order([unit_pair(m, w, "mix") for m, w in perm], opp_md, 100)
                if best_md is None or value > best_md[0]:
                    best_md = (value, ordered)
            total = rest_men[0] + rest_women[0] + best_md[0]
            candidates.append({"total": total, "MD": best_md[1], "HD": rest_men[1], "HS": rest_men[2], "DD": rest_women[1], "DS": rest_women[2]})

    if not candidates:
        raise NotFound("Ingen lovlig opstilling kan dannes med de valgte spillere.")
    candidates.sort(key=lambda c: -c["total"])

    def describe(cand: dict[str, Any]) -> dict[str, Any]:
        slots = {}
        details = []
        for category in ("MD", "DS", "HS", "DD", "HD"):
            key = RATING_KEY[category]
            for i, unit in enumerate(cand[category], start=1):
                slot = f"{category}{i}"
                strength, ops = opp_strength(slot, key)
                p_win = expected(unit["rating"], strength)
                slots[slot] = unit["ids"]
                details.append({
                    "slot": f"{i}. {category}",
                    "ours": [{**player_entity(by_id[pid]["name"], pid), "rating": round(by_id[pid]["ratings"][key][0]),
                              "matches": by_id[pid]["ratings"][key][1], "youth": by_id[pid]["youth"]} for pid in unit["ids"]],
                    "ourRating": round(unit["rating"]),
                    "ourPoints": unit["points"],
                    "theirs": [{**player_entity(op["name"], op["id"]), "rating": round(_rating(ratings, op["id"], key)[0]),
                                "matches": _rating(ratings, op["id"], key)[1]} for op in ops],
                    "theirRating": round(strength),
                    "pWin": round(p_win, 3),
                })
        return {"expectedWins": round(cand["total"], 2), "slots": slots, "details": details}

    top = []
    seen = set()
    for cand in candidates:
        signature = tuple(sorted((k, tuple(sorted(u["ids"]))) for k in ("MD", "DS", "HS", "DD", "HD") for u in cand[k]))
        if signature in seen:
            continue
        seen.add(signature)
        top.append(describe(cand))
        if len(top) == 3:
            break

    if not opp_lineup:
        notes.append(f"{opponent['team_name']} har ingen kampe i data; modstanderstyrken er sat til gennemsnit.")
    unrated = [p["name"] for p in men + women if all(p["ratings"][k][1] == 0 for k in ("single", "double", "mix"))]
    if unrated:
        notes.append("Ingen ligakampe i data for: " + ", ".join(unrated) + ". De regnes som gennemsnitlige.")

    return {
        "team": entity(team["team_name"]),
        "opponent": entity(opponent["team_name"]),
        "format": fmt,
        "opponentLineup": (
            {
                "date": opp_lineup["date"],
                "against": opp_lineup["opponent"],
                "players": [{**player_entity(op["name"], op["id"]), "sex": opp_sex.get(op.get("playerKey")), "slots": op["slots"]}
                            for op in opp_lineup["players"]],
            }
            if opp_lineup
            else None
        ),
        "candidates": top,
        "excluded": excluded,
        "notes": notes,
        "model": "Elo pr. spiller og disciplin fra alle ligakampe i data; par tæller som gennemsnittet. 1500 er en gennemsnitlig Danmarksserie-spiller.",
    }
