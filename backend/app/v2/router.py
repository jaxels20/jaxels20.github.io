from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..settings import Settings, get_settings
from .common import NotFound, cached, clear_cache
from .compare import player_comparison, team_head_to_head
from .leaderboards import leaderboards
from .leagues import group_detail, list_leagues, list_seasons, match_detail
from .players import player_profile
from .search import search
from .teams import team_profile

router = APIRouter(prefix="/api/v2", tags=["v2"])


def _run(key: str, build) -> Any:
    try:
        return cached(key, build)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/seasons")
def seasons(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return {"seasons": _run("seasons", lambda: list_seasons(settings))}


@router.get("/search")
def search_endpoint(
    q: str = Query(min_length=2, max_length=120),
    season: int | None = None,
    limit: int = Query(default=8, ge=1, le=30),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    q = q.strip()
    return _run(f"search:{q.lower()}:{season}:{limit}", lambda: search(settings, q, season, limit))


@router.get("/teams/{slug}")
def team(slug: str, season: int | None = None, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return _run(f"team:{slug}:{season}", lambda: team_profile(settings, slug, season))


@router.get("/players/{slug}")
def player(slug: str, season: int | None = None, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return _run(f"player:{slug}:{season}", lambda: player_profile(settings, slug, season))


@router.get("/h2h/teams")
def h2h_teams(
    a: str = Query(min_length=1),
    b: str = Query(min_length=1),
    season: int | None = None,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if a == b:
        raise HTTPException(status_code=400, detail="Vælg to forskellige hold")
    return _run(f"h2h:{a}:{b}:{season}", lambda: team_head_to_head(settings, a, b, season))


@router.get("/compare/players")
def compare_players(
    a: str = Query(min_length=1),
    b: str = Query(min_length=1),
    season: int | None = None,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if a == b:
        raise HTTPException(status_code=400, detail="Vælg to forskellige spillere")
    return _run(f"compare:{a}:{b}:{season}", lambda: player_comparison(settings, a, b, season))


@router.get("/leagues")
def leagues(season: int, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return _run(f"leagues:{season}", lambda: list_leagues(settings, season))


@router.get("/groups/{group_id}")
def group(group_id: int, season: int, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return _run(f"group:{season}:{group_id}", lambda: group_detail(settings, season, group_id))


@router.get("/matches/{match_id}")
def match(match_id: int, season: int, group: int, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return _run(f"match:{season}:{group}:{match_id}", lambda: match_detail(settings, season, group, match_id))


@router.get("/leaderboards")
def leaderboard(
    season: int,
    division: str | None = None,
    min_matches: int = Query(default=8, ge=1, le=60),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return _run(
        f"leaderboards:{season}:{division}:{min_matches}",
        lambda: leaderboards(settings, season, division, min_matches),
    )


@router.post("/cache/clear", include_in_schema=False)
def cache_clear() -> dict[str, str]:
    clear_cache()
    return {"status": "cleared"}
