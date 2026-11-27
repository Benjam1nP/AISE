# Running auction locally

## Start

    docker compose up --build

Then open http://localhost:8080 in your browser.

## Services

| Service | Port | Purpose |
| --- | --- | --- |
| api-server | 8080 | HTTP API and web page, primary service |
| live-update-server | 8081 | WebSocket live updates for browsers |

The named volume `data` is mounted at /data in api-server. It holds the SQLite database (/data/app.db) with users, items and bids.

## Stop and reset

- Stop: `docker compose down`
- Reset the data: `docker compose down -v`

## Port 8080 taken

Change the published port in compose.yaml (the left side of "127.0.0.1:8080:8080", and keep PORT in step) and update the URL in this file. If you change 8081, also change LIVE_UPDATE_SERVER_PUBLIC_URL.
