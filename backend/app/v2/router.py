from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from ..settings import Settings, get_settings
from .common import NotFound, cached, clear_cache, individual_cursor, player_entity, slugify
from .clubs import club_profile, list_clubs
from .compare import player_comparison, team_head_to_head
from .leaderboards import leaderboards
from .lineup import club_setup, lineup_points, lineup_setup
from .optimiser import optimise
from .leagues import group_detail, list_leagues, list_seasons, match_detail
from .players import player_profile, resolve_player
from .ranking import SourceUnavailable, player_ranking
from .search import search
from .teams import resolve_team, team_profile

router = APIRouter(prefix="/api/v2", tags=["v2"])


def _run(key: str, build, ttl: float | None = None) -> Any:
    try:
        return cached(key, build) if ttl is None else cached(key, build, ttl)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/seasons")
def seasons(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return _run("seasons", lambda: list_seasons(settings))


@router.get("/search")
def search_endpoint(
    q: str = Query(min_length=2, max_length=120),
    season: int | None = None,
    limit: int = Query(default=8, ge=1, le=30),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    q = q.strip()
    return _run(f"search:{q.lower()}:{season}:{limit}", lambda: search(settings, q, season, limit))


@router.get("/resolve")
def resolve(
    kind: str = Query(pattern="^(team|player)$"),
    slug: str = Query(min_length=1, max_length=200),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Slug to display name, so a page linked with only one side chosen can show it."""

    def build() -> dict[str, Any]:
        with individual_cursor(settings) as cur:
            if kind == "team":
                row = resolve_team(cur, slug)
                return {"name": row["team_name"], "slug": slugify(row["team_name"])}
            row = resolve_player(cur, slug)
            return player_entity(row["player_name"], row["player_id"])

    return _run(f"resolve:{kind}:{slug}", build)


@router.get("/teams/{slug}")
def team(slug: str, season: int | None = None, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return _run(f"team:{slug}:{season}", lambda: team_profile(settings, slug, season))


@router.get("/clubs")
def clubs(season: int, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """All clubs in a season with team counts, best division and record."""
    return _run(f"clubs:{season}", lambda: list_clubs(settings, season))


@router.get("/clubs/{slug}")
def club(slug: str, season: int | None = None, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """A club: its teams and their divisions and standings, the most used players, and history."""
    return _run(f"club:{slug}:{season}", lambda: club_profile(settings, slug, season))


@router.get("/players/{slug}")
def player(slug: str, season: int | None = None, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return _run(f"player:{slug}:{season}", lambda: player_profile(settings, slug, season))


@router.get("/players/{slug}/ranking")
def player_ranking_endpoint(slug: str, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """Ranking points and level from badmintonplayer.dk. Held for a day because it is
    fetched from another site; the player page loads it separately so a failure here
    never blocks the rest of the profile."""
    try:
        return _run(f"ranking:{slug}", lambda: player_ranking(settings, slug), ttl=86400)
    except HTTPException as exc:
        if isinstance(exc.__cause__, SourceUnavailable):
            raise HTTPException(status_code=503, detail="Kunne ikke hente point fra badmintonplayer.dk") from exc
        raise


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
    min_matches: int | None = Query(default=None, ge=1, le=60),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return _run(
        f"leaderboards:{season}:{division}:{min_matches}",
        lambda: leaderboards(settings, season, division, min_matches),
    )


@router.get("/lineup/setup")
def lineup_setup_endpoint(team: str = Query(min_length=1), settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """Roster, format and the club's higher team for the lineup checker."""
    return _run(f"lineup:{team}", lambda: lineup_setup(settings, team))


@router.get("/lineup/club")
def lineup_club_endpoint(team: str = Query(min_length=1), settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """All teams of a club with formats, latest lineups and a pooled roster."""
    return _run(f"lineup-club:{team}", lambda: club_setup(settings, team))


@router.post("/lineup/points")
def lineup_points_endpoint(ids: list[int] = Body(embed=True, max_length=150)) -> dict[str, Any]:
    """Current ranking points for up to 60 players, fetched from badmintonplayer.dk
    and cached per player for a day."""
    try:
        return lineup_points(ids)
    except SourceUnavailable as exc:
        raise HTTPException(status_code=503, detail="Kunne ikke hente point fra badmintonplayer.dk") from exc


@router.post("/lineup/optimise")
def lineup_optimise_endpoint(
    team: str = Body(min_length=1),
    opponent: str = Body(min_length=1),
    available: list[int] = Body(max_length=60),
    matches: int = Body(default=0),
    sex: dict[str, str] = Body(default_factory=dict),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Legal lineup with the highest expected number of won matches against an opponent."""
    overrides = {int(k): v for k, v in sex.items() if v in ("M", "F")}
    key = f"optimise:{team}:{opponent}:{matches}:{sorted(set(available))}:{sorted(overrides.items())}"
    try:
        return _run(key, lambda: optimise(settings, team, opponent, available, matches, overrides), ttl=1800)
    except HTTPException as exc:
        if isinstance(exc.__cause__, SourceUnavailable):
            raise HTTPException(status_code=503, detail="Kunne ikke hente point fra badmintonplayer.dk") from exc
        raise


@router.post("/cache/clear", include_in_schema=False)
def cache_clear() -> dict[str, str]:
    clear_cache()
    return {"status": "cleared"}
