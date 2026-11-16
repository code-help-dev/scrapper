## Quick start

1. Save as `docker-compose.yml`:

```yaml
# Save as docker-compose.yml, optionally copy .env.example to .env, then: docker compose up -d
# Open http://localhost:3000   (needs Docker Compose v2.24+)
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data

  mongo:
    image: mongo:7
    restart: unless-stopped
    volumes:
      - mongo_data:/data/db

  backend:
    image: qccbackenddev/aajjo-scraper-backend:latest
    restart: unless-stopped
    shm_size: "1gb"   # Chromium needs it
    ports:
      - "3001:3001"
    env_file:
      - path: .env
        required: false
    environment:
      PORT: "3001"
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      MONGODB_URI: mongodb://mongo:27017/aajjo_scraper
      FRONTEND_URL: http://localhost:3000
      EXPORT_STORAGE_PATH: /app/exports
    volumes:
      - exports_data:/app/exports
    depends_on:
      - redis
      - mongo

  frontend:
    image: qccbackenddev/aajjo-scraper-frontend:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      API_URL: http://backend:3001/api
      NEXTAUTH_URL: http://localhost:3000
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:-change-me-in-production}
    depends_on:
      - backend

volumes:
  redis_data:
  mongo_data:
  exports_data:
```

2. Optional: save as `.env` and change the secrets:

```env
# Copy to .env (optional: the stack starts without it, but change the secrets!)
NODE_ENV=production
LOG_LEVEL=info

# ── Auth (REQUIRED for real use: set long random strings) ──
JWT_SECRET=change-me-in-production
JWT_EXPIRY=15m
REFRESH_TOKEN_SECRET=change-me-in-production
REFRESH_TOKEN_EXPIRY=7d
NEXTAUTH_SECRET=change-me-in-production

# ── Optional: S3 / CloudFront image upload (leave blank to disable) ──
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-south-1
AWS_S3_BUCKET=
CLOUDFRONT_DOMAIN=
S3_IMAGE_PREFIX=images
S3_LOGO_PREFIX=

# ── Optional: scraping ──
MAX_CONCURRENT_BROWSERS=5
WORKER_CONCURRENCY=5
PROXY_SERVICE_URL=
PROXY_API_KEY=
REQUEST_DELAY_MIN_MS=2000
REQUEST_DELAY_MAX_MS=5000
SCRAPER_TIMEOUT_MS=30000

# ── Optional: export / monitoring ──
EXPORT_DOWNLOAD_EXPIRY_HOURS=48
SENTRY_DSN=
SLACK_WEBHOOK_URL=
```

3. `docker compose up -d`, then open http://localhost:3000

Update: `docker compose pull && docker compose up -d` · Stop: `docker compose down`

Notes: use on localhost (frontend API URL is baked in); backend image ~4 GB, amd64 only; no credentials inside images.
