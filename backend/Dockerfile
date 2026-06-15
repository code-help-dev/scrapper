FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

RUN mkdir -p /app/exports

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/main"]
