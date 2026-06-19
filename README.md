# Options Analytics Dashboard

Personal full-stack NIFTY options dashboard built with FastAPI, APScheduler, Zerodha Kite Connect, local SQLite, Next.js 14, Tailwind CSS, Recharts, and shadcn-style UI primitives.

## Overview

- Fetches NIFTY options chain data from Zerodha Kite Connect
- Stores option snapshots and PCR time series in a local SQLite database
- Computes PCR trend, strike-wise OI, support/resistance, and sentiment
- Lets you start, stop, and reconfigure the snapshot scheduler directly from the browser
- Auto-refreshes the dashboard every 30 seconds

## Prerequisites

- Python 3.11+
- Node.js 18+
- A Zerodha Kite Connect app with API key and secret

## Local Database

No external database is required. The backend creates this SQLite database automatically on startup:

```text
backend/data/options_dashboard.sqlite3
```

Set `LOCAL_DB_PATH` in `backend/.env` only if you want the database somewhere else.

## Backend Setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

Fill `backend/.env` with:

```env
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_ACCESS_TOKEN=
FRONTEND_URL=http://localhost:3000
LOCAL_DB_PATH=
```

## Zerodha Login

1. Visit `http://127.0.0.1:8001/login`
2. Complete the Zerodha login flow
3. Zerodha redirects to `/callback`
4. The backend exchanges the `request_token` for an access token and overwrites `ZERODHA_ACCESS_TOKEN` in `backend/.env`

## Seed Test Data

```bash
cd backend
python seed_historical.py
```

The seed script fetches a live NIFTY option chain once, creates 10 historical snapshots spaced 15 minutes apart, applies slight OI variation, and inserts matching PCR rows into SQLite.

## Frontend Setup

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Fill `frontend/.env.local` with:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8001
```

## One-Command Launch

After `backend/.env` and `frontend/.env.local` are set up, you can start both services from the repo root with:

```bash
chmod +x laucnh
./laucnh
```

The script:

- creates `backend/.venv` if missing
- installs backend requirements
- installs frontend packages if `node_modules` is missing
- starts the backend on `http://127.0.0.1:8001`
- starts the frontend on `http://localhost:3000`

Press `Ctrl+C` to stop both services together.

## Render Deployment

This repo now includes a root `render.yaml` Blueprint for deploying both services from the same GitHub repo:

- `options-dashboard-api`: FastAPI backend on Render `starter`
- `options-dashboard-web`: Next.js frontend on Render `free`

The backend should stay on an always-on plan because the APScheduler live collection loop runs inside the web service process. A free backend would sleep and miss scheduled runs.

### Deploy Steps

1. Push the repo to GitHub.
2. In Render, create a new Blueprint and point it at this repo.
3. Let Render create both services from `render.yaml`.
4. After the first sync, open each service and set these environment variables:

Backend:

```env
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_ACCESS_TOKEN=
FRONTEND_URL=https://<your-frontend>.onrender.com
LOCAL_DB_PATH=/app/data/options_dashboard.sqlite3
```

Frontend:

```env
NEXT_PUBLIC_API_URL=https://<your-backend>.onrender.com
```

5. Redeploy both services after setting the URLs above so CORS and redirect targets are correct.
6. In the Zerodha developer console, set the login callback URL to:

```text
https://<your-backend>.onrender.com/callback
```

### Hosted Database Persistence

SQLite is local to the backend filesystem. For hosted use, attach persistent storage or mount a volume and point `LOCAL_DB_PATH` at that volume. Without persistent storage, hosted snapshot history can disappear when the instance is rebuilt.

## Usage Notes

- The scheduler runs in-process inside FastAPI using APScheduler.
- Default interval is 15 minutes.
- `Start` first fills any missing recent 15-minute history for the selected underlying, then creates or restarts the live interval job.
- `Stop` removes the interval job but keeps the in-memory status available.
- Updating the interval while running immediately recreates the job with the new cadence.
- Zerodha access token is read from `backend/.env` first, then from the local SQLite `app_settings` table.
- Zerodha option quotes are fetched using exchange-prefixed trading symbols, while instrument discovery still starts from the NFO instruments master.
- The auth callback redirects browsers by default, but `GET /callback?request_token=...&format=json` also returns `{ "success": true, "message": "Login successful" }`.
- If the Zerodha API call fails during a scheduled run, the error is logged and the scheduler stays alive.

## API Summary

- `GET /health`
- `GET /login`
- `GET /callback?request_token=...`
- `POST /scheduler/start`
- `POST /scheduler/stop`
- `GET /scheduler/status`
- `POST /scheduler/config`
- `GET /pcr/current`
- `GET /pcr/history?limit=50`
- `GET /oi/strikes`
- `GET /oi/change`
- `GET /levels`
- `GET /sentiment`
