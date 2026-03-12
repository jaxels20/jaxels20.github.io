from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
SQL_DIR = ROOT_DIR / "sql"
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://jaxels20.github.io",
)


def parse_optional_int(value: str | None) -> int | None:
    if not value:
        return None
    return int(value)


def parse_cors_origins(value: str | None) -> tuple[str, ...]:
    if not value:
        return DEFAULT_CORS_ORIGINS

    origins = tuple(origin.strip() for origin in value.split(",") if origin.strip())
    return origins or DEFAULT_CORS_ORIGINS


@dataclass(frozen=True)
class Settings:
    app_name: str
    db_name: str
    db_host: str
    db_port: int | None
    db_user: str | None
    psql_bin: str
    cors_origins: tuple[str, ...]


def get_settings() -> Settings:
    return Settings(
        app_name=os.getenv("BADMINTON_APP_NAME", "Badminton Reports API"),
        db_name=os.getenv("BADMINTON_DB_NAME", "badminton_dw_individual"),
        db_host=os.getenv("BADMINTON_DB_HOST", "/tmp"),
        db_port=parse_optional_int(os.getenv("BADMINTON_DB_PORT")),
        db_user=os.getenv("BADMINTON_DB_USER"),
        psql_bin=os.getenv("BADMINTON_PSQL_BIN", "psql"),
        cors_origins=parse_cors_origins(os.getenv("BADMINTON_CORS_ORIGINS")),
    )


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
