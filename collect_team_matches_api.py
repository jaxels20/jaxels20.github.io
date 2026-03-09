#!/usr/bin/env python3
"""Collect detailed BadmintonPlayer team match data from a #4 standings link.

The script:
1) Calls GetLeagueStanding with subPage=4 to fetch all team matches in the group.
2) Calls GetLeagueStanding with subPage=5 per match to fetch full match details.
3) Saves data as JSON + CSV and prints readable output.

Example:
  python collect_team_matches_api.py \
    --url "https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#4,2025,17917,1,1,,,-3,"
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

from fetch_match_via_api import (
    HASH_FIELDS,
    SERVICE_PATH,
    extract_callback_context,
    get_base_page_url,
    http_get_text,
    http_post_json,
    parse_hash_payload,
)

DEFAULT_URL = (
    "https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#4,2025,17917,1,1,,,-3,"
)
SHOW_STANDING_RE = re.compile(r"ShowStanding\((.*?)\)")
QUOTED_RE = re.compile(r"'([^']*)'")
SCORE_RE = re.compile(r"(\d{1,2})\s*-\s*(\d{1,2})")
ROUND_RE = re.compile(r"^\s*(\d+)\s+(\d{2}-\d{2}-\d{4})\s*$")


def normalize_space(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split())


def normalize_multiline(value: str) -> str:
    lines = [normalize_space(line) for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


def split_lines(value: str) -> list[str]:
    text = normalize_multiline(value)
    if not text:
        return []
    return text.split("\n")


def to_attrs_dict(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, val in attrs:
        if key:
            out[key.lower()] = "" if val is None else val
    return out


class _TableParser(HTMLParser):
    """Parse HTML fragment into table/row/cell structures."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[dict[str, Any]] = []
        self._table: dict[str, Any] | None = None
        self._row: dict[str, Any] | None = None
        self._cell: dict[str, Any] | None = None
        self._anchor: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = to_attrs_dict(attrs)

        if self._cell is not None:
            if tag == "br":
                self._cell["text_parts"].append("\n")
            elif tag == "div" and self._cell["text_parts"]:
                self._cell["text_parts"].append("\n")
            if tag == "input":
                self._cell["inputs"].append(attrs_dict)

        if tag == "table":
            self._table = {"attrs": attrs_dict, "rows": []}
            return

        if self._table is None:
            return

        if tag == "tr":
            self._row = {"attrs": attrs_dict, "cells": []}
            return

        if self._row is None:
            return

        if tag in {"td", "th"}:
            self._cell = {
                "tag": tag,
                "attrs": attrs_dict,
                "text_parts": [],
                "links": [],
                "inputs": [],
            }
            return

        if self._cell is not None and tag == "a":
            self._anchor = {"attrs": attrs_dict, "text_parts": []}

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell["text_parts"].append(data)
        if self._anchor is not None:
            self._anchor["text_parts"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchor is not None and self._cell is not None:
            self._anchor["text"] = normalize_multiline(
                "".join(self._anchor["text_parts"])
            )
            self._cell["links"].append(self._anchor)
            self._anchor = None
            return

        if tag == "div" and self._cell is not None:
            self._cell["text_parts"].append("\n")
            return

        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._cell["text"] = normalize_multiline("".join(self._cell["text_parts"]))
            self._row["cells"].append(self._cell)
            self._cell = None
            return

        if tag == "tr" and self._row is not None and self._table is not None:
            if self._row["cells"]:
                self._table["rows"].append(self._row)
            self._row = None
            return

        if tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None


def parse_tables(html_fragment: str) -> list[dict[str, Any]]:
    parser = _TableParser()
    parser.feed(html_fragment)
    parser.close()
    return parser.tables


def parse_showstanding_args(onclick: str) -> list[str] | None:
    if not onclick:
        return None
    match = SHOW_STANDING_RE.search(onclick)
    if not match:
        return None
    return QUOTED_RE.findall(match.group(1))


def payload_to_hash(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in HASH_FIELDS:
        val = payload.get(key)
        parts.append("" if val is None else str(val))
    return ",".join(parts)


def extract_match_id_from_cell(cell: dict[str, Any]) -> int | None:
    text = normalize_space(cell.get("text", ""))
    if text.isdigit():
        return int(text)

    for link in cell.get("links", []):
        args = parse_showstanding_args(link["attrs"].get("onclick", ""))
        if args and len(args) >= 7 and args[0] == "5" and args[6].isdigit():
            return int(args[6])
    return None


def find_table_with_class(
    tables: list[dict[str, Any]], class_name: str
) -> dict[str, Any] | None:
    for table in tables:
        classes = table["attrs"].get("class", "")
        if class_name in classes.split():
            return table
    return None


def parse_schedule_html(
    html_fragment: str,
    base_page_url: str,
    base_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    tables = parse_tables(html_fragment)
    matchlist = find_table_with_class(tables, "matchlist")
    if matchlist is None:
        return []

    results: list[dict[str, Any]] = []
    current_round_text: str | None = None
    current_round_no: int | None = None
    current_round_date: str | None = None

    for row in matchlist["rows"]:
        row_class = row["attrs"].get("class", "")

        if "roundheader" in row_class and row["cells"]:
            current_round_text = normalize_space(row["cells"][0].get("text", ""))
            current_round_no = None
            current_round_date = None
            round_match = ROUND_RE.match(current_round_text)
            if round_match:
                current_round_no = int(round_match.group(1))
                current_round_date = round_match.group(2)
            continue

        if "headerrow" in row_class:
            continue

        cells = row["cells"]
        if len(cells) < 8:
            continue

        match_id = extract_match_id_from_cell(cells[1])
        if match_id is None:
            continue

        payload5 = dict(base_payload)
        payload5["subPage"] = 5
        payload5["leagueMatchID"] = match_id
        payload5["leagueGroupTeamID"] = None
        payload5["playerID"] = None

        result = {
            "match_id": match_id,
            "round": current_round_text,
            "round_no": current_round_no,
            "round_date": current_round_date,
            "time": cells[0].get("text", ""),
            "home_team": cells[2].get("text", ""),
            "away_team": cells[3].get("text", ""),
            "organizer": cells[4].get("text", "") if len(cells) > 4 else "",
            "venue": cells[5].get("text", "") if len(cells) > 5 else "",
            "team_result": cells[6].get("text", "") if len(cells) > 6 else "",
            "team_points": cells[7].get("text", "") if len(cells) > 7 else "",
            "wo": cells[8].get("text", "") if len(cells) > 8 else "",
            "livescore": cells[9].get("text", "") if len(cells) > 9 else "",
            "detail_hash_url": f"{base_page_url}#{payload_to_hash(payload5)}",
        }
        results.append(result)

    return results


def parse_team_cell(
    cell: dict[str, Any],
    *,
    fallback_to_lines: bool = True,
) -> dict[str, Any]:
    lines = split_lines(cell.get("text", ""))
    team_name = lines[0] if lines else None

    players: list[dict[str, Any]] = []
    for link in cell.get("links", []):
        href = link["attrs"].get("href", "")
        name = normalize_space(link.get("text", ""))
        if not name:
            continue
        is_player_link = "/Spiller/VisSpiller/" in href and "#" in href
        if not is_player_link:
            continue
        player_id = None
        id_match = re.search(r"#(\d+)$", href)
        if id_match:
            player_id = int(id_match.group(1))
        players.append(
            {"name": name, "player_id": player_id, "profile_url": href or None}
        )

    if fallback_to_lines and not players and len(lines) > 1:
        for line in lines[1:]:
            players.append({"name": line, "player_id": None, "profile_url": None})

    return {"team_name": team_name, "players": players, "raw_text_lines": lines}


def parse_set_score(score_text: str) -> dict[str, Any]:
    cleaned = normalize_space(score_text)
    if not cleaned:
        return {"score": "", "home": None, "away": None}
    match = SCORE_RE.search(cleaned)
    if not match:
        return {"score": cleaned, "home": None, "away": None}
    return {
        "score": f"{int(match.group(1))}-{int(match.group(2))}",
        "home": int(match.group(1)),
        "away": int(match.group(2)),
    }


def parse_match_detail_html(html_fragment: str) -> dict[str, Any]:
    tables = parse_tables(html_fragment)
    info_table = find_table_with_class(tables, "matchinfo")
    result_table = find_table_with_class(tables, "matchresultschema")

    match_info: dict[str, Any] = {}
    home_cell: dict[str, Any] | None = None
    away_cell: dict[str, Any] | None = None

    if info_table is not None:
        for row in info_table["rows"]:
            if len(row["cells"]) < 2:
                continue
            key = row["cells"][0].get("text", "")
            value = row["cells"][1].get("text", "")
            match_info[key] = value
            if normalize_space(key).lower() == "hjemmehold":
                home_cell = row["cells"][1]
            if normalize_space(key).lower() == "udehold":
                away_cell = row["cells"][1]

    sets_header: list[str] = []
    individual_matches: list[dict[str, Any]] = []

    if result_table is not None and result_table["rows"]:
        header_row = result_table["rows"][0]
        if len(header_row["cells"]) >= 5:
            set_cells = header_row["cells"][3:-1]
            sets_header = [
                cell.get("text", "") for cell in set_cells if cell.get("text", "")
            ]

        for row in result_table["rows"][1:]:
            cells = row["cells"]
            if len(cells) < 4:
                continue

            discipline_text = cells[0].get("text", "")
            discipline_no = None
            discipline_code = None
            disc_match = re.search(r"^\s*(\d+)\.\s*([A-Za-z]+)", discipline_text)
            if disc_match:
                discipline_no = int(disc_match.group(1))
                discipline_code = disc_match.group(2)

            home = parse_team_cell(cells[1])
            away = parse_team_cell(cells[2])

            score_cells = (
                cells[3 : 3 + len(sets_header)] if sets_header else cells[3:-1]
            )
            sets: list[dict[str, Any]] = []
            for idx, cell in enumerate(score_cells):
                parsed_score = parse_set_score(cell.get("text", ""))
                label = sets_header[idx] if idx < len(sets_header) else str(idx + 1)
                sets.append({"set_label": label, **parsed_score})

            wo_cell = cells[-1] if len(cells) >= 4 else None
            wo_text = wo_cell.get("text", "") if wo_cell else ""

            home_class = cells[1]["attrs"].get("class", "")
            away_class = cells[2]["attrs"].get("class", "")
            winner_side = None
            winner_team = None
            if "playerwinner" in home_class:
                winner_side = "home"
                winner_team = home.get("team_name")
            elif "playerwinner" in away_class:
                winner_side = "away"
                winner_team = away.get("team_name")

            individual_matches.append(
                {
                    "discipline": normalize_space(discipline_text),
                    "discipline_no": discipline_no,
                    "discipline_code": discipline_code,
                    "home_team": home.get("team_name"),
                    "away_team": away.get("team_name"),
                    "home_players": home.get("players", []),
                    "away_players": away.get("players", []),
                    "sets": sets,
                    "winner_side": winner_side,
                    "winner_team": winner_team,
                    "wo": wo_text,
                }
            )

    home_team_info = (
        parse_team_cell(home_cell, fallback_to_lines=False)
        if home_cell is not None
        else {"team_name": None, "players": []}
    )
    away_team_info = (
        parse_team_cell(away_cell, fallback_to_lines=False)
        if away_cell is not None
        else {"team_name": None, "players": []}
    )

    return {
        "match_info": match_info,
        "home_team_info": home_team_info,
        "away_team_info": away_team_info,
        "sets_header": sets_header,
        "individual_matches": individual_matches,
    }


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_team_matches_csv(path: Path, matches: list[dict[str, Any]]) -> None:
    fieldnames = [
        "season_id",
        "age_group_id",
        "region_id",
        "club_id",
        "league_group_id",
        "division_name",
        "group_name",
        "match_id",
        "round",
        "round_no",
        "round_date",
        "time",
        "home_team",
        "away_team",
        "organizer",
        "venue",
        "team_result",
        "team_points",
        "wo",
        "livescore",
    ]
    with path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        for match in matches:
            writer.writerow({key: match.get(key) for key in fieldnames})


def write_individual_matches_csv(path: Path, matches: list[dict[str, Any]]) -> None:
    fieldnames = [
        "season_id",
        "age_group_id",
        "region_id",
        "club_id",
        "league_group_id",
        "division_name",
        "group_name",
        "match_id",
        "round",
        "discipline",
        "discipline_no",
        "discipline_code",
        "home_team",
        "away_team",
        "home_players",
        "away_players",
        "set_scores",
        "winner_side",
        "winner_team",
        "wo",
    ]
    with path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        for match in matches:
            for game in match.get("individual_matches", []):
                home_players = ", ".join(
                    p["name"] for p in game.get("home_players", [])
                )
                away_players = ", ".join(
                    p["name"] for p in game.get("away_players", [])
                )
                set_scores = ", ".join(
                    s["score"] for s in game.get("sets", []) if s.get("score")
                )
                writer.writerow(
                    {
                        "season_id": match.get("season_id"),
                        "age_group_id": match.get("age_group_id"),
                        "region_id": match.get("region_id"),
                        "club_id": match.get("club_id"),
                        "league_group_id": match.get("league_group_id"),
                        "division_name": match.get("division_name"),
                        "group_name": match.get("group_name"),
                        "match_id": match.get("match_id"),
                        "round": match.get("round"),
                        "discipline": game.get("discipline"),
                        "discipline_no": game.get("discipline_no"),
                        "discipline_code": game.get("discipline_code"),
                        "home_team": game.get("home_team"),
                        "away_team": game.get("away_team"),
                        "home_players": home_players,
                        "away_players": away_players,
                        "set_scores": set_scores,
                        "winner_side": game.get("winner_side"),
                        "winner_team": game.get("winner_team"),
                        "wo": game.get("wo"),
                    }
                )


class LeagueApiClient:
    def __init__(self, standings_url: str, timeout: int) -> None:
        self.base_page_url = get_base_page_url(standings_url)
        self.timeout = timeout
        self.service_url = urljoin(self.base_page_url, SERVICE_PATH)
        self.callback_context = self._refresh_context()

    def _refresh_context(self) -> str:
        page_html = http_get_text(self.base_page_url, timeout=self.timeout)
        return extract_callback_context(page_html)

    def get_league_standing(
        self, payload: dict[str, Any], retry: bool = True
    ) -> dict[str, Any]:
        request_payload = {"callbackcontextkey": self.callback_context, **payload}
        response = http_post_json(
            self.service_url, request_payload, timeout=self.timeout
        )
        if "d" in response:
            return response

        if retry:
            self.callback_context = self._refresh_context()
            request_payload = {"callbackcontextkey": self.callback_context, **payload}
            response = http_post_json(
                self.service_url, request_payload, timeout=self.timeout
            )
            if "d" in response:
                return response

        msg = response.get("Message", "API response missing 'd'.")
        raise RuntimeError(msg)


def print_report(matches: list[dict[str, Any]], print_individual: bool) -> None:
    print()
    print(f"Collected {len(matches)} team matches")
    print("=" * 72)

    for match in matches:
        match_id = match.get("match_id")
        home = match.get("home_team") or "-"
        away = match.get("away_team") or "-"
        score = match.get("team_result") or "-"
        points = match.get("team_points") or "-"
        round_text = match.get("round") or "-"
        time_text = match.get("time") or "-"
        game_count = len(match.get("individual_matches", []))

        print(f"[{match_id}] {home} vs {away}")
        print(f"  Round: {round_text} | Time: {time_text}")
        print(
            f"  Team result: {score} | Points: {points} | Individual matches: {game_count}"
        )

        if print_individual:
            for game in match.get("individual_matches", []):
                discipline = game.get("discipline") or "-"
                home_players = (
                    ", ".join(p["name"] for p in game.get("home_players", [])) or "-"
                )
                away_players = (
                    ", ".join(p["name"] for p in game.get("away_players", [])) or "-"
                )
                set_scores = (
                    ", ".join(
                        s["score"] for s in game.get("sets", []) if s.get("score")
                    )
                    or "-"
                )
                winner = game.get("winner_team") or game.get("winner_side") or "-"
                print(f"    - {discipline}: {home_players} vs {away_players}")
                print(f"      Sets: {set_scores} | Winner: {winner}")
        print("-" * 72)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Collect all team matches and detailed individual match rows "
            "from a BadmintonPlayer #4 standings link."
        )
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help="Year/group standings URL (#4,...).",
    )
    parser.add_argument(
        "--output-dir",
        default="badminton_export",
        help="Directory for output files (default: badminton_export).",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="HTTP timeout in seconds (default: 30).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.0,
        help="Delay in seconds between #5 calls (default: 0).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N matches (debug option).",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print team-level output only (skip per-discipline lines).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        payload = parse_hash_payload(args.url)
    except Exception as exc:  # noqa: BLE001
        print(f"Invalid URL/hash: {exc}", file=sys.stderr)
        return 1

    payload["subPage"] = 4
    payload["leagueMatchID"] = None
    payload["leagueGroupTeamID"] = None
    payload["playerID"] = None

    try:
        client = LeagueApiClient(args.url, timeout=args.timeout)
        schedule_response = client.get_league_standing(payload)
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to fetch schedule (#4): {exc}", file=sys.stderr)
        return 1

    schedule_html = html.unescape(str(schedule_response["d"].get("html", "")))
    base_page_url = get_base_page_url(args.url)
    matches = parse_schedule_html(schedule_html, base_page_url, payload)

    for match in matches:
        match["season_id"] = payload.get("seasonID")
        match["age_group_id"] = payload.get("ageGroupID")
        match["region_id"] = payload.get("regionID")
        match["club_id"] = payload.get("clubID")
        match["league_group_id"] = payload.get("leagueGroupID")
        match["division_name"] = ""
        match["group_name"] = ""

    if args.limit is not None:
        matches = matches[: max(0, args.limit)]

    if not matches:
        print("No matches found in #4 response.", file=sys.stderr)
        return 1

    for idx, match in enumerate(matches, start=1):
        match_id = match["match_id"]
        detail_payload = dict(payload)
        detail_payload["subPage"] = 5
        detail_payload["leagueMatchID"] = match_id

        try:
            detail_response = client.get_league_standing(detail_payload)
        except Exception as exc:  # noqa: BLE001
            match["detail_error"] = str(exc)
            match["individual_matches"] = []
            match["match_info"] = {}
            match["home_team_info"] = {}
            match["away_team_info"] = {}
            match["detail_html"] = ""
            print(
                f"[{idx}/{len(matches)}] Match {match_id}: failed ({exc})",
                file=sys.stderr,
            )
            continue

        detail_html = html.unescape(str(detail_response["d"].get("html", "")))
        parsed_detail = parse_match_detail_html(detail_html)
        match.update(parsed_detail)
        match["detail_html"] = detail_html

        result_text = match.get("team_result") or "-"
        print(f"[{idx}/{len(matches)}] Match {match_id}: {result_text}")

        if args.delay > 0:
            time.sleep(args.delay)

    total_individual = sum(len(m.get("individual_matches", [])) for m in matches)
    played = sum(
        1 for m in matches if normalize_space(m.get("team_result", "")) not in {"", "-"}
    )

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    group_id = payload.get("leagueGroupID")
    season = payload.get("seasonID")
    stem = f"season_{season}_group_{group_id}"

    full_json_path = output_dir / f"{stem}_full.json"
    team_csv_path = output_dir / f"{stem}_team_matches.csv"
    individual_csv_path = output_dir / f"{stem}_individual_matches.csv"

    exported = {
        "metadata": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "source_url": args.url,
            "base_page_url": base_page_url,
            "service_path": SERVICE_PATH,
            "hash_payload_used_for_schedule": payload,
            "match_count": len(matches),
            "played_match_count": played,
            "individual_match_count": total_individual,
        },
        "schedule_html": schedule_html,
        "matches": matches,
    }

    write_json(full_json_path, exported)
    write_team_matches_csv(team_csv_path, matches)
    write_individual_matches_csv(individual_csv_path, matches)

    print_report(matches, print_individual=not args.summary_only)

    print()
    print("Saved files:")
    print(f"  - {full_json_path}")
    print(f"  - {team_csv_path}")
    print(f"  - {individual_csv_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
