"""Ranking points and level from badmintonplayer.dk.

The season exports carry only a player's name and id, so points come from the same
public web service the badmintonplayer.dk profile page uses. Requests are made when
someone opens a player page and the result is cached for a day, which is far lighter
than scraping every player up front.

Only club, level and ranking points are kept. The response also contains a
BadmintonID (derived from a date of birth) and links to personal user accounts;
those are deliberately never read, stored or returned.
"""

from __future__ import annotations

import datetime as dt
import html as html_lib
import json
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..settings import Settings
from .common import NotFound, cached, individual_cursor, rows
from .players import resolve_player

BASE_URL = "https://badmintonplayer.dk"
PROFILE_PAGE = f"{BASE_URL}/DBF/Spiller/VisSpiller/"
PROFILE_SERVICE = f"{BASE_URL}/SportsResults/Components/WebService1.asmx/GetPlayerProfile"
VERSIONS_SERVICE = f"{BASE_URL}/SportsResults/Components/WebService1.asmx/GetRankingListVersions"
SINGLE_LIST_ID = 288  # any list works; the versions are shared
USER_AGENT = "Mozilla/5.0 (compatible; badmintonintelligence.dk/1.0; +https://badmintonintelligence.dk)"
TIMEOUT = 20

CALLBACK_RE = re.compile(r"SR_CallbackContext\s*=\s*'([^']+)'")
LEVEL_RE = re.compile(r"Tilmeldingsniveau ved s&#230;sonstart:\s*&nbsp;</h3></td><td><h3>(\d+)</h3>")
LIST_ROW_RE = re.compile(
    r"<tr><td><a href='/DBF/Ranglister/#\d+'[^>]*>([^<]+)</a></td><td></td><td>([^<]*)</td>(.*?)(?=<tr>|</table>)",
    re.S,
)
NUMBER_RE = re.compile(r">(\d+)</a></td>|<td style='text-align:right;'>(\d+)</td>")

_callback: tuple[float, str] | None = None
_callback_lock = threading.Lock()


class SourceUnavailable(Exception):
    """badmintonplayer.dk could not be reached or answered unexpectedly."""


def current_season() -> int:
    """Season 2025 runs Sep 2025 to Apr 2026, so the autumn starts a new one."""
    today = dt.date.today()
    return today.year if today.month >= 8 else today.year - 1


def profile_url(player_id: int) -> str:
    return f"{BASE_URL}/DBF/Spiller/VisSpiller/#{player_id}"


