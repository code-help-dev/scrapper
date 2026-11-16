# Aajjo Scraper

## Quick start (prebuilt images)

No clone or build needed. Requires Docker with Compose v2.24+.

1. Save [docker-compose.hub.yml](docker-compose.hub.yml) as `docker-compose.yml` in an empty folder (or copy it from the Docker Hub page: https://hub.docker.com/r/qccbackenddev/aajjo-scraper-backend).
2. Optional: copy `.env.example` to `.env` and **change the secrets** (`JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `NEXTAUTH_SECRET`).
3. `docker compose up -d`
4. Open the UI at http://localhost:3000 (API: http://localhost:3001/api, Swagger: http://localhost:3001/api/docs).

- Update: `docker compose pull && docker compose up -d`
- Stop: `docker compose down` (add `-v` to also delete data)
- Data lives in named volumes: `mongo_data` (database), `redis_data` (queue), `exports_data` (exported files).

Notes
- Open the app on `localhost` with ports 3000/3001 published; the browser-side API URL is baked into the frontend image.
- Image upload to S3 is off unless you set `AWS_*` in `.env`; no credentials are in the images.
- The backend image is ~4 GB (Chromium) and amd64-only (slow under emulation on Apple Silicon).

Images: `qccbackenddev/aajjo-scraper-backend`, `qccbackenddev/aajjo-scraper-frontend`.
