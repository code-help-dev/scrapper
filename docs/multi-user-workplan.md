# Multi-User Scraper — Implementation Work Plan

**Version:** 1.0  
**Date:** 2026-06-10  
**Goal:** Secure, isolated, scalable multi-user system where each user scrapes independently and sees only their own data.

---

## Current State (Baseline)

| Area | Status |
|---|---|
| User schema with roles (admin / operator / viewer) | Done |
| `submittedBy` field on ExtractionJob | Done |
| `generatedBy` field on ExportJob | Done |
| JWT auth with `@CurrentUser()` decorator | Done |
| Redis + BullMQ infrastructure | Done |
| Jobs API filtering by user | **Missing** |
| Products API filtering by user | **Missing** |
| `userId` field on Product schema | **Missing** |
| Dashboard stats per user | **Missing** |
| Per-user queue isolation | **Missing** |
| Admin user-management UI | **Missing** |

---

## Architecture Overview

```
User submits URL
      ↓
url-input.service.ts
      ↓
DynamicQueueService.addJob('scraper:{userId}', payload)
      ↓
Redis:  scraper:abc123   scraper:def456  ...  scraper:ghi789
               ↓                ↓                    ↓
          Worker (U1)      Worker (U2)          Worker (U30)
               ↓                ↓                    ↓
        ExtractionProcessor logic (shared function, reused across all workers)
               ↓
        User-owned Products / Jobs (filtered by userId in all API queries)
```

### Queue Isolation Model

- **True per-user queues:** Each user gets their own BullMQ `Queue` + `Worker` named `scraper:{userId}`
- **User cap: 30 users maximum** (hard-enforced at user creation)
- **Resource budget at 30 users:**

  | Resource | Per User | Total (30 users) | Safe? |
  |---|---|---|---|
  | Redis connections | ~2 | ~60 | Yes (Redis default: 10,000) |
  | Memory per Worker | ~5–10 MB | ~300 MB | Yes |
  | BullMQ Queues | 1 | 30 | No limit |

- **Processor logic is shared** — one reusable function, not duplicated per worker
- **Admin** sees all queues and per-queue job counts via `DynamicQueueService.getJobCounts(userId)`

### Database Isolation

Every table includes a user reference:

| Collection | Field | Type | Notes |
|---|---|---|---|
| `extractionjobs` | `submittedBy` | ObjectId → User | Already exists, indexed |
| `exportjobs` | `generatedBy` | ObjectId → User | Already exists, indexed |
| `products` | `ownedBy` | ObjectId → User | **To be added**, indexed |

---

## Key Principles

- **Data Isolation** — Users see only their own jobs, products, and exports
- **Queue Isolation** — Each user has their own BullMQ queue and worker
- **Least Privilege** — Users access only what they own; admin accesses everything
- **Audit & Monitor** — Admin observability dashboard (per-user job metrics)
- **User Experience** — Clean dashboards scoped to the logged-in user

---

## Phase 1 — Backend Data Isolation

**Priority: Critical**  
**Fixes the core security gap — users currently see each other's data.**

### 1.1 Add `ownedBy` to Product Schema

- **File:** `backend/src/modules/database/schemas/product.schema.ts`
- Add field: `ownedBy: ObjectId (ref: 'User', required: true, indexed: true)`
- Update `url-input.service.ts` to pass `userId` when creating products during scraping

### 1.2 Filter Jobs API by User

