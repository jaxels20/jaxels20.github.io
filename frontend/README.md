# Badminton Reports Frontend

React + Vite + TypeScript frontend for searching players/teams and rendering their full SQL report output.

## Stack

- React 19
- Vite
- TypeScript
- TanStack React Query

## Run locally

From this directory:

```bash
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

The Vite dev server proxies `/api` calls to:

- `http://127.0.0.1:8000`

So backend should be running before you use the app.

## Build

```bash
npm run build
```

## Production API URL

For production builds, set `VITE_API_BASE_URL` to your backend API origin (including `/api`).

Example:

```bash
VITE_API_BASE_URL=https://api.81.27.108.148.sslip.io/api npm run build
```
