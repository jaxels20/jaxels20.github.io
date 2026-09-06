#!/usr/bin/env python3
"""Regenerate season_<year>_all_groups_individual_matches.csv from the stored JSON exports.

Use this after changing the CSV layout (for example adding player id columns) so the
warehouse can be rebuilt without re-downloading anything from badmintonplayer.dk.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from collect_all_groups_api import write_individual_matches_csv

ROOT_DIR = Path(__file__).resolve().parent
EXPORT_DIR = ROOT_DIR / "badminton_export"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", type=int, nargs="*", help="Season years (default: every season JSON found).")
    args = parser.parse_args()

    if args.years:
        json_paths = [EXPORT_DIR / f"season_{y}_all_groups_full.json" for y in args.years]
    else:
        json_paths = sorted(EXPORT_DIR.glob("season_*_all_groups_full.json"))

    for json_path in json_paths:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        csv_path = json_path.with_name(json_path.name.replace("_full.json", "_individual_matches.csv"))
        write_individual_matches_csv(csv_path, payload["matches"])
        print(f"wrote {csv_path.name} ({len(payload['matches'])} team matches)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