- **File:** `backend/src/modules/jobs/jobs.controller.ts`
- Non-admin: inject `currentUser._id` → query `{ submittedBy: userId }`
- Admin: no filter (sees all users' jobs)

### 1.3 Filter Products API by User

- **File:** `backend/src/modules/products/products.controller.ts`
- Non-admin: inject `currentUser._id` → query `{ ownedBy: userId }`
- Admin: no filter

### 1.4 Filter Exports API by User

- **File:** `backend/src/modules/export/export.controller.ts`
- Already has `generatedBy` field — enforce it in all list/get queries
- Non-admin: `{ generatedBy: userId }`
- Admin: no filter

### 1.5 Filter Dashboard Stats by User

- **File:** `backend/src/modules/dashboard/dashboard.service.ts`
- Non-admin: aggregate job/product counts filtered by `userId`
- Admin: global aggregation across all users

### 1.6 Filter SSE (Job Progress Stream) by User

- Verify SSE endpoints in `jobs.controller.ts` also scope events to `submittedBy === userId`
- Admin receives all events

---

## Phase 2 — Admin Observability & User Management

**Priority: High**

### 2.1 Verify RolesGuard is Wired

- **Files:** `backend/src/common/guards/`
- Ensure `@Roles(UserRole.ADMIN)` + `RolesGuard` is registered globally or per-controller
- All admin routes must return `403 Forbidden` for non-admin callers

### 2.2 Admin Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/admin/users` | List all users with job counts (pending / running / completed / failed) |
| `POST` | `/admin/users` | Create a new user (role assignable) |
| `PATCH` | `/admin/users/:id` | Update role, deactivate/reactivate user |
| `GET` | `/admin/overview` | Per-user metrics table (matches observability diagram) |

**Admin Observability Table (example response):**

```json
[
  { "user": "User A", "pending": 20, "running": 3, "completed": 120, "failed": 1 },
  { "user": "User B", "pending": 5,  "running": 1, "completed": 60,  "failed": 0 },
  { "user": "User C", "pending": 50, "running": 5, "completed": 200, "failed": 2 }
]
```

---

## Phase 3 — Per-User Queue Isolation (True Queues)

**Priority: Medium**  
**User cap: 30 maximum**

### 3.1 Extract Processor Logic

- **File:** `backend/src/modules/queue/processors/extraction.processor.ts`
- Extract the core scraping logic into a plain reusable function `processExtractionJob(payload, services)`
- The function is shared by all 30 workers — no code duplication

### 3.2 Build `DynamicQueueService`

- **New file:** `backend/src/modules/queue/dynamic-queue.service.ts`
- Responsibilities:
  - `onModuleInit()` — load all users from DB → create `Queue('scraper:{userId}')` + `Worker('scraper:{userId}')` for each
  - `createQueueForUser(userId)` — called when a new user is created
  - `addJob(userId, payload)` — push a job to `scraper:{userId}` queue
  - `getJobCounts(userId)` — return `{ pending, active, completed, failed }` for a user's queue
  - `getAllQueueStats()` — aggregate counts across all user queues (for admin overview)
  - Worker lifecycle management (graceful shutdown on `onModuleDestroy`)

### 3.3 Route URL Submissions to Per-User Queue

- **File:** `backend/src/modules/url-input/url-input.service.ts`
- Replace `this.extractionQueue.add(...)` with `this.dynamicQueueService.addJob(userId, payload)`

### 3.4 Enforce 30-User Cap

- **File:** `backend/src/modules/users/users.service.ts`
- Before creating a user: `if (userCount >= 30) throw new BadRequestException('User limit of 30 reached')`
- Emit `user.created` event after successful creation → triggers `DynamicQueueService.createQueueForUser()`

### 3.5 Connect Admin Overview to Queue Stats

- **File:** `backend/src/modules/dashboard/dashboard.service.ts`
- Admin overview endpoint calls `DynamicQueueService.getAllQueueStats()` instead of DB aggregation for real-time queue depth

---

## Phase 4 — Frontend Updates

**Priority: High (after Phase 1 backend is done)**

### 4.1 Jobs & Products Pages

- No API changes needed — backend auto-filters after Phase 1
- Frontend already passes `Authorization` header → user context flows automatically

### 4.2 Admin Navigation

- **File:** `frontend/components/sidebar.tsx`
- Show "User Management" and "Admin Overview" nav items only if `session.role === 'admin'`

### 4.3 Admin User Management Page

- **New file:** `frontend/app/(dashboard)/admin/users/page.tsx`
- Table of all users (name, email, role, status, job count)
- "Create User" modal (name, email, role selector)
- Role badge + deactivate toggle per row

### 4.4 Admin Observability Dashboard

- **New file:** `frontend/app/(dashboard)/admin/overview/page.tsx`
- Per-user metrics table: User / Pending / Running / Completed / Failed
- Real-time refresh (poll every 10s or SSE)
- Per-user queue depth visualization (optional bar chart via Recharts)

---

## Phase 5 — Validation & Hardening

**Priority: Required before deploy**

### 5.1 Access Control Tests

- User A cannot `GET /jobs` and see User B's jobs
- User A cannot `GET /products` and see User B's products
- User A cannot `GET /exports/:id` for an export owned by User B
- Admin can see all of the above

### 5.2 Export File Security

- Verify export download URLs (S3 pre-signed or local) are scoped per user
- Ensure `GET /export/:id/download` checks `generatedBy === currentUser._id`

### 5.3 Queue Isolation Verification

- Submit jobs as User A and User B simultaneously
- Verify User A's queue does not block User B's processing
- Verify `DynamicQueueService.getJobCounts()` returns per-user accurate counts

### 5.4 User Cap Enforcement

- Attempt to create the 31st user → must receive `400 Bad Request`

---

## Implementation Order

```
Phase 1 (Data Isolation)
    → Phase 2 (Admin APIs)
        → Phase 4 (Frontend)
            → Phase 3 (Queue Isolation)
                → Phase 5 (Validation)
```

Phase 1 is the highest value, lowest risk, and unblocks all other phases.  
Phase 3 can be implemented in parallel with Phase 4 since they are independent.

---

## Files to Create / Modify

### New Files

| File | Purpose |
|---|---|
| `backend/src/modules/queue/dynamic-queue.service.ts` | Per-user queue + worker lifecycle manager |
| `backend/src/modules/admin/admin.controller.ts` | Admin-only routes |
| `backend/src/modules/admin/admin.service.ts` | Admin business logic |
| `backend/src/modules/admin/admin.module.ts` | Admin module definition |
| `frontend/app/(dashboard)/admin/users/page.tsx` | Admin user management page |
| `frontend/app/(dashboard)/admin/overview/page.tsx` | Admin observability dashboard |

### Modified Files

| File | Change |
|---|---|
| `backend/src/modules/database/schemas/product.schema.ts` | Add `ownedBy` field |
| `backend/src/modules/jobs/jobs.controller.ts` | Filter by `submittedBy` for non-admin |
| `backend/src/modules/products/products.controller.ts` | Filter by `ownedBy` for non-admin |
| `backend/src/modules/export/export.controller.ts` | Filter by `generatedBy` for non-admin |
| `backend/src/modules/dashboard/dashboard.service.ts` | Per-user stats, admin global stats |
| `backend/src/modules/url-input/url-input.service.ts` | Route to `DynamicQueueService`, pass `userId` to products |
| `backend/src/modules/users/users.service.ts` | Enforce 30-user cap, emit `user.created` |
| `backend/src/modules/queue/processors/extraction.processor.ts` | Extract logic into reusable function |
| `frontend/components/sidebar.tsx` | Admin-only nav items |
| `frontend/app/(dashboard)/layout.tsx` | Role-based layout guard |
