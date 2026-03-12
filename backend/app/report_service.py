from __future__ import annotations

import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .report_parser import (
    blocks_to_jsonable,
    clean_report_lines,
    extract_title,
    parse_blocks,
)
from .settings import SQL_DIR, Settings, resolve_psql_bin


@dataclass(frozen=True)
class ReportConfig:
    script_path: Path
    variables: tuple[str, ...]
    title_fallback: str


REPORT_CONFIGS: dict[str, ReportConfig] = {
    "player": ReportConfig(
        script_path=SQL_DIR / "player_stats_report.sql",
        variables=("player_name",),
        title_fallback="Player Stats Report",
    ),
    "team": ReportConfig(
        script_path=SQL_DIR / "team_stats_report.sql",
        variables=("team_name",),
        title_fallback="Team Stats Report",
    ),
    "team_h2h": ReportConfig(
        script_path=SQL_DIR / "team_head_to_head_report.sql",
        variables=("team_a", "team_b"),
        title_fallback="Team Head-to-Head Comparison Report",
    ),
}


def run_report_script(
    *,
    report_type: str,
    name: str,
    name_b: str | None,
    season_id: int | None,
    settings: Settings,
) -> dict[str, Any]:
    if report_type not in REPORT_CONFIGS:
        raise ValueError(f"Unsupported report type: {report_type}")

    report_config = REPORT_CONFIGS[report_type]
    if not report_config.script_path.exists():
        raise FileNotFoundError(f"Missing SQL script: {report_config.script_path}")

    psql_bin = resolve_psql_bin(settings.psql_bin)

    command: list[str] = [psql_bin]
    if settings.db_host:
        command.extend(["-h", settings.db_host])
    if settings.db_port:
        command.extend(["-p", str(settings.db_port)])
    if settings.db_user:
        command.extend(["-U", settings.db_user])

    command.extend(["-d", settings.db_name])

    if report_type == "team_h2h":
        if not name_b:
            raise ValueError("team_h2h requires secondary team name")
        command.extend(["--set", f"team_a={name}"])
        command.extend(["--set", f"team_b={name_b}"])
    else:
        command.extend(["--set", f"{report_config.variables[0]}={name}"])

    if season_id is not None:
        command.extend(["--set", f"season_id={season_id}"])
    command.extend(["-f", str(report_config.script_path)])

    completed = subprocess.run(
        command,
        cwd=str(report_config.script_path.parent.parent),
        capture_output=True,
        text=True,
        check=False,
    )

    if completed.returncode != 0:
        error_text = (
            completed.stderr.strip() or completed.stdout.strip() or "Unknown error"
        )
        raise RuntimeError(error_text)

    report_text = completed.stdout
    cleaned_lines = clean_report_lines(report_text)
    title, titleless_lines = extract_title(cleaned_lines, report_config.title_fallback)
    blocks = parse_blocks(titleless_lines)

    return {
        "report_type": report_type,
        "title": title,
        "subject": f"{name} vs {name_b}" if report_type == "team_h2h" else name,
        "subject_primary": name,
        "subject_secondary": name_b,
        "season_id": season_id,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "raw_text": report_text,
        "blocks": blocks_to_jsonable(blocks),
    }
