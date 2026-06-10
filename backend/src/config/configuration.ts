const num = (key: string, fallback: number) =>
  parseInt(process.env[key] ?? String(fallback), 10) || fallback;

export default () => ({
  port: num('PORT', 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/aajjo_scraper',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: num('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRY || '7d',
    refreshSecret:
      process.env.REFRESH_TOKEN_SECRET || 'dev-refresh-secret-change-in-prod',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'aajjo-scraper',
  },

  scraping: {
    maxConcurrentBrowsers: num('MAX_CONCURRENT_BROWSERS', 5),
    proxyServiceUrl: process.env.PROXY_SERVICE_URL || '',
    proxyApiKey: process.env.PROXY_API_KEY || '',
    requestDelayMin: num('REQUEST_DELAY_MIN_MS', 2000),
    requestDelayMax: num('REQUEST_DELAY_MAX_MS', 5000),
    timeout: num('SCRAPER_TIMEOUT_MS', 30000),
  },

  export: {
    downloadExpiryHours: num('EXPORT_DOWNLOAD_EXPIRY_HOURS', 48),
    storagePath: process.env.EXPORT_STORAGE_PATH || './exports',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'debug',
  },
});
