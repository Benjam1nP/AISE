# Running todo locally

## Start

    docker compose up --build

Then open http://localhost:8080

## Services

| Service | Port | Purpose |
|---------|------|---------|
| tasks | 8080 (bound to 127.0.0.1) | Todo app and API, primary service |

The named volume `data` is mounted at /data and holds the SQLite database file /data/app.db.

## Stop

    docker compose down

## Reset the data

    docker compose down -v

## Port 8080 taken

Change the published port in compose.yaml (the host side of "127.0.0.1:8080:8080", and the PORT value to match if you change both sides) and update the URL in this file.
