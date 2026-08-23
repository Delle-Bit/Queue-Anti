# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Project

Medical clinic queue management system: customers join queues or book appointments, staff call tickets across stations (front desk → laboratory(s) → doctor), with live status updates, priority queuing (Senior/PWD/Pregnant), analytics, and AI-assisted features.

**Stack**: Node.js + Express 5 + Socket.IO, MySQL (`mysql2`, schema auto-created on boot), static HTML/CSS/JS in `public/` (no frontend framework/bundler), JWT auth (8h expiry, role-based).

## Commands

```bash
npm install       # install dependencies
npm start          # run the server (default port 3000; requires local MySQL on 3306)
npm test           # syntax-check all backend files via `node --check` (no test runner/framework in this repo)
```

There is no linter or automated test suite — `npm test` only verifies each backend file parses. Manually exercise routes/pages after changes.

Setup requires a local MySQL server and a `.env` with `PORT`, `JWT_SECRET`, and optional `GEMINI_API_KEY` / `API_ALLAROUND` / `NVIDIA_API_KEY`. The first server run auto-creates the `clinic_v2` database, all tables, seed accounts, seed labs/doctors, and default service packages — no manual migrations. Seed accounts are documented in [README.md](README.md).

## Architecture

**Request flow**: `server.js` is the sole entry point — it wires Express middleware, mounts routers under `/api/*`, defines the QR check-in endpoints and the socket.io instance, then seeds the DB and starts listening. Route order matters (`server.js` comments call this out): `/api/auth` and `/api/packages` are public/self-guarded, `/api/queue` and `/api/assistant` require only `authenticateToken`, `/api/reports` additionally requires the `owner` role, and `/api/admin` plus the catch-all `/api` (both pointing at `routes/admin.js`) require `requireAdmin`.

**Routers** (`routes/`), each a thin Express router pulling `{ pool }` from `database.js` directly:
- `auth.js` — login/register, ID-image upload + OCR-assisted verification, pending-registration approval
- `queue.js` — queue join/call/complete, ticket status, `buildCustomerStatus()` (customer-facing state used by the assistant too)
- `admin.js` — staff/services/labs/doctors CRUD, analytics, archives; exports `STAFF_ROLES`/`ADMIN_ROLES` guard sets consumed by `server.js` route mounting
- `packages.js` — service package catalog
- `reports.js` — owner-only reporting
- `assistant.js` — the "VA" (virtual assistant) backend; calls into `queue.js`'s `buildCustomerStatus()` and `ai_services.js`

**Auth & roles** (`config.js`): `JWT_SECRET`, and two role-guard middlewares — `requireStaff` (any of `STAFF_ROLES`) and `requireAdmin` (any of `ADMIN_ROLES` = admin/admintechnical/owner). `server.js` defines its own `authenticateToken`/`verifyRoles` inline rather than importing from `config.js`. Roles: `customer`, `frontdesk`, `laboratory`, `doctor`, `admin`, `admintechnical`, `owner` — see [README.md](README.md) for what each can access.

**Queue engine** (`queue_automation.js`): priority scoring (`calculateScore` — Senior/PWD/Pregnant get a weighted head start, plus 1 point per minute waited) and atomic per-day-per-station ticket numbering (`nextTicketNumber`, backed by the `ticket_counters` table with `ON DUPLICATE KEY UPDATE` to stay race-safe under concurrent check-ins). `peekTicketNumber` is a non-mutating lookahead used for previews. Appointment-to-queue promotion (`startQueueFromAppointment` in `server.js`) walks `package_laboratories` to build the multi-station sequence (front desk → each lab in `sequence_order` → doctor if the package has one) and writes a `queue_sequences` row tracking `current_step`/`total_steps`.

**Database** (`database.js`): single `pool` (mysql2) exported alongside `initDB()` and `DEFAULT_SERVICES`. `initDB()` creates ~20 tables (`users`, `queue`, `queue_sequences`, `queue_logs`, `appointments`, `medical_records`, `clinical_records`, `lab_notes`, `pricing_faqs`, `ticket_counters`, `ai_settings`, `ai_logs`, `pending_registrations`, `audit_logs`, etc.) and uses `addColumnIfMissing`/`addIndexIfMissing` helpers to auto-migrate schema changes on every boot — new columns/indexes go there, not in a separate migration file.

**AI services** (`ai_services.js`): wraps external AI calls with fallback chains — tries a configured provider (Gemini / Hugging Face via `API_ALLAROUND`) then falls back to NVIDIA Nemotron (`nvidiaFallback`, requires `NVIDIA_API_KEY`) then to local mock logic (`callMockAI`) so the app degrades gracefully with zero keys configured. Also shells out to `pytesseract_ocr.py` (via `child_process.spawn`) for ID-image OCR during registration. All AI calls are gated by a DB-backed toggle (`checkAIToggle`, `ai_settings` table) and logged to `ai_logs`.

**Frontend** (`public/`): one HTML+JS pair per role (`frontdesk.html/js`, `laboratory.html/js`, `doctor.html/js`, `admintechnical.html/js`, `owner.html/js`, `customer.html/js`, plus landing `index.html/js`), no build step — pages are served statically and call `/api/*` directly with `fetch`. `shared.js`/`shared.css` hold cross-page utilities: token/role storage in `localStorage` (`clinicToken`, `clinicRole`, `clinicUsername`, `clinicCategory`), `authHeaders()`, `requireAuth(allowedRoles)` (redirects to `/index.html` if unauthorized), sidebar rendering, and `logout()`. `va.js` implements the customer-facing virtual assistant widget (speech recognition, VA state machine) that talks to `routes/assistant.js`.

**Real-time updates**: a single `socket.io` instance is created in `server.js` and attached to Express via `app.set('io', io)`; route handlers pull it from `req.app.get('io')` to emit events like `queueUpdate` after mutating queue state. Frontend pages listen for these to refresh live without polling.

## Conventions

- Uploaded ID images are deleted after OCR processing and never committed (`uploads/` is gitignored).
- Ticket types are single-letter prefixes: `S` (Senior), `D` (PWD), `P` (Pregnant), `Q` (Regular).
- Soft deletion is the norm — most tables use `archived`/`archived_at` columns rather than hard deletes; `account_deletion_logs` and `archived_records` retain history for owner-facing audit trails.
- New DB schema changes belong in `database.js`'s `initDB()` using `addColumnIfMissing`/`addIndexIfMissing`, so existing deployments auto-migrate on next boot.
