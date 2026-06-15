# ── Stage 1: Build ───────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

RUN npm prune --production

# ── Stage 2: Runtime ─────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

RUN mkdir -p /app/exports

EXPOSE 3001
CMD ["node", "dist/main"]
