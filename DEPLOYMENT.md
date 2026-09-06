# Production Deployment (server backend + GitHub Pages frontend)

This setup serves the frontend on GitHub Pages and runs API + database on a small Hetzner Cloud server (Ubuntu, 2 vCPU / 4 GB).

- Frontend: `https://badmintonintelligence.dk/`
- Backend API: `https://api.badmintonintelligence.dk/api`
- Database: PostgreSQL in Docker on the server
- Server: `178.104.193.12` (Hetzner, Nuremberg), repo checked out at `/root/jaxels20.github.io`

## Automatic deployment on push

Both halves redeploy automatically when `main` is pushed:

- `.github/workflows/deploy-pages.yml` rebuilds the frontend and publishes it to GitHub Pages when anything under `frontend/` changes.
- `.github/workflows/deploy-backend.yml` SSHes into the server, fast-forwards the checkout to `origin/main`, runs `docker compose up -d --build`, and waits for the API health check, when anything under `backend/`, `sql/`, `deploy/`, or the root `*.py` scripts changes. It can also be run by hand from the Actions tab.

The backend workflow needs one repository secret, `DEPLOY_SSH_KEY`: the private half of a dedicated deploy key whose public half is in `/root/.ssh/authorized_keys` on the server. Set it with:

```bash
gh secret set DEPLOY_SSH_KEY < path/to/deploy_key
```

Optional repository variables `DEPLOY_HOST` and `DEPLOY_USER` override the server address and login user.

Data is **not** reloaded on deploy. To refresh a season, run the `refresh_season_data.py` command from step 4 on the server, or `--skip-collect` to reload from the committed CSVs.

## 1) Prepare the server

Use Ubuntu 22.04+ and open only ports `22`, `80`, and `443` (Hetzner Cloud Firewall or `ufw`).

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
- `API_DOMAIN=api.badmintonintelligence.dk`
- `BADMINTON_CORS_ORIGINS=https://badmintonintelligence.dk,https://www.badmintonintelligence.dk`

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
curl https://api.badmintonintelligence.dk/api/health
```

Expected:

```json
{"status":"ok"}
```

## 4) Bootstrap and refresh data warehouse

The backend container reads CSVs from `badminton_export/` in the repository.
They are committed, so a fresh clone already has them:

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
  --psql-bin psql \
  --skip-collect
```

`--skip-collect` loads the committed CSVs instead of re-downloading from badmintonplayer.dk. Run the same command with a different `--year` for additional seasons.

After a warehouse schema change, add `--rebuild` to the first year's command (it drops and recreates both warehouses), then refresh the remaining years as usual. If the CSV layout changed, regenerate the CSVs from the stored JSON first with `python rebuild_individual_csvs.py`.

## 5) Configure GitHub Pages deployment

This repository includes `.github/workflows/deploy-pages.yml`.

In GitHub repository settings:

1. Go to **Settings -> Pages** and set **Source** to **GitHub Actions**.
2. Go to **Settings -> Secrets and variables -> Actions -> Variables**.
3. Add repository variable:
   - `VITE_API_BASE_URL=https://api.badmintonintelligence.dk/api`

Push to `main` to trigger deployment.

Frontend will be available at:

- `https://badmintonintelligence.dk/`

## 5b) Custom domain DNS

The site runs on `badmintonintelligence.dk`. Add these records at the DNS provider (one.com by default):

| Type  | Name  | Value                  |
|-------|-------|------------------------|
| A     | `@`   | `185.199.108.153`      |
| A     | `@`   | `185.199.109.153`      |
| A     | `@`   | `185.199.110.153`      |
| A     | `@`   | `185.199.111.153`      |
| CNAME | `www` | `jaxels20.github.io`   |
| A     | `api` | server public IP      |

Then in GitHub **Settings -> Pages**, set **Custom domain** to `badmintonintelligence.dk` and enable **Enforce HTTPS** once the DNS check passes.

The `api` record must resolve directly to the server (not through a CDN proxy) so Caddy can complete the Let's Encrypt challenge.

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
- `Missing season CSV files`: confirm CSVs exist in `badminton_export/`, then rerun `docker compose --env-file .env up -d --build` so containers get the current volume mapping.
- `COPY ... No such file or directory`: ensure the `db` service can see `/app/badminton_export` (mounted from `../badminton_export` in `deploy/docker-compose.yml`).
