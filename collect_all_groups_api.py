#!/usr/bin/env python3
"""Collect detailed BadmintonPlayer data across all groups for a season.

The script:
1) Calls GetLeagueStanding with subPage=1 to discover all groups.
2) Calls subPage=4 per group to fetch all team matches.
3) Calls subPage=5 per match to fetch full match details.
4) Saves grouped metadata + team/individual CSV exports.

Example:
  python3 collect_all_groups_api.py \
    --url "https://badmintonplayer.dk/DBF/HoldTurnering/Stilling/#1,2025,,1,1,,,,"
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collect_team_matches_api import (
    HASH_FIELDS,
    LeagueApiClient,
    normalize_space,
    parse_match_detail_html,
    parse_schedule_html,
    parse_showstanding_args,
    parse_tables,
    payload_to_hash,
)
from fetch_match_via_api import get_base_page_url, parse_hash_payload

DEFAULT_URL = "https://badmintonplayer.dk/DBF/HoldTurnering/Stilling/#1,2025,,1,1,,,,"


def to_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    if text.lstrip("-").isdigit():
        return int(text)
    return None


def parse_group_catalog_html(
    html_fragment: str,
    *,
    base_page_url: str,
    default_season_id: int | None,
    default_age_group_id: int | None,
    default_region_id: int | None,
    default_club_id: int | None,
) -> list[dict[str, Any]]:
    tables = parse_tables(html_fragment)
    selectgroup = None
    for table in tables:
        classes = table["attrs"].get("class", "")
        if "selectgroup" in classes.split():
            selectgroup = table
            break

    if selectgroup is None:
        return []

    groups: list[dict[str, Any]] = []
    seen: set[tuple[int | None, int | None]] = set()
    current_division = ""

    for row in selectgroup["rows"]:
        row_class = row["attrs"].get("class", "")

        if "divisionrow" in row_class and row["cells"]:
            current_division = normalize_space(row["cells"][0].get("text", ""))
            continue

        if "grouprow" not in row_class or not row["cells"]:
            continue

        cell = row["cells"][0]
        group_name = normalize_space(cell.get("text", ""))

        if not cell.get("links"):
            continue

        onclick = cell["links"][0]["attrs"].get("onclick", "")
        args = parse_showstanding_args(onclick)
        if not args or len(args) != len(HASH_FIELDS):
            continue

        args_map = dict(zip(HASH_FIELDS, args))
        season_id = to_int_or_none(args_map.get("seasonID")) or default_season_id
        league_group_id = to_int_or_none(args_map.get("leagueGroupID"))
        age_group_id = (
            to_int_or_none(args_map.get("ageGroupID")) or default_age_group_id
        )
        region_id = to_int_or_none(args_map.get("regionID")) or default_region_id
        club_id = to_int_or_none(args_map.get("clubID"))

        if club_id is None:
            club_id = default_club_id

        if league_group_id is None:
            continue

        key = (season_id, league_group_id)
        if key in seen:
            continue
        seen.add(key)

        payload2 = {
            "subPage": 2,
            "seasonID": season_id,
            "leagueGroupID": league_group_id,
            "ageGroupID": age_group_id,
            "regionID": region_id,
            "leagueGroupTeamID": None,
            "leagueMatchID": None,
            "clubID": club_id,
            "playerID": None,
        }

        groups.append(
            {
                "season_id": season_id,
                "age_group_id": age_group_id,
                "region_id": region_id,
                "club_id": club_id,
                "league_group_id": league_group_id,
                "division_name": current_division,
                "group_name": group_name,
                "group_hash_url": f"{base_page_url}#{payload_to_hash(payload2)}",
            }
        )

    return groups


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_groups_csv(path: Path, groups: list[dict[str, Any]]) -> None:
    fieldnames = [
        "season_id",
        "age_group_id",
        "region_id",
        "club_id",
        "league_group_id",
        "division_name",
        "group_name",
        "group_hash_url",
    ]
    with path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        for group in groups:
            writer.writerow({key: group.get(key) for key in fieldnames})


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Collect all groups and all detailed matches from a BadmintonPlayer "
            "subPage=1 standings URL."
        )
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help="Standings URL for group catalog (#1,...).",
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
        "--group-limit",
        type=int,
        default=None,
        help="Only process first N groups (debug option).",
    )
    parser.add_argument(
        "--match-limit-per-group",
        type=int,
        default=None,
        help="Only process first N matches per group (debug option).",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Retry attempts for schedule/detail API calls (default: 3).",
    )
    parser.add_argument(
        "--retry-backoff",
        type=float,
        default=1.5,
        help="Base seconds for retry backoff (default: 1.5).",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=25,
        help="Print match progress every N matches per group (default: 25).",
    )
    return parser.parse_args()


def fetch_with_retry(
    client: LeagueApiClient,
    payload: dict[str, Any],
    *,
    attempts: int,
    backoff_seconds: float,
    label: str,
) -> dict[str, Any]:
    max_attempts = max(1, attempts)
    delay = max(0.0, backoff_seconds)
    last_exc: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            return client.get_league_standing(payload)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt >= max_attempts:
                break

            sleep_seconds = delay * (2 ** (attempt - 1))
            print(
                f"[warn] {label}: attempt {attempt}/{max_attempts} failed: {exc}. "
                f"Retrying in {sleep_seconds:.1f}s...",
                file=sys.stderr,
            )
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

    raise RuntimeError(f"{label} failed after {max_attempts} attempts: {last_exc}")


def main() -> int:
    args = parse_args()
    started_at = time.time()

    print("Starting all-groups collection")
    print(f"Source URL: {args.url}")
    print(
        "Settings: "
        f"timeout={args.timeout}s, retries={args.retries}, "
        f"retry_backoff={args.retry_backoff}s, delay={args.delay}s"
    )

    try:
        source_payload = parse_hash_payload(args.url)
    except Exception as exc:  # noqa: BLE001
        print(f"Invalid URL/hash: {exc}", file=sys.stderr)
        return 1

    source_payload["subPage"] = 1
    source_payload["leagueGroupID"] = None
    source_payload["leagueGroupTeamID"] = None
    source_payload["leagueMatchID"] = None
    source_payload["playerID"] = None

    club_id_default = source_payload.get("clubID")
    if club_id_default is None:
        club_id_default = -3

    try:
        client = LeagueApiClient(args.url, timeout=args.timeout)
        catalog_response = fetch_with_retry(
            client,
            source_payload,
            attempts=args.retries,
            backoff_seconds=args.retry_backoff,
            label="Group catalog (#1)",
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to fetch group catalog (#1): {exc}", file=sys.stderr)
        return 1

    catalog_html = html.unescape(str(catalog_response["d"].get("html", "")))
    base_page_url = get_base_page_url(args.url)

    groups = parse_group_catalog_html(
        catalog_html,
        base_page_url=base_page_url,
        default_season_id=to_int_or_none(source_payload.get("seasonID")),
        default_age_group_id=to_int_or_none(source_payload.get("ageGroupID")),
        default_region_id=to_int_or_none(source_payload.get("regionID")),
        default_club_id=to_int_or_none(club_id_default),
    )

    if args.group_limit is not None:
        groups = groups[: max(0, args.group_limit)]

    if not groups:
        print("No groups found from #1 response.", file=sys.stderr)
        return 1

    print(f"Discovered {len(groups)} groups")

    all_matches: list[dict[str, Any]] = []
    total_detail_success = 0
    total_detail_failed = 0
    failed_match_ids: list[int] = []

    for group_idx, group in enumerate(groups, start=1):
        group_started_at = time.time()
        group_payload = {
            "subPage": 4,
            "seasonID": group["season_id"],
            "leagueGroupID": group["league_group_id"],
            "ageGroupID": group["age_group_id"],
            "regionID": group["region_id"],
            "leagueGroupTeamID": None,
            "leagueMatchID": None,
            "clubID": to_int_or_none(club_id_default),
            "playerID": None,
        }

        if group.get("club_id") is not None:
            group_payload["clubID"] = group["club_id"]

        try:
            schedule_response = fetch_with_retry(
                client,
                group_payload,
                attempts=args.retries,
                backoff_seconds=args.retry_backoff,
                label=(
                    "Schedule (#4) "
                    f"group={group['league_group_id']} season={group['season_id']}"
                ),
            )
        except Exception as exc:  # noqa: BLE001
            print(
                f"[{group_idx}/{len(groups)}] Group {group['league_group_id']} failed: {exc}",
                file=sys.stderr,
            )
            continue

        schedule_html = html.unescape(str(schedule_response["d"].get("html", "")))
        group_matches = parse_schedule_html(schedule_html, base_page_url, group_payload)

        if args.match_limit_per_group is not None:
            group_matches = group_matches[: max(0, args.match_limit_per_group)]

        print(
            f"[{group_idx}/{len(groups)}] {group['division_name']} :: {group['group_name']} "
            f"(group {group['league_group_id']}, season {group['season_id']}): "
            f"{len(group_matches)} matches"
        )

        group_detail_success = 0
        group_detail_failed = 0

        for match_idx, match in enumerate(group_matches, start=1):
            match["season_id"] = group["season_id"]
            match["age_group_id"] = group["age_group_id"]
            match["region_id"] = group["region_id"]
            match["club_id"] = group.get("club_id")
            match["league_group_id"] = group["league_group_id"]
            match["division_name"] = group["division_name"]
            match["group_name"] = group["group_name"]

            detail_payload = dict(group_payload)
            detail_payload["subPage"] = 5
            detail_payload["leagueMatchID"] = match["match_id"]

            try:
                detail_response = fetch_with_retry(
                    client,
                    detail_payload,
                    attempts=args.retries,
                    backoff_seconds=args.retry_backoff,
                    label=(
                        "Match detail (#5) "
                        f"match={match['match_id']} "
                        f"group={group['league_group_id']}"
                    ),
                )
            except Exception as exc:  # noqa: BLE001
                match["detail_error"] = str(exc)
                match["individual_matches"] = []
                match["match_info"] = {}
                match["home_team_info"] = {}
                match["away_team_info"] = {}
                match["detail_html"] = ""
                group_detail_failed += 1
                total_detail_failed += 1
                failed_match_ids.append(match["match_id"])
                print(
                    f"    [{match_idx}/{len(group_matches)}] Match {match['match_id']}: failed ({exc})",
                    file=sys.stderr,
                )
                all_matches.append(match)
                continue

            detail_html = html.unescape(str(detail_response["d"].get("html", "")))
            parsed_detail = parse_match_detail_html(detail_html)
            match.update(parsed_detail)
            match["detail_html"] = detail_html
            all_matches.append(match)
            group_detail_success += 1
            total_detail_success += 1

            if (
                match_idx == 1
                or match_idx == len(group_matches)
                or (args.progress_every > 0 and match_idx % args.progress_every == 0)
            ):
                elapsed_group = time.time() - group_started_at
                print(
                    "    Progress "
                    f"{match_idx}/{len(group_matches)} | "
                    f"ok={group_detail_success} fail={group_detail_failed} | "
                    f"elapsed={elapsed_group:.1f}s"
                )

            if args.delay > 0:
                time.sleep(args.delay)

        group_elapsed = time.time() - group_started_at
        print(
            f"[{group_idx}/{len(groups)}] Done group {group['league_group_id']} "
            f"in {group_elapsed:.1f}s (ok={group_detail_success}, fail={group_detail_failed})"
        )

    total_individual = sum(len(m.get("individual_matches", [])) for m in all_matches)
    played = sum(
        1
        for m in all_matches
        if normalize_space(m.get("team_result", "")) not in {"", "-"}
    )

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    season_value = source_payload.get("seasonID")
    season_part = str(season_value) if season_value is not None else "unknown"
    stem = f"season_{season_part}_all_groups"

    full_json_path = output_dir / f"{stem}_full.json"
    groups_csv_path = output_dir / f"{stem}_groups.csv"
    team_csv_path = output_dir / f"{stem}_team_matches.csv"
    individual_csv_path = output_dir / f"{stem}_individual_matches.csv"

    exported = {
        "metadata": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "source_url": args.url,
            "base_page_url": base_page_url,
            "hash_payload_used_for_discovery": source_payload,
            "group_count": len(groups),
            "match_count": len(all_matches),
            "played_match_count": played,
            "individual_match_count": total_individual,
            "detail_success_count": total_detail_success,
            "detail_failed_count": total_detail_failed,
        },
        "group_catalog_html": catalog_html,
        "groups": groups,
        "matches": all_matches,
    }

    write_json(full_json_path, exported)
    write_groups_csv(groups_csv_path, groups)
    write_team_matches_csv(team_csv_path, all_matches)
    write_individual_matches_csv(individual_csv_path, all_matches)

    print()
    print("Saved files:")
    print(f"  - {full_json_path}")
    print(f"  - {groups_csv_path}")
    print(f"  - {team_csv_path}")
    print(f"  - {individual_csv_path}")

    total_elapsed = time.time() - started_at
    print()
    print("Summary:")
    print(f"  Groups processed: {len(groups)}")
    print(f"  Team matches collected: {len(all_matches)}")
    print(f"  Detail calls succeeded: {total_detail_success}")
    print(f"  Detail calls failed: {total_detail_failed}")
    print(f"  Total elapsed: {total_elapsed:.1f}s")
    if failed_match_ids:
        sample = ", ".join(str(mid) for mid in failed_match_ids[:20])
        more = (
            ""
            if len(failed_match_ids) <= 20
            else f" ... (+{len(failed_match_ids) - 20} more)"
        )
        print(f"  Failed match IDs: {sample}{more}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
