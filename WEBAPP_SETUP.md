# Web App Setup (FastAPI + React)

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

## Features

- Search player and show player report
- Search team and show team report
- Season filter
- Rendered report sections + tables in web UI

## API endpoints

- `GET /api/health`
- `GET /api/seasons`
- `GET /api/search/players?q=<text>&season_id=<year>`
- `GET /api/search/teams?q=<text>&season_id=<year>`
- `POST /api/reports/player` with `{ "name": "...", "season_id": 2025 }`
- `POST /api/reports/team` with `{ "name": "...", "season_id": 2025 }`
