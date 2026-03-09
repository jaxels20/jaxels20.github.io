from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
SQL_DIR = ROOT_DIR / "sql"


@dataclass(frozen=True)
class Settings:
    app_name: str = "Badminton Reports API"
    db_name: str = os.getenv("BADMINTON_DB_NAME", "badminton_dw_individual")
    db_host: str = os.getenv("BADMINTON_DB_HOST", "/tmp")
    db_port: int | None = (
        int(os.environ["BADMINTON_DB_PORT"]) if os.getenv("BADMINTON_DB_PORT") else None
    )
    db_user: str | None = os.getenv("BADMINTON_DB_USER")
    psql_bin: str = os.getenv("BADMINTON_PSQL_BIN", "psql")
    cors_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )


def get_settings() -> Settings:
    return Settings()


def resolve_psql_bin(configured_bin: str) -> str:
    candidates = [
        configured_bin,
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
        "Could not find psql binary. Set BADMINTON_PSQL_BIN or install psql/psql-18."
    )