def _callback_key(refresh: bool = False) -> str:
    """The page hands out a token that the web service requires. It is stable for a
    while, so fetch it once and reuse it until a call is rejected."""
    global _callback
    with _callback_lock:
        if not refresh and _callback and _callback[0] > time.monotonic():
            return _callback[1]
    request = urllib.request.Request(PROFILE_PAGE, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310
            page = response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SourceUnavailable(str(exc)) from exc
    match = CALLBACK_RE.search(page)
    if not match:
        raise SourceUnavailable("no callback token on the profile page")
    with _callback_lock:
        _callback = (time.monotonic() + 1800, match.group(1))
    return match.group(1)


def _fetch_profile(season: int, player_id: int, key: str) -> dict[str, Any]:
    body = json.dumps(
        {
            "callbackcontextkey": key,
            "seasonid": season,
            "playerid": player_id,
            "getplayerdata": True,
            "showUserProfile": False,
            "showheader": True,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        PROFILE_SERVICE,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8", errors="replace"))["d"]


def _parse(payload: dict[str, Any]) -> dict[str, Any]:
    markup = payload.get("Html") or ""
    level_match = LEVEL_RE.search(markup)
    lists = []
    for name, group, rest in LIST_ROW_RE.findall(markup):
        numbers = [int(a or b) for a, b in NUMBER_RE.findall(rest)]
        if not numbers:
            continue  # the "Tilmeldingsniveau" row carries no points of its own
        lists.append(
            {
                "list": html_lib.unescape(name).replace("Rangliste ", "").strip(),
                "group": html_lib.unescape(group).strip() or None,
                "points": numbers[0],
                "matches": numbers[1] if len(numbers) > 1 else None,
                "place": numbers[2] if len(numbers) > 2 else None,
            }
        )
    return {
        "club": payload.get("clubname") or None,
        "level": int(level_match.group(1)) if level_match else None,
        "lists": lists,
    }


def _season_snapshot(season: int, player_id: int) -> dict[str, Any]:
    key = _callback_key()
    try:
        payload = _fetch_profile(season, player_id, key)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, KeyError, ValueError):
        # A stale token is the usual cause; take a fresh one and try once more.
        payload = _fetch_profile(season, player_id, _callback_key(refresh=True))
    return {"seasonId": season, **_parse(payload)}


def player_ranking(settings: Settings, slug: str) -> dict[str, Any]:
    with individual_cursor(settings) as cur:
        player = resolve_player(cur, slug)
        if not player.get("player_id"):
            raise NotFound("Spilleren har intet badmintonplayer.dk-id")
        cur.execute("SELECT season_id FROM dim_season ORDER BY season_id")
        # Ranking lists only exist for the season in progress, which the warehouse may
        # not have loaded yet, so ask for it even when it is missing locally.
        seasons = sorted({r["season_id"] for r in rows(cur)} | {current_season()})

    player_id = player["player_id"]
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            snapshots = list(pool.map(lambda s: _season_snapshot(s, player_id), seasons))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, SourceUnavailable, KeyError, ValueError) as exc:
        raise SourceUnavailable(str(exc)) from exc

    snapshots.sort(key=lambda s: s["seasonId"])
    current = next((s for s in reversed(snapshots) if s["lists"]), None)
    club = next((s["club"] for s in reversed(snapshots) if s["club"]), None)

    return {
        "player": {"name": player["player_name"], "id": player_id},
        "profileUrl": profile_url(player_id),
        "club": club,
        "currentSeasonId": current["seasonId"] if current else None,
        "lists": current["lists"] if current else [],
        "levels": [{"seasonId": s["seasonId"], "level": s["level"]} for s in snapshots if s["level"] is not None],
        "rankingList": ranking_list_status(),
    }


# --- which ranking list is in force -----------------------------------------

MONTHS_DA = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"]


def _parse_version_date(text: str) -> dt.date | None:
    m = re.match(r"^(\d{2})-(\d{2})-(\d{4})", text)
    return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def _valid_window(published: dt.date) -> tuple[dt.date, dt.date]:
    """§38 stk. 1 a: the first list published in a month applies from the 10th of that
    month up to and including the 9th of the next."""
    start = published.replace(day=10)
    nxt = (published.replace(day=1) + dt.timedelta(days=32)).replace(day=9)
    return start, nxt


def ranking_list_status() -> dict[str, Any]:
    """The date of the latest daily ranking update (which the points on this site use)
    and the monthly list the regulation applies today. Cached for six hours."""

    def build() -> dict[str, Any]:
        key = _callback_key()
        body = json.dumps({"callbackcontextkey": key, "rankinglistagegroupid": None, "rankinglistid": SINGLE_LIST_ID,
                           "seasonid": current_season()}).encode("utf-8")
        request = urllib.request.Request(
            VERSIONS_SERVICE, data=body,
            headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310
            versions = json.loads(response.read().decode("utf-8", errors="replace"))["d"].get("Versions") or []

        dated = []
        for v in versions:
            date = _parse_version_date(v.get("Text") or "")
            if date:
                dated.append((date, (v.get("Text") or "")[11:].strip()))
        dated.sort(reverse=True)
        monthly = [(date, name) for date, name in dated if name]
        today = dt.date.today()

        def describe(date: dt.date, name: str) -> dict[str, Any]:
            start, end = _valid_window(date)
            return {"name": name, "published": date.isoformat(), "validFrom": start.isoformat(), "validTo": end.isoformat()}

        applicable = next((describe(d, n) for d, n in monthly if _valid_window(d)[0] <= today <= _valid_window(d)[1]), None)
        upcoming = next((describe(d, n) for d, n in sorted(monthly) if _valid_window(d)[0] > today), None)
        if applicable is None and monthly:
            # Before the 10th at the start of a season the previous month's list, from the
            # old season, is the one in force; name it even though its points are not here.
            prev = today.replace(day=1) - dt.timedelta(days=1)
            applicable = {"name": f"{MONTHS_DA[prev.month - 1].capitalize()}-ranglisten", "published": None,
                          "validFrom": prev.replace(day=10).isoformat(), "validTo": today.replace(day=9).isoformat()
                          if today.day <= 9 else None}
        return {
            "latestUpdate": dated[0][0].isoformat() if dated else None,
            "applicable": applicable,
            "upcoming": upcoming,
            "checkedAt": today.isoformat(),
        }

    try:
        return cached("ranking-list-status", build, ttl=6 * 3600)
    except Exception:  # noqa: BLE001 - purely informational; never block the caller
        return {"latestUpdate": None, "applicable": None, "upcoming": None, "checkedAt": dt.date.today().isoformat()}
