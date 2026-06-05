## Plan: Implement Job Monitoring, Product Hierarchy, Pagination, Caching, and Queue Optimization

TL;DR: Update the dashboard and backend so job monitoring supports page jump + detail view, product browsing is hierarchical by category/subcategory with paginated product listings, product pages are cached via Redis, and multi-product listing URLs are handled as a single scraping job with internal progress tracking.

**Steps**
1. **Job Monitoring UI**
   - Update `frontend/app/(dashboard)/jobs/page.tsx`
   - Add page jump input and display current page / total pages / total jobs
   - Keep prev/next controls
   - Make each job row clickable to job detail

2. **Job Detail View**
   - Add `frontend/app/(dashboard)/jobs/[id]/page.tsx`
   - Fetch `jobsApi.get(id)`
   - Show job metadata:
     - ID, status, type, source URL
     - submittedAt, startedAt, completedAt
     - totalProducts, processedCount, failedCount, remaining count
     - estimated completion %
     - error details and logs / Bull state
     - products processed

3. **Backend Job List + Details**
   - Confirm `backend/src/modules/jobs/jobs.controller.ts` returns required data
   - Add or expose `bullState` / metadata if missing
   - Ensure `GET /api/jobs` supports `page`, `limit`, `status` and returns pagination meta

4. **Product Hierarchy Backend**
   - Extend `backend/src/modules/products/products.controller.ts`
   - Add:
     - `GET /api/products/categories`
     - `GET /api/products/subcategories?category=...`
   - Enhance `GET /api/products` to accept `category` and `subCategory`

5. **Frontend Product Hierarchy**
   - Modify `frontend/app/(dashboard)/products/page.tsx`
   - Use query params: `category`, `subCategory`, `page`, `limit`
   - Show:
     - categories first
     - subcategories when category selected
     - product list when category + subcategory selected
   - Add page size selector (10–20)

6. **Pagination + Page Fetching**
   - Default to 20 products per page
   - Ensure only current page is requested from backend
   - Display `total count`, `current page`, `total pages`

7. **Redis Caching**
   - Add Redis client support in backend using existing Redis config in `backend/src/config/configuration.ts`
   - Cache:
     - product list responses
     - category list
     - subcategory list
   - Use short TTL (15–30s)

8. **URL Queue Optimization**
   - Update `backend/src/modules/url-input/url-input.service.ts`
   - Category/listing URLs create a single discovery job only
   - Do not queue separate child jobs for each product URL
   - Update `backend/src/modules/queue/processors/extraction.processor.ts`
   - `processDiscovery` should:
     - discover product URLs
     - set `totalProducts` on the discovery job
     - process product extraction internally
     - increment `processedCount` and `failedCount`
     - complete the job after all discovered products are handled

9. **Progress Bar & Metrics**
   - Display internal progress for discovery jobs
   - Use progress bars and metrics for:
     - total detected
     - processed
     - remaining
     - success / failure counts

10. **Verify and test**
    - Confirm job monitor page jump and URL navigation
    - Confirm job details page loads correct metrics
    - Confirm category → subcategory → product listing flow
    - Confirm only the current product page is fetched and page size selector works
    - Confirm Redis cache is used for repeated product endpoint requests
    - Confirm category/listing URLs create one queue job and progress updates inside that job

**Relevant files**
- `frontend/app/(dashboard)/jobs/page.tsx`
- `frontend/app/(dashboard)/jobs/[id]/page.tsx`
- `frontend/app/(dashboard)/products/page.tsx`
- `frontend/lib/api.ts`
- `frontend/types/index.ts`
- `backend/src/modules/jobs/jobs.controller.ts`
- `backend/src/modules/products/products.controller.ts`
- `backend/src/modules/url-input/url-input.service.ts`
- `backend/src/modules/queue/processors/extraction.processor.ts`
- `backend/src/modules/dashboard/dashboard.controller.ts`
- `backend/src/config/configuration.ts`
- `backend/src/modules/health/health.controller.ts`

**Verification**
1. Jobs page shows direct page jumping, current page, total pages, and total jobs.
2. Job detail page shows full job progress + state.
3. Product browsing works as Main Category → Subcategory → Product Listing.
4. Product listing pages fetch only the current page.
5. Redis caching is active for product queries.
6. A category/listing URL appears as one queue job, not many child jobs.
7. Progress is tracked within that single discovery job.

**Notes**
- Use query params for category navigation to avoid `/products/[id]` route conflicts
- Short Redis TTL is preferred over complex cache invalidation
- Single discovery job behavior will reduce queue fragmentation and improve readability
