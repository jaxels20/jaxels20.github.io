from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .db import fetch_seasons, search_players, search_teams
from .report_service import run_report_script
from .settings import Settings, get_settings


class ReportRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    season_id: int | None = None


class TeamHeadToHeadReportRequest(BaseModel):
    team_a: str = Field(min_length=2, max_length=120)
    team_b: str = Field(min_length=2, max_length=120)
    season_id: int | None = None


class SearchResponse(BaseModel):
    results: list[dict[str, Any]]


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/seasons")
    def seasons(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
        try:
            rows = fetch_seasons(settings)
            return {"results": rows}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/search/players", response_model=SearchResponse)
    def search_player_names(
        q: str = Query(min_length=2, max_length=120),
        season_id: int | None = None,
        limit: int = Query(default=10, ge=1, le=50),
        settings: Settings = Depends(get_settings),
    ) -> SearchResponse:
        try:
            rows = search_players(settings, query=q, season_id=season_id, limit=limit)
            return SearchResponse(results=rows)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/search/teams", response_model=SearchResponse)
    def search_team_names(
        q: str = Query(min_length=2, max_length=120),
        season_id: int | None = None,
        limit: int = Query(default=10, ge=1, le=50),
        settings: Settings = Depends(get_settings),
    ) -> SearchResponse:
        try:
            rows = search_teams(settings, query=q, season_id=season_id, limit=limit)
            return SearchResponse(results=rows)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/reports/player")
    def player_report(
        payload: ReportRequest,
        settings: Settings = Depends(get_settings),
    ) -> dict[str, Any]:
        try:
            return run_report_script(
                report_type="player",
                name=payload.name,
                name_b=None,
                season_id=payload.season_id,
                settings=settings,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/reports/team")
    def team_report(
        payload: ReportRequest,
        settings: Settings = Depends(get_settings),
    ) -> dict[str, Any]:
        try:
            return run_report_script(
                report_type="team",
                name=payload.name,
                name_b=None,
                season_id=payload.season_id,
                settings=settings,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/reports/team-h2h")
    def team_head_to_head_report(
        payload: TeamHeadToHeadReportRequest,
        settings: Settings = Depends(get_settings),
    ) -> dict[str, Any]:
        if payload.team_a.strip().lower() == payload.team_b.strip().lower():
            raise HTTPException(
                status_code=400, detail="Team A and Team B must be different"
            )

        try:
            return run_report_script(
                report_type="team_h2h",
                name=payload.team_a,
                name_b=payload.team_b,
                season_id=payload.season_id,
                settings=settings,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return app


app = create_app()
