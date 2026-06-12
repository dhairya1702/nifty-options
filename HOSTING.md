# Hosting

Recommended setup:

- Frontend: Vercel
- Backend: Railway

This avoids the local launcher path completely. Your dad just opens a URL.

## 1. Backend on Railway

Deploy the `backend` folder as a Docker service.

Use these environment variables:

```env
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
FRONTEND_URL=https://your-frontend-domain.vercel.app
LOCAL_DB_PATH=/app/data/options_dashboard.sqlite3
```

Notes:

- Do not manually set `ZERODHA_ACCESS_TOKEN` for hosted use. The app stores the token in the local SQLite `app_settings` table after login.
- SQLite is local filesystem storage. On Railway/Render/etc., attach persistent storage and point `LOCAL_DB_PATH` at that mounted path if you want history to survive rebuilds.
- The backend health endpoint is `/health`.
- Railway should expose the service publicly over HTTPS.

After deploy, your backend URL will look like:

```text
https://your-backend.up.railway.app
```

Set your Zerodha app callback URL to:

```text
https://your-backend.up.railway.app/callback
```

## 2. Frontend on Vercel

Deploy the `frontend` folder as a Next.js project.

Set:

```env
NEXT_PUBLIC_API_URL=https://your-backend.up.railway.app
```

After deploy, your frontend URL will look like:

```text
https://your-frontend.vercel.app
```

Then set the backend `FRONTEND_URL` env var to that exact frontend URL.

## 3. Local database

No migration is needed. The backend creates the SQLite schema automatically on startup.

## 4. Real login flow after hosting

Once both frontend and backend are deployed:

1. Open the frontend URL.
2. Click login.
3. Finish Zerodha auth.
4. Zerodha redirects back to the hosted backend callback.
5. The backend stores the access token in SQLite.
6. Use `Start` from the hosted frontend.

## 5. Result

After this, your dad only needs the frontend URL.
