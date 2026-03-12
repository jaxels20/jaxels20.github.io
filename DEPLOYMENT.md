# Production Deployment (Droplet backend + GitHub Pages frontend)

This setup serves the frontend on GitHub Pages and runs API + database on your Droplet.

- Frontend: `https://jaxels20.github.io/`
- Backend API: `https://api.81.27.108.148.sslip.io/api`
- Database: PostgreSQL in Docker on the Droplet

## 1) Prepare the Droplet

Use Ubuntu 22.04+ and open only ports `22`, `80`, and `443`.

Install Docker + Compose plugin:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in once so docker group membership is active.

## 2) Clone repo and configure environment

```bash
git clone git@github.com:jaxels20/jaxels20.github.io.git
cd jaxels20.github.io
cp deploy/.env.example deploy/.env
```

Edit `deploy/.env` and set secure passwords.

Minimum values to set:

- `POSTGRES_PASSWORD`
- `PGPASSWORD` (same value as `POSTGRES_PASSWORD`)
- `API_DOMAIN=api.81.27.108.148.sslip.io`
- `BADMINTON_CORS_ORIGINS=https://jaxels20.github.io`

## 3) Start database + backend + HTTPS reverse proxy

From `deploy/`:

```bash
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
```

This starts:

- `db` (`postgres:16-alpine`)
- `backend` (FastAPI + psql client)
- `caddy` (auto HTTPS + reverse proxy)

Check backend health:

```bash
curl https://api.81.27.108.148.sslip.io/api/health
```

Expected:

```json
{"status":"ok"}
```

## 4) Bootstrap and refresh data warehouse

The backend container reads CSVs from `badminton_export/` in the repository.
Make sure those files exist on the Droplet before running refresh:

```bash
ls badminton_export/season_2025_all_groups_team_matches.csv
ls badminton_export/season_2025_all_groups_individual_matches.csv
```

Run season import from `deploy/`:

```bash
docker compose --env-file .env run --rm backend \
  python refresh_season_data.py \
  --year 2025 \
  --db-host db \
  --db-port 5432 \
  --db-user postgres \
  --psql-bin psql
```

Run the same command with a different `--year` for additional seasons.

## 5) Configure GitHub Pages deployment

This repository includes `.github/workflows/deploy-pages.yml`.

In GitHub repository settings:

1. Go to **Settings -> Pages** and set **Source** to **GitHub Actions**.
2. Go to **Settings -> Secrets and variables -> Actions -> Variables**.
3. Add repository variable:
   - `VITE_API_BASE_URL=https://api.81.27.108.148.sslip.io/api`

Push to `main` to trigger deployment.

Frontend will be available at:

- `https://jaxels20.github.io/`

## 6) Ongoing operations

From `deploy/`:

```bash
docker compose --env-file .env logs -f backend
docker compose --env-file .env pull
docker compose --env-file .env up -d --build
```

Recommended:

- Keep `deploy/.env` private.
- Back up PostgreSQL volume (`postgres_data`) regularly.
- Add a cron job for periodic `refresh_season_data.py` runs.

## Troubleshooting

- `database "badminton_dw_individual" does not exist`: run `refresh_season_data.py` once to bootstrap the warehouse database.
- `Missing season CSV files`: confirm CSVs exist in `badminton_export/`, then rerun `docker compose --env-file .env up -d --build` so backend has the current volume mapping.
