# Web App Setup (FastAPI + React)

For production deployment (Droplet backend + GitHub Pages frontend), see `DEPLOYMENT.md`.

This repository now includes:

- Backend API: `backend/app/main.py` (FastAPI)
- Frontend app: `frontend/` (React + Vite + TypeScript)

## 1) Start Backend

Install Python dependencies (inside your existing venv):

```bash
.venv/bin/pip install -r backend/requirements.txt
```

Run API server:

```bash
.venv/bin/python -m uvicorn backend.app.main:app --reload --port 8000
```

Optional environment variables:

- `BADMINTON_DB_NAME` (default: `badminton_dw_individual`)
- `BADMINTON_DB_HOST` (default: `/tmp`)
- `BADMINTON_DB_PORT` (optional)
- `BADMINTON_DB_USER` (optional)
- `BADMINTON_PSQL_BIN` (default auto-detects `psql` / `psql-18`)

## 2) Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:5173`

The backend reads two warehouse databases: `badminton_dw_individual` (individual matches) and
`badminton_dw_team` (team matches with official points). Both are created by `refresh_season_data.py`.
Override the second with `BADMINTON_TEAM_DB_NAME`.

## Pages (Danish UI)

- `/` search-first home with league shortcuts and leaderboard teasers
- `/hold/:slug` team profile, `/spillere/:slug` player profile (`?saeson=2025` or `?saeson=alle`)
- `/hold-mod-hold?a=&b=` team head-to-head, `/spiller-mod-spiller?a=&b=` player comparison
- `/ligaer/:season` divisions and groups, `/ligaer/:season/:groupId` standings + rounds
- `/kampe/:season/:groupId/:matchId` team match detail with every individual match
- `/toplister` leaderboards (season, division and minimum-matches filters)

Team slugs are derived from names: lower-case, `æ/ø/å` -> `ae/oe/aa`, everything else -> `-`.
Player slugs add the badmintonplayer.dk player id as a suffix (`thomas-jensen-73557`), because
several different people can share a name. A player slug without an id resolves to the most active
player with that name.

## API endpoints (v2, JSON)

- `GET /api/health`
- `GET /api/v2/seasons` (also returns `dataUpdated` and `latestMatch`)
- `GET /api/v2/search?q=<text>&season=<year>&limit=8` (teams + players)
- `GET /api/v2/resolve?kind=team|player&slug=<slug>` (slug to display name)
- `GET /api/v2/teams/{slug}?season=<year>`
- `GET /api/v2/players/{slug}?season=<year>`
- `GET /api/v2/players/{slug}/ranking` (ranking points and level, fetched live from
  badmintonplayer.dk and cached for a day; only club, level and points are kept, never
  the BadmintonID or linked user accounts)
- `GET /api/v2/h2h/teams?a=<slug>&b=<slug>&season=<year>`
- `GET /api/v2/compare/players?a=<slug>&b=<slug>&season=<year>`
- `GET /api/v2/leagues?season=<year>`
- `GET /api/v2/groups/{league_group_id}?season=<year>`
- `GET /api/v2/matches/{match_id}?season=<year>&group=<league_group_id>`
- `GET /api/v2/leaderboards?season=<year>&division=<name>&min_matches=<n>` (omit `min_matches` to scale it to the season's progress)

Responses are cached in-process for 10 minutes; `POST /api/v2/cache/clear` empties the cache after a data reload.
The legacy psql-report endpoints under `/api/reports/*` still exist but are no longer used by the frontend.
