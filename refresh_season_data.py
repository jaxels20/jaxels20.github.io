#!/usr/bin/env python3
"""Collect and refresh one season/year in both data warehouses.

Behavior:
1) Collect all-groups data for the chosen year (optional step).
2) Delete only that season from each DW.
3) Insert freshly collected season rows.

Example:
  python3 refresh_season_data.py --year 2022
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect + refresh a single season in badminton data warehouses."
    )
    parser.add_argument(
        "--year", type=int, required=True, help="Season year (example: 2022)."
    )
    parser.add_argument(
        "--output-dir",
        default="badminton_export",
        help="Directory for exported files (default: badminton_export).",
    )
    parser.add_argument(
        "--base-url",
        default="https://badmintonplayer.dk/DBF/HoldTurnering/Stilling/",
        help="Base BadmintonPlayer standings URL.",
    )
    parser.add_argument(
        "--age-group-id",
        type=int,
        default=1,
        help="Age group id for standings URL hash (default: 1).",
    )
    parser.add_argument(
        "--region-id",
        type=int,
        default=1,
        help="Region id for standings URL hash (default: 1).",
    )
    parser.add_argument(
        "--club-id",
        type=int,
        default=None,
        help="Optional club id in standings URL hash.",
    )
    parser.add_argument(
        "--skip-collect",
        action="store_true",
        help="Skip collection and use existing season_<year>_all_groups CSVs.",
    )
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument("--delay", type=float, default=0.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    parser.add_argument("--progress-every", type=int, default=20)
    parser.add_argument(
        "--skip-individual-load",
        action="store_true",
        help="Skip refresh of badminton_dw_individual.",
    )
    parser.add_argument(
        "--skip-team-load",
        action="store_true",
        help="Skip refresh of badminton_dw_team.",
    )
    parser.add_argument(
        "--psql-bin",
        default="psql",
        help="psql binary or absolute path (default: psql).",
    )
    parser.add_argument("--db-host", default="/tmp")
    parser.add_argument("--db-port", type=int, default=None)
    parser.add_argument("--db-user", default=None)
    parser.add_argument(
        "--python-bin",
        default=sys.executable,
        help="Python executable to run collection script (default: current interpreter).",
    )
    return parser.parse_args()


def resolve_psql_bin(configured: str) -> str:
    candidates = [
        configured,
        "psql",
        "psql-18",
        "/opt/homebrew/bin/psql",
        "/opt/homebrew/bin/psql-18",
        "/usr/local/bin/psql",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        found = shutil.which(candidate)
        if found:
            return found
        path = Path(candidate).expanduser()
        if path.exists() and path.is_file():
            return str(path.resolve())

    raise RuntimeError(
        "Could not find psql binary. Install psql/psql-18 or pass --psql-bin with full path."
    )


def run_command(command: list[str], *, workdir: Path, label: str) -> None:
    print(f"\n[{label}] {' '.join(command)}", flush=True)
    completed = subprocess.run(command, cwd=str(workdir), check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {completed.returncode}")


def query_with_psql(psql_base: list[str], *, db_name: str, sql: str) -> str | None:
    command = psql_base + ["-d", db_name, "-t", "-A", "-c", sql]
    completed = subprocess.run(
        command,
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return None
    return completed.stdout.strip()


def table_exists(psql_base: list[str], *, db_name: str, table_name: str) -> bool:
    output = query_with_psql(
        psql_base,
        db_name=db_name,
        sql=f"SELECT to_regclass('{table_name}') IS NOT NULL;",
    )
    return output == "t"


def build_standings_url(
    *,
    base_url: str,
    year: int,
    age_group_id: int,
    region_id: int,
    club_id: int | None,
) -> str:
    normalized_base = base_url.rstrip("/") + "/"
    club_part = "" if club_id is None else str(club_id)
    hash_part = f"#1,{year},,{age_group_id},{region_id},,,{club_part},"
    return normalized_base + hash_part


def main() -> int:
    args = parse_args()

    output_dir = (ROOT_DIR / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    standings_url = build_standings_url(
        base_url=args.base_url,
        year=args.year,
        age_group_id=args.age_group_id,
        region_id=args.region_id,
        club_id=args.club_id,
    )

    if not args.skip_collect:
        collect_command = [
            args.python_bin,
            str(ROOT_DIR / "collect_all_groups_api.py"),
            "--url",
            standings_url,
            "--year",
            str(args.year),
            "--output-dir",
            str(output_dir),
            "--timeout",
            str(args.timeout),
            "--delay",
            str(args.delay),
            "--retries",
            str(args.retries),
            "--retry-backoff",
            str(args.retry_backoff),
            "--progress-every",
            str(args.progress_every),
        ]
        run_command(collect_command, workdir=ROOT_DIR, label="collect")
    else:
        print("\n[collect] skipped", flush=True)

    team_csv = output_dir / f"season_{args.year}_all_groups_team_matches.csv"
    individual_csv = (
        output_dir / f"season_{args.year}_all_groups_individual_matches.csv"
    )

    if not team_csv.exists() or not individual_csv.exists():
        raise RuntimeError(
            f"Missing season CSV files. Expected:\n  - {team_csv}\n  - {individual_csv}"
        )

    psql_bin = resolve_psql_bin(args.psql_bin)

    psql_base = [psql_bin]
    if args.db_host:
        psql_base += ["-h", args.db_host]
    if args.db_port:
        psql_base += ["-p", str(args.db_port)]
    if args.db_user:
        psql_base += ["-U", args.db_user]

    common_vars = [
        "--set",
        f"season_id={args.year}",
        "--set",
        f"individual_csv={individual_csv}",
        "--set",
        f"team_csv={team_csv}",
    ]

    if not args.skip_individual_load:
        if table_exists(
            psql_base,
            db_name="badminton_dw_individual",
            table_name="dw.fact_individual_match",
        ):
            refresh_individual_cmd = (
                psql_base
                + ["-d", "postgres"]
                + common_vars
                + [
                    "-f",
                    str(ROOT_DIR / "sql" / "refresh_individual_fact_dw_season.sql"),
                ]
            )
            run_command(
                refresh_individual_cmd, workdir=ROOT_DIR, label="refresh-individual"
            )
        else:
            bootstrap_individual_cmd = (
                psql_base
                + ["-d", "postgres"]
                + [
                    "--set",
                    f"individual_csv={individual_csv}",
                    "--set",
                    f"team_csv={team_csv}",
                ]
                + ["-f", str(ROOT_DIR / "sql" / "build_individual_fact_dw.sql")]
            )
            run_command(
                bootstrap_individual_cmd,
                workdir=ROOT_DIR,
                label="bootstrap-individual",
            )
    else:
        print("\n[refresh-individual] skipped", flush=True)

    if not args.skip_team_load:
        if table_exists(
            psql_base, db_name="badminton_dw_team", table_name="dw.fact_team_match"
        ):
            refresh_team_cmd = (
                psql_base
                + ["-d", "postgres"]
                + common_vars
                + ["-f", str(ROOT_DIR / "sql" / "refresh_team_fact_dw_season.sql")]
            )
            run_command(refresh_team_cmd, workdir=ROOT_DIR, label="refresh-team")
        else:
            bootstrap_team_cmd = (
                psql_base
                + ["-d", "postgres"]
                + [
                    "--set",
                    f"individual_csv={individual_csv}",
                    "--set",
                    f"team_csv={team_csv}",
                ]
                + ["-f", str(ROOT_DIR / "sql" / "build_team_fact_dw.sql")]
            )
            run_command(bootstrap_team_cmd, workdir=ROOT_DIR, label="bootstrap-team")
    else:
        print("\n[refresh-team] skipped", flush=True)

    print("\nDone.", flush=True)
    print(f"Season refreshed: {args.year}", flush=True)
    print(f"Team CSV: {team_csv}", flush=True)
    print(f"Individual CSV: {individual_csv}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
