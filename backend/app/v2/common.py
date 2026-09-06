from __future__ import annotations

import re
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row

from ..settings import Settings


class NotFound(Exception):
    """Raised when a team, player, group or match does not exist."""


# --- slugs ---------------------------------------------------------------

# The SQL expression and the Python function must stay equivalent: URLs carry
# the Python slug, lookups compare it against the SQL slug of the stored name.
SLUG_SQL = (
    "trim(both '-' from regexp_replace("
    "replace(replace(replace(lower({col}), 'æ', 'ae'), 'ø', 'oe'), 'å', 'aa'),"
    " '[^a-z0-9]+', '-', 'g'))"
)


def slugify(name: str) -> str:
    value = name.lower().replace("æ", "ae").replace("ø", "oe").replace("å", "aa")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def slug_sql(column: str) -> str:
    return SLUG_SQL.format(col=column)


# --- connections ---------------------------------------------------------


def _connect(settings: Settings, db_name: str) -> psycopg.Connection[Any]:
    return psycopg.connect(
        dbname=db_name,
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        options="-c search_path=dw,public",
        row_factory=dict_row,
    )


@contextmanager
def individual_cursor(settings: Settings) -> Iterator[psycopg.Cursor[Any]]:
    with _connect(settings, settings.db_name) as conn, conn.cursor() as cur:
        yield cur


@contextmanager
def team_cursor(settings: Settings) -> Iterator[psycopg.Cursor[Any]]:
    with _connect(settings, settings.team_db_name) as conn, conn.cursor() as cur:
        yield cur


# --- value helpers -------------------------------------------------------


def pct(numerator: Any, denominator: Any) -> float | None:
    if not denominator:
        return None
    return round(float(numerator or 0) * 100.0 / float(denominator), 1)


def ratio(numerator: Any, denominator: Any, digits: int = 2) -> float | None:
    if not denominator:
        return None
    return round(float(numerator or 0) / float(denominator), digits)


def plain(value: Any) -> Any:
    """Convert psycopg values into JSON-friendly primitives."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [plain(v) for v in value]
    return value


def rows(cur: psycopg.Cursor[Any]) -> list[dict[str, Any]]:
    return [plain(dict(row)) for row in cur.fetchall()]


def one(cur: psycopg.Cursor[Any]) -> dict[str, Any] | None:
    row = cur.fetchone()
    return plain(dict(row)) if row else None


DISCIPLINE_ORDER = {"HS": 0, "DS": 1, "HD": 2, "DD": 3, "MD": 4, "S": 5, "D": 6}
SINGLES_CODES = ("HS", "DS", "S")
DOUBLES_CODES = ("HD", "DD", "MD", "D")


def discipline_sort_key(code: str, number: int | None = None) -> tuple[int, int]:
    return (DISCIPLINE_ORDER.get(code, 99), number or 0)


def match_type_label(code: str, number: int | None) -> str:
    return f"{number}. {code}" if number else code


def result_code(won: int, lost: int) -> str:
    if won > lost:
        return "W"
    if won < lost:
        return "L"
    return "D"


def entity(name: str) -> dict[str, str]:
    return {"name": name, "slug": slugify(name)}


# --- tiny TTL cache ------------------------------------------------------

_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = threading.Lock()
CACHE_TTL_SECONDS = 600


def cached(key: str, build: Callable[[], Any]) -> Any:
    now = time.monotonic()
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = build()
    with _CACHE_LOCK:
        _CACHE[key] = (now + CACHE_TTL_SECONDS, value)
        if len(_CACHE) > 2000:
            expired = [k for k, (exp, _) in _CACHE.items() if exp <= now]
            for k in expired:
                _CACHE.pop(k, None)
    return value


def clear_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
