# Aajjo Web Scraper — Architecture & System Design

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [High-Level Architecture](#3-high-level-architecture)
4. [System Flow](#4-system-flow)
5. [Backend Architecture](#5-backend-architecture)
   - 5.1 [Module Structure](#51-module-structure)
   - 5.2 [Database Design](#52-database-design)
   - 5.3 [Queue & Worker System](#53-queue--worker-system)
   - 5.4 [Scraping Pipeline](#54-scraping-pipeline)
   - 5.5 [Data Extraction & Normalization](#55-data-extraction--normalization)
   - 5.6 [Image Processing](#56-image-processing)
   - 5.7 [Export Pipeline](#57-export-pipeline)
   - 5.8 [Authentication & Authorization](#58-authentication--authorization)
   - 5.9 [API Surface](#59-api-surface)
6. [Frontend Architecture](#6-frontend-architecture)
   - 6.1 [Page Structure](#61-page-structure)
   - 6.2 [State Management & Data Fetching](#62-state-management--data-fetching)
   - 6.3 [API Client Layer](#63-api-client-layer)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Configuration & Environment](#8-configuration--environment)
9. [Key Design Decisions](#9-key-design-decisions)

---

## 1. Project Overview

This is a **full-stack web scraping platform** purpose-built for extracting structured product data from [aajjo.com](https://aajjo.com) — an Indian B2B marketplace. Users submit URLs (single or bulk CSV), the system scrapes product details using a headless browser, normalizes the data, processes images, and makes everything available for download in multiple export formats.

**Core capabilities:**
- Submit single URLs or bulk CSV files (up to 500 URLs)
- Queue-based async scraping with real-time status updates via Server-Sent Events
- Stealth browser automation to avoid bot detection
- Structured extraction of: product name, price, MOQ, specs, images, seller info
- YAML-driven field normalization and unit conversion
- Image download, deduplication (perceptual hashing), resize, and Cloudinary upload
- Export in CSV, XLSX, JSON, Shopify CSV, WooCommerce XML formats
- Role-based multi-user access (Admin / Operator / Viewer)

---

## 2. Tech Stack

### Backend

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | [NestJS](https://nestjs.com) (Node.js) | Opinionated structure with Dependency Injection, decorators, modules — prevents spaghetti code in a multi-service app. TypeScript-first. |
| **Database** | [MongoDB](https://mongodb.com) via Mongoose | Product data is semi-structured (varying specs per product). A document store fits better than a rigid relational schema. Flexible arrays for specifications and images. |
| **Queue** | [BullMQ](https://bullmq.io) + [Redis](https://redis.io) | Async, distributed job queues with retry logic, exponential backoff, and concurrency control. Redis persistence means jobs survive server restarts. |
| **Browser Automation** | [Playwright](https://playwright.dev) | More reliable than Puppeteer for modern SPAs. Supports Chromium, Firefox, WebKit. Used with `playwright-extra` + Stealth plugin. |
| **Bot Evasion** | `playwright-extra` + `puppeteer-extra-plugin-stealth` | Patches browser fingerprints (navigator, WebGL, canvas) so Playwright appears as a real user browser. Prevents Cloudflare / CAPTCHA blocks. |
| **Image Processing** | [Sharp](https://sharp.pixelplumbing.com) | High-performance Node.js image processing (resize, format conversion). Written in C++ via libvips — much faster than pure-JS alternatives. |
| **Image Storage** | [Cloudinary](https://cloudinary.com) | Managed image CDN with transformation URLs. Avoids managing raw files. |
| **Image Deduplication** | `image-hash` (perceptual hashing) | pHash detects visually identical images even if re-encoded or resized — prevents storing duplicate product images. |
| **Auth** | JWT + Passport.js + bcryptjs | Stateless authentication. Passport strategies (local + JWT) integrate natively with NestJS guards. Refresh token rotation for session longevity. |
| **Export** | ExcelJS + csv-stringify + xmlbuilder2 | ExcelJS handles complex XLSX with multiple sheets. xmlbuilder2 generates valid WooCommerce XML. csv-stringify is streaming-friendly for large exports. |
| **Logging** | nestjs-pino / pino | Structured JSON logging with zero overhead in production. Pino is the fastest Node.js logger available. |
| **Validation** | class-validator + class-transformer | Declarative DTO validation with decorators. Integrates with NestJS `ValidationPipe` globally. |
| **Config** | `@nestjs/config` + YAML | Typed configuration with environment variable overrides. Field mappings in YAML for easy editing without redeployment. |
| **API Docs** | Swagger (`@nestjs/swagger`) | Auto-generated from decorators. Available at `/api/docs`. |

### Frontend

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | [Next.js 14](https://nextjs.org) (App Router) | React with server components, file-based routing, built-in API routes. App Router enables layouts, loading states, and streaming out of the box. |
| **Auth** | [NextAuth.js](https://next-auth.js.org) | Handles JWT sessions, refresh, and provider abstraction for Next.js. `CredentialsProvider` calls the backend `/auth/login`. |
| **Server State** | [TanStack Query](https://tanstack.com/query) | Cache-aware data fetching. Handles background refetch, stale-while-revalidate, and mutations without manual loading/error boilerplate. |
| **Client State** | [Zustand](https://zustand-demo.pmnd.rs) | Lightweight global state for UI state (sidebar open, filters). Avoids Redux boilerplate for simple shared state. |
| **Forms** | React Hook Form + Zod | Performant uncontrolled form handling. Zod schemas shared between form validation and TypeScript types. |
| **UI Components** | [shadcn/ui](https://ui.shadcn.com) + Radix UI | Unstyled, accessible Radix primitives with Tailwind styling. Components live in the repo (not a dependency) so they can be customized. |
| **Styling** | [Tailwind CSS](https://tailwindcss.com) | Utility-first CSS. No naming/specificity issues. Co-located with components. |
| **HTTP Client** | Axios | Interceptors for auto-attaching Bearer tokens and 401 handling. Easier than `fetch` for complex request/response transformations. |
| **Charts** | Recharts | React-native chart library for the stats/dashboard page. |
| **Notifications** | Sonner | Lightweight, customizable toast notifications. |

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          User's Browser                               │
│                     Next.js Frontend (Port 4000)                      │
│   Login → Submit URL → View Jobs → View Products → Export Data        │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTP / SSE
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    NestJS REST API (Port 3000)                         │
│                                                                        │
│  ┌─────────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │  Auth Module │  │ URL Input │  │  Jobs    │  │    Products     │  │
│  │  JWT + RBAC  │  │ Controller│  │Controller│  │   Controller    │  │
│  └─────────────┘  └─────┬─────┘  └────┬─────┘  └────────┬────────┘  │
│                          │ enqueue     │ query           │ query      │
└──────────────────────────┼─────────────┼─────────────────┼───────────┘
                           │             │                 │
             ┌─────────────▼──┐    ┌─────▼──────┐    ┌────▼───────────┐
             │  BullMQ Queue  │    │  MongoDB   │    │   MongoDB      │
             │  (Redis-backed)│    │  (Jobs)    │    │  (Products)    │
             │                │    └────────────┘    └────────────────┘
             │ ┌────────────┐ │
             │ │ Extraction │ │
             │ │  Worker    │ │
             │ └─────┬──────┘ │
             │       │        │
             │ ┌─────▼──────┐ │
             │ │  Image     │ │
             │ │  Worker    │ │
             │ └─────┬──────┘ │
             │       │        │
             │ ┌─────▼──────┐ │
             │ │  Export    │ │
             │ │  Worker    │ │
             │ └────────────┘ │
             └────────────────┘
                    │            │
             ┌──────▼──┐   ┌────▼──────────┐
             │Playwright│   │  Cloudinary   │
             │ Browser  │   │  (Images CDN) │
             │  (Aajjo) │   └───────────────┘
             └──────────┘
```

---

## 4. System Flow

### 4.1 Single URL Scrape Flow

```
User
  │
  ├─ 1. POST /jobs  { url: "https://aajjo.com/..." }
  │
  ▼
url-input.controller.ts
  │
  ├─ 2. Validate URL (must be aajjo.com domain)
  ├─ 3. Create ExtractionJob document in MongoDB  (status: QUEUED)
  ├─ 4. Add job to BullMQ `extraction` queue
  └─ 5. Return { jobId, status: "queued" }
                    │
                    │  (async, off the HTTP request)
                    ▼
extraction.processor.ts  (BullMQ Worker)
  │
  ├─ 6.  Update job status → PROCESSING
  ├─ 7.  Acquire Playwright browser from pool
  ├─ 8.  scraper.service.loadPage(url)
  │         ├─ Apply stealth patches
  │         ├─ Navigate to URL, wait for network idle
  │         ├─ Auto-scroll to trigger lazy-loads
  │         └─ Detect CAPTCHA / returns ScrapedPage
  │
  ├─ 9.  extractor.service.extractProduct(page, url)
  │         ├─ Run CSS selector chains for each field
  │         ├─ Score confidence per field (100→40)
  │         ├─ Parse price (₹/$/€ detection)
  │         ├─ Extract MOQ from text patterns
  │         └─ Returns ExtractedProduct
  │
  ├─ 10. normalization.service.normalize(product)
  │         ├─ Map raw field names via field-mapping.yaml
  │         └─ Convert units (g→kg, mm→cm, etc.)
  │
  ├─ 11. Save Product document to MongoDB
  ├─ 12. Update ExtractionJob: status → COMPLETED, productIds[]
  │
  └─ 13. For each image URL:
            Enqueue to `image` BullMQ queue
                    │
                    ▼
image.processor.ts
  ├─ 14. Download image bytes
  ├─ 15. Validate dimensions (min 200×200px)
  ├─ 16. Compute pHash (16-bit perceptual hash)
  ├─ 17. Check for duplicates in MongoDB
  ├─ 18. Resize to thumbnail (300px width) via Sharp
  ├─ 19. Upload original + thumbnail to Cloudinary
  └─ 20. Update Product.images[] with storageUrl, thumbnailUrl, pHash
```

### 4.2 Bulk URL Submission Flow

```
User
  └─ POST /jobs/bulk  (multipart/form-data: CSV file)
        │
        ├─ Parse CSV, extract up to 500 URLs
        ├─ Create one parent ExtractionJob (type: BULK)
        └─ Enqueue each URL as a child job
              │  (parentJobId links them)
              └─ Each child follows the Single URL flow above
                 Parent job counts processedCount/failedCount
                 as children complete
```

### 4.3 Category Discovery Flow

```
User submits a category page URL (e.g. /electronics/)
  │
extraction.processor.ts
  ├─ Detect: page is a listing (not a product)
  ├─ Find all product links on the page
  ├─ Create parent ExtractionJob (type: DISCOVERY)
  └─ Enqueue each product link as child job
        └─ Each child follows Single URL flow
```

### 4.4 Real-Time Job Monitoring (SSE)

```
Frontend (jobs/[id]/page.tsx)
  │
  └─ Connect to GET /jobs/:id/events  (text/event-stream)
        │
        jobs.controller.ts
          └─ Emit job status every 2 seconds until terminal state
               (COMPLETED / FAILED)
               Includes: status, processedCount, failedCount, productIds
```

### 4.5 Export Flow

```
User selects filters + format on /export page
  │
  ├─ POST /export  { format: "xlsx", filters: { category, dateFrom, ... } }
  │
  export.controller.ts
    ├─ Create ExportJob in MongoDB
    └─ Enqueue to `export` BullMQ queue
                │
                ▼
export.processor.ts
  ├─ Query MongoDB with filters
  ├─ Generate file (CSV / XLSX / JSON / Shopify CSV / WooCommerce XML)
  ├─ Upload to S3 (or store locally)
  ├─ Update ExportJob: status → COMPLETED, fileUrl, expiresAt (+48h)
                │
Frontend polls GET /export/:id
  └─ Shows download link when status === COMPLETED
```

---

## 5. Backend Architecture

### 5.1 Module Structure

NestJS organizes code into **feature modules**. Each module encapsulates a domain and declares what it exports for other modules to consume. This prevents circular dependencies and enforces clean boundaries.

```
backend/src/
├── main.ts                   Bootstrap: HTTP server, global pipes, Swagger, CORS
├── app.module.ts             Root module: imports all feature modules
├── config/
│   └── configuration.ts     Typed env config factory
├── common/
│   ├── decorators/           @CurrentUser(), @Roles()
│   ├── enums/                JobStatus, ExtractionStatus, ExportFormat, UserRole
│   └── guards/               JwtAuthGuard, RolesGuard
└── modules/
    ├── auth/                 Login, register, JWT issue/refresh
    ├── users/                User CRUD, password hashing
    ├── admin/                Admin-only user management
    ├── database/             Mongoose module + all schema providers
    │   └── schemas/          user, product, category, extraction-job, export-job, seller
    ├── url-input/            POST /jobs entry point, CSV parsing
    ├── jobs/                 Job listing, detail, SSE stream, pause/resume/cancel
    ├── scraper/              Playwright browser pool + page loader
    ├── extractor/            CSS selector-based data extraction
    ├── normalization/        YAML field mapping + unit conversion
    ├── image/                Download → hash → resize → Cloudinary
    ├── queue/                BullMQ setup + 3 processors
    │   └── processors/       extraction.processor, image.processor, export.processor
    ├── products/             Product listing, filtering, detail
    ├── sellers/              Seller listing, search, detail
    ├── export/               Export job creation + file generation
    ├── cache/                Redis-backed response caching (5min/30s TTLs)
    ├── dashboard/            Aggregated stats endpoint
    ├── health/               GET /health liveness check
    └── _sys/                 Internal system/debug endpoints
```

### 5.2 Database Design

All schemas live in `backend/src/modules/database/schemas/`. MongoDB is used as the document store via Mongoose.

#### Product Schema
The central entity. Stores all extracted data.

```
Product {
  productName:          string (required, unique per sourceUrl)
  category:             string
  subCategory:          string
  price:                number
  currency:             string  (INR / USD / EUR)
  moq:                  number  (minimum order quantity)
  description:          string
  deliveryInformation:  string
  warrantyInformation:  string

  specifications: [{
    name:        string   (normalized key)
    value:       string
    rawName:     string   (original from page)
    section:     string   (e.g. "Technical Details")
    confidence:  number   (0-100)
  }]

  images: [{
    originalUrl:        string
    storageUrl:         string   (Cloudinary URL)
    cloudinaryPublicId: string
    thumbnailUrl:       string
    isFeatured:         boolean
    width, height:      number
    sizeBytes:          number
    pHash:              string   (perceptual hash for deduplication)
    format:             string
  }]

  seller: {
    sellerName:     string
    sellerProfile:  string
    contactInfo:    string
    location:       string
  }

  extractionStatus:  enum (PENDING / PROCESSING / COMPLETED / FAILED)
  confidenceScore:   number (0-100, average of field confidences)
  isFlagged:         boolean
  sourceUrl:         string
  sourcePlatform:    string  (aajjo)
  contentHash:       string  (MD5 of page content for change detection)
  ownedBy:           ObjectId → User

  Indexes: status, category, confidenceScore, isFlagged, createdAt, seller.sellerName
}
```

#### ExtractionJob Schema
Tracks the lifecycle of a scraping job.

```
ExtractionJob {
  sourceUrl:       string
  jobType:         enum (SINGLE / BULK / DISCOVERY)
  status:          enum (QUEUED / PROCESSING / COMPLETED / FAILED / RETRY / PAUSED)
  totalProducts:   number
  processedCount:  number
  failedCount:     number
  attempts:        number
  errorMessage:    string
  productIds:      ObjectId[]  → Product
  parentJobId:     ObjectId    → ExtractionJob  (for bulk children)
  startedAt:       Date
  completedAt:     Date
  pausedAt:        Date
  submittedBy:     ObjectId    → User
}
```

#### ExportJob Schema

```
ExportJob {
  format:   enum (CSV / XLSX / JSON / SHOPIFY_CSV / WOOCOMMERCE_XML)
  status:   enum (QUEUED / PROCESSING / COMPLETED / FAILED)
  filters: {
    category:   string
    dateFrom:   Date
    dateTo:     Date
    status:     string
    productIds: ObjectId[]
  }
  rowCount:     number
  fileUrl:      string   (S3 or local path)
  expiresAt:    Date     (48 hours after generation)
  generatedBy:  ObjectId → User
}
```

#### User Schema

```
User {
  email:            string (unique, lowercase)
  passwordHash:     string (bcrypt)
  role:             enum (ADMIN / OPERATOR / VIEWER)
  refreshTokenHash: string
  lastLoginAt:      Date
}
```

#### Seller Schema
Seller profiles extracted and enriched from Aajjo.

```
Seller {
  sellerName:         string (unique)
  sellerLogoUrl:      string
  gstNumber:          string
  address, state, country: string
  businessType:       string
  yearsEstablished:   number
  numberOfEmployees:  string
  turnover:           string
  legalStatus:        string
  contactDetails:     object
  aajjoProfileUrl:    string
}
```

### 5.3 Queue & Worker System

Three BullMQ queues backed by Redis:

```
Redis
  ├── Queue: extraction    →  extraction.processor.ts
  ├── Queue: image         →  image.processor.ts
  └── Queue: export        →  export.processor.ts
```

**Job options** (configured in `queue.module.ts`):
- `attempts: 3` — retry up to 3 times on failure
- `backoff: { type: 'exponential', delay: 5000 }` — 5s, 10s, 20s delays
- Auto-cleanup of completed/failed jobs after configurable TTL

**Why BullMQ over alternatives:**
- Redis persistence: jobs survive process crashes
- Named job types allow processors to handle multiple job shapes in one queue
- Built-in retry, backoff, and dead-letter semantics
- BullBoard UI available for debugging queues

**DynamicQueueService** (`queue/dynamic-queue.service.ts`): Wrapper that standardizes job enqueuing across the app, adding correlation IDs and structured payloads.

**QueueRecoveryService** (`queue/queue-recovery.service.ts`): On startup, scans MongoDB for jobs stuck in PROCESSING state (orphaned due to crash) and re-enqueues them.

### 5.4 Scraping Pipeline

**Browser Pool** (`scraper/browser-pool.service.ts`):
- Maintains a pool of up to `MAX_CONCURRENT_BROWSERS` (default 5) Playwright Chromium instances
- Round-robin acquisition prevents any single page from monopolizing a browser
- Browsers are reused across jobs; only pages are created/destroyed per job
- Stealth plugin applied at browser launch, not per page (avoids redundant patching)

**Page Loader** (`scraper/scraper.service.ts`):
```
loadPage(url, retries = 3):
  1. Acquire browser from pool
  2. Create new page context
  3. Set realistic User-Agent, viewport (1280×800)
  4. Apply extra HTTP headers (Accept-Language, etc.)
  5. Navigate with { waitUntil: 'networkidle' }
  6. Auto-scroll: wheel events from top to bottom, 300px steps
  7. Wait for images to load
  8. Check for CAPTCHA signals:
       - Cloudflare challenge page
       - reCAPTCHA / hCaptcha iframes
  9. Return ScrapedPage { url, html, finalUrl, hasCaptcha, loadedAt }
```

Request delays of `REQUEST_DELAY_MIN_MS` to `REQUEST_DELAY_MAX_MS` (configurable, default 2-5s) are applied between requests to avoid rate limiting.

### 5.5 Data Extraction & Normalization

**Extractor** (`extractor/extractor.service.ts`):

Uses CSS selector chains defined in `extractor/aajjo-selectors.ts`. Each field has a prioritized list of selectors; the first that returns a non-empty result wins. Confidence scores reflect selector priority:

```
Selector priority → Confidence score:
  [0] Primary (specific, reliable)   → 100
  [1] Secondary                      → 80
  [2] Tertiary                       → 60
  [3+] Fallback                      → 40
```

Fields extracted:
- Product name, category, subcategory
- Price (regex: detects ₹/$/ EUR symbols, strips commas)
- MOQ (regex: "Minimum Order Quantity: X pieces")
- Description, delivery info, warranty
- Specifications table (name-value pairs from HTML tables)
- Image URLs (all `<img>` in product gallery)
- Seller name, profile URL, contact, location

**Normalization** (`normalization/normalization.service.ts`):

`field-mapping.yaml` is loaded once at startup into a `Map<string, string>`. Keys are raw Aajjo field names (lowercase, trimmed). Values are camelCase schema keys.

```yaml
# Example entries from field-mapping.yaml
"material":          materialGrade
"base material":     materialGrade
"dimensions":        dimensions
"size":              dimensions
"weight":            weightKg
"voltage":           voltageV
"power":             powerW
```

Unit conversion rules:
- Weight: g → kg (÷1000), lbs → kg (×0.453592)
- Length: mm → cm (÷10), inches → cm (×2.54)
- Currency: ₹ → INR, $ → USD, € → EUR

### 5.6 Image Processing

`image/image.service.ts` pipeline (called by `image.processor.ts`):

```
1. Download image (axios, binary buffer)
2. Probe with Sharp: get width, height, format, sizeBytes
3. Validate: width >= 200, height >= 200  (skip tiny/icon images)
4. Compute perceptual hash (image-hash library, 16-bit)
5. Query MongoDB: any Product with this pHash?
   → If duplicate found: skip upload, reuse existing storageUrl
6. Resize to thumbnail: Sharp.resize({ width: 300 })
7. Upload original to Cloudinary (folder: products/{productId}/original)
8. Upload thumbnail to Cloudinary (folder: products/{productId}/thumb)
9. Return ImageMetadata { storageUrl, thumbnailUrl, cloudinaryPublicId, pHash, ... }
```

pHash (perceptual hash) encodes the visual "fingerprint" of an image. Two images with identical pHash are visually identical even if they have different file sizes or encodings. This prevents the same product image appearing multiple times in the database.

### 5.7 Export Pipeline

`export/export.service.ts` supports five formats:

| Format | Use Case | Library |
|--------|----------|---------|
| CSV | Generic spreadsheet import | csv-stringify |
| XLSX | Excel with formatted headers | ExcelJS |
| JSON | API consumption / custom processing | JSON.stringify |
| Shopify CSV | Direct Shopify product import | csv-stringify (Shopify column mapping) |
| WooCommerce XML | WooCommerce bulk import | xmlbuilder2 |

**27 columns** in the standard CSV/XLSX export:
productId, productName, category, subCategory, price, currency, moq, description, deliveryInfo, warrantyInfo, sellerName, sellerProfile, sellerContact, sellerLocation, imageCount, featuredImageUrl, thumbnailUrl, specCount, [top 5 spec name/value pairs], extractionStatus, confidenceScore, sourceUrl, scrapedAt

Files are stored at `backend/exports/` locally (configurable) and optionally uploaded to S3 with a CloudFront CDN URL. Export jobs expire after 48 hours (`EXPORT_EXPIRY_HOURS`).

### 5.8 Authentication & Authorization

**Token flow:**
```
POST /auth/login  { email, password }
  → bcrypt.compare(password, user.passwordHash)
  → Issue: accessToken (JWT, 15min) + refreshToken (JWT, 7days)
  → Store refreshTokenHash in User document

POST /auth/refresh  { refreshToken }
  → Verify + compare hash
  → Issue new accessToken + rotate refreshToken
```

**Roles:**
```
ADMIN    → Full access: user management, all data, queue admin
OPERATOR → Submit jobs, view/export products
VIEWER   → Read-only: view products and jobs only
```

Guards applied via decorators:
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
```

Resource isolation: products include an `ownedBy` field so operators only see their own scraped data (unless Admin).

### 5.9 API Surface

All routes prefixed with `/api`. Swagger available at `/api/docs`.

```
Auth
  POST   /api/auth/login
  POST   /api/auth/register
  POST   /api/auth/refresh
  GET    /api/auth/me

Jobs (Extraction)
  POST   /api/jobs                  Submit single URL
  POST   /api/jobs/bulk             Submit CSV (multipart)
  GET    /api/jobs                  List jobs (paginated, filter by status/url)
  GET    /api/jobs/:id              Job detail + BullMQ state
  GET    /api/jobs/:id/events       SSE stream (real-time updates)
  POST   /api/jobs/:id/pause        Pause queued job
  POST   /api/jobs/:id/resume       Resume paused job
  POST   /api/jobs/:id/retry        Retry failed job
  DELETE /api/jobs/:id              Cancel job

Products
  GET    /api/products              List (filter: status, category, seller, confidence, flagged)
  GET    /api/products/categories   Group by category with counts
  GET    /api/products/subcategories
  GET    /api/products/:id          Full detail
  GET    /api/products/:id/images   Images array
  DELETE /api/products/:id

Sellers
  GET    /api/sellers               List sellers
  GET    /api/sellers/search        Search by name
  GET    /api/sellers/:name         Seller detail

Export
  POST   /api/export                Create export job
  GET    /api/export/:id            Export status + download URL
  GET    /api/export/:id/download   Redirect to file

Admin
  GET    /api/admin/users           List users (Admin only)
  POST   /api/admin/users           Create user
  PATCH  /api/admin/users/:id       Update user
  DELETE /api/admin/users/:id       Delete user

System
  GET    /api/health                Liveness check
  GET    /api/dashboard             Aggregated stats
```

---

## 6. Frontend Architecture

### 6.1 Page Structure

Next.js App Router with two route groups:

```
app/
├── layout.tsx                    Root: fonts, providers (QueryClient, SessionProvider)
├── page.tsx                      Redirect to /jobs or /login
├── providers.tsx                 TanStack Query + NextAuth session wrapper
│
├── api/auth/[...nextauth]/       NextAuth handler
│   └── route.ts                  CredentialsProvider → backend /auth/login
│
├── (auth)/
│   └── login/page.tsx            Login form (React Hook Form + Zod)
│
└── (dashboard)/
    ├── layout.tsx                Sidebar + top bar
    │
    ├── submit/page.tsx           URL input (single + bulk CSV upload)
    ├── jobs/
    │   ├── page.tsx              Jobs list with filters + pagination
    │   └── [id]/page.tsx         Job detail: progress bar, product list, SSE
    ├── products/
    │   ├── page.tsx              Product list: search, filters, table view
    │   └── [id]/page.tsx         Product detail: specs, images, seller card
    ├── sellers/
    │   ├── page.tsx              Seller list with letter filter
    │   ├── search/page.tsx       Seller search
    │   └── [sellerName]/page.tsx Seller detail: products by seller
    ├── export/page.tsx           Export builder: format + filter selection
    ├── stats/page.tsx            Dashboard: charts, counts, recent activity
    └── admin/
        ├── layout.tsx            Admin-only guard
        ├── overview/page.tsx     System overview
        └── users/page.tsx        User management CRUD
```

### 6.2 State Management & Data Fetching

**TanStack Query** handles all server state:
```typescript
// Example: products list with filters
const { data, isLoading } = useQuery({
  queryKey: ['products', filters, page],
  queryFn: () => productsApi.list({ ...filters, page }),
  staleTime: 30_000,   // Cache for 30 seconds
});
```

**Zustand** for UI state that spans components (e.g., sidebar collapse state, active filters).

**SSE for live job updates:**
```typescript
// jobs/[id]/page.tsx
useEffect(() => {
  const es = new EventSource(`/api/jobs/${id}/events`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  es.onmessage = (e) => setJobStatus(JSON.parse(e.data));
  return () => es.close();
}, [id]);
```

### 6.3 API Client Layer

`frontend/lib/api.ts` — Axios instance with interceptors:

```typescript
const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL });

// Request: attach token
api.interceptors.request.use(async (config) => {
  const session = await getSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

// Response: handle 401 (redirect to login)
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401) signOut();
    return Promise.reject(error);
  }
);
```

Organized API modules:
```
authApi.login(email, password)
authApi.me()

jobsApi.list(filters)
jobsApi.get(id)
jobsApi.submitUrl(url)
jobsApi.submitBulk(formData)
jobsApi.cancel(id)
jobsApi.retry(id)
jobsApi.pause(id)
jobsApi.resume(id)

productsApi.list(filters)
productsApi.get(id)
productsApi.categories()
productsApi.delete(id)

exportApi.submit(format, filters)
exportApi.get(id)
exportApi.download(id)
```

---

## 7. Data Flow Diagrams

### Full Lifecycle of a Product

```
URL Submitted
     │
     ▼
ExtractionJob (status: QUEUED)
     │
     ▼  [BullMQ Worker picks up]
ExtractionJob (status: PROCESSING)
     │
     ├─── Playwright loads page
     │         └─ ScrapedPage { html, url }
     │
     ├─── Extractor runs selectors
     │         └─ ExtractedProduct { raw fields }
     │
     ├─── Normalization maps fields
     │         └─ NormalizedProduct { schema fields }
     │
     ├─── Product saved to MongoDB
     │         └─ Product { _id, extractionStatus: COMPLETED }
     │
     └─── For each image URL:
               └─ ImageJob enqueued → image.processor
                       │
                       ├─── Download + validate
                       ├─── pHash computed
                       ├─── Duplicate check
                       ├─── Sharp resize
                       ├─── Cloudinary upload
                       └─── Product.images[] updated

ExtractionJob (status: COMPLETED)
     │
     └─── User sees product in /products
               └─── Can export or view detail
```

### Authentication Flow

```
Browser (NextAuth)          NestJS Backend
     │                           │
     ├── POST /api/auth/login ──▶ │
     │   { email, password }      │  bcrypt.compare
     │                           │
     │◀── { accessToken,         │
     │      refreshToken } ──────┘
     │
     │  NextAuth stores in JWT session cookie
     │
     ├── GET /api/products ──────▶ │
     │   Authorization: Bearer ... │  JwtAuthGuard validates
     │                             │  RolesGuard checks role
     │◀── [products] ─────────────┘
```

---

## 8. Configuration & Environment

### Backend `.env`

```ini
# Server
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb+srv://...

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Auth
JWT_SECRET=...
JWT_EXPIRY=15m
REFRESH_TOKEN_SECRET=...
REFRESH_TOKEN_EXPIRY=7d

# Scraping behaviour
MAX_CONCURRENT_BROWSERS=5
REQUEST_DELAY_MIN_MS=2000
REQUEST_DELAY_MAX_MS=5000
SCRAPER_TIMEOUT_MS=30000

# Image storage
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Export
EXPORT_STORAGE_PATH=./exports
EXPORT_EXPIRY_HOURS=48
AWS_S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
CLOUDFRONT_DOMAIN=

# Logging
LOG_LEVEL=info
```

### Frontend `.env.local`

```ini
NEXTAUTH_URL=http://localhost:4000
NEXTAUTH_SECRET=...
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

### Field Mapping Config (`backend/config/field-mapping.yaml`)

Defines how raw Aajjo field labels map to normalized schema keys, without requiring a code change. New field names from Aajjo can be added here and take effect on next server restart.

---

## 9. Key Design Decisions

### Why queue-based processing instead of synchronous scraping?

Scraping a page takes 5-30 seconds. Holding an HTTP connection open for that duration would exhaust server threads and give poor UX. The queue approach:
- Returns a `jobId` instantly
- Allows the browser to poll or stream via SSE
- Decouples throughput from HTTP concurrency limits
- Enables retries without user involvement

### Why MongoDB over PostgreSQL for products?

Product specifications vary wildly across Aajjo categories — electronics have voltage/wattage, textiles have thread count/GSM, machinery has RPM/torque. Storing this in a relational schema requires either a `key-value` EAV table (slow to query) or nullable columns for every possible spec (sparse and brittle). A document store lets each product carry its own spec array, typed and indexed natively.

### Why Playwright instead of simple HTTP scraping (axios + cheerio)?

Aajjo renders product pages using JavaScript. The HTML returned by a plain HTTP GET is incomplete. Playwright runs a real Chromium browser that executes JS, handles lazy-loading, and renders the full DOM before extraction. The Stealth plugin further masks automation signals.

### Why perceptual hashing for image deduplication?

The same product image may be served at different resolutions or quality levels across different Aajjo pages. MD5/SHA hashing would consider these distinct. pHash encodes the visual fingerprint, so two images that look identical produce the same hash regardless of compression or resize — preventing redundant Cloudinary storage.

### Why a YAML field mapping file instead of hardcoding?

Aajjo occasionally changes its field names ("Material" → "Base Material") or adds new attributes. Hardcoding the mapping would require a code change and redeployment. The YAML file is loaded at startup so it can be updated independently, supports easy review by non-developers, and allows different mappings per source platform if the scraper is extended.

### Why SSE instead of WebSockets for job updates?

Job status is unidirectional — the server pushes updates, the client only listens. SSE is simpler than WebSockets for this pattern: it's HTTP-based, works through proxies, auto-reconnects, and requires no additional library beyond `EventSource`. WebSockets add bidirectional complexity that isn't needed here.

### Why Cloudinary instead of S3 directly for images?

Cloudinary provides on-the-fly image transformations via URL parameters (resize, crop, format conversion) without pre-generating variants. S3 stores raw bytes with no transformation capability. For a product catalog where image dimensions vary by context (thumbnail vs. full), Cloudinary's CDN transformation layer eliminates pre-processing work.
