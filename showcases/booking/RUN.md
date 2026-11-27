# Running booking

## Start

    docker compose up --build

Then open http://localhost:8080.

## Services

| Service | Port | Notes |
|---|---|---|
| application-server | 8080 (published on 127.0.0.1) | primary service, health at /health |

The named volume `data` is mounted at /data and holds the database file /data/app.db.

## Stop and reset

- Stop: `docker compose down`
- Reset the data: `docker compose down -v`

## Port 8080 taken

Change the published port in compose.yaml (both numbers in `127.0.0.1:8080:8080`, and PORT) and in this file.

## Change before real use

- ADMIN_PASSWORD is set to `change-me-admin-password`: change before real use.
