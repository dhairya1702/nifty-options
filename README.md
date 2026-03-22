# Options Analytics Dashboard

Personal full-stack NIFTY options dashboard built with FastAPI, APScheduler, Zerodha Kite Connect, Supabase, Next.js 14, Tailwind CSS, Recharts, and shadcn-style UI primitives.

## Overview

- Fetches NIFTY options chain data from Zerodha Kite Connect
- Stores option snapshots and PCR time series in Supabase
- Computes PCR trend, strike-wise OI, support/resistance, and sentiment
- Lets you start, stop, and reconfigure the snapshot scheduler directly from the browser
- Auto-refreshes the dashboard every 30 seconds

## Prerequisites

- Python 3.11+
- Node.js 18+
- A Supabase project
- A Zerodha Kite Connect app with API key and secret

## Supabase Setup

Run the following SQL in the Supabase SQL editor:

```sql
create extension if not exists pgcrypto;

create table if not exists option_snapshots (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz not null default now(),
  underlying text not null,
  expiry date,
  tradingsymbol text,
  instrument_token bigint,
  strike_price float8 not null,
  option_type text not null check (option_type in ('CE', 'PE')),
  oi float8 not null,
  ltp float8 not null
);

create index if not exists option_snapshots_timestamp_idx
  on option_snapshots (underlying, timestamp desc);

create index if not exists option_snapshots_strike_idx
  on option_snapshots (underlying, strike_price, option_type, timestamp desc);

create unique index if not exists option_snapshots_identity_idx
  on option_snapshots (underlying, timestamp, expiry, strike_price, option_type);

create table if not exists pcr_timeseries (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz not null default now(),
  underlying text not null,
  expiry date,
  total_call_oi float8 not null,
  total_put_oi float8 not null,
  pcr float8 not null
);

create index if not exists pcr_timeseries_timestamp_idx
  on pcr_timeseries (underlying, timestamp desc);

create unique index if not exists pcr_timeseries_identity_idx
  on pcr_timeseries (underlying, timestamp);
```

If you already created the tables earlier, apply an `ALTER TABLE` migration to add `expiry`, `tradingsymbol`, and `instrument_token`, plus the unique indexes above, before using the hardened catch-up/upsert path.

## Backend Setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

Fill `backend/.env` with:

```env
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_ACCESS_TOKEN=
SUPABASE_URL=
SUPABASE_KEY=
FRONTEND_URL=http://localhost:3000
```

## Zerodha Login

1. Visit `http://localhost:8000/login`
2. Complete the Zerodha login flow
3. Zerodha redirects to `/callback`
4. The backend exchanges the `request_token` for an access token and overwrites `ZERODHA_ACCESS_TOKEN` in `backend/.env`

## Seed Test Data

```bash
cd backend
python seed_historical.py
```

The seed script fetches a live NIFTY option chain once, creates 10 historical snapshots spaced 15 minutes apart, applies slight OI variation, and inserts matching PCR rows.

## Frontend Setup

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Fill `frontend/.env.local` with:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## One-Click Launch

For a non-technical user on macOS:

- Double-click `Options Dashboard.app`
- The launcher will:
  - create a Python virtual environment if needed
  - install backend and frontend dependencies if needed
  - build the frontend if the app changed
  - start backend and frontend in the background
  - open the dashboard in the browser

To stop both services later, double-click `Stop Options Dashboard.app`.

Fallback launchers are also available as `start_dashboard.command` and `stop_dashboard.command`.

Important:

- `backend/.env` must already contain your Zerodha and Supabase credentials.
- The launcher will attempt to install Python 3 and Node.js automatically if they are missing.
- On a brand-new Mac, macOS may still ask for approval to install Apple Command Line Tools or Homebrew once.

## Usage Notes

- The scheduler runs in-process inside FastAPI using APScheduler.
- Default interval is 15 minutes.
- `Start` first fills any missing recent 15-minute history for the selected underlying, then creates or restarts the live interval job.
- `Stop` removes the interval job but keeps the in-memory status available.
- Updating the interval while running immediately recreates the job with the new cadence.
- Zerodha access token is read from `backend/.env` at request time, so a successful login updates future requests without restarting FastAPI.
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
