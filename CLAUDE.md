# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Skills Resolution & Usage

When solving tasks, use skills according to this priority:
1. **Workspace Skills (Priority 1)**: Use project-local copies in `.claude/skills/` or `.agents/skills/`:
   - **`graphify`** (`.claude/skills/graphify` / `.agents/skills/graphify`): Codebase knowledge graph
   - **`ui-ux-pro-max`** (`.claude/skills/ui-ux-pro-max` / `.agents/skills/ui-ux-pro-max`): UI/UX design intelligence (styles, product palettes, font pairings, UX guidelines, animations, charts)
   - **`web-design-guidelines`** (`.claude/skills/web-design-guidelines` / `.agents/skills/web-design-guidelines`): Vercel Web Interface Guidelines audit and accessibility rules
2. **Global Skills (Priority 2 Fallback)**: If a skill is not found in the workspace, use the global version:
   - `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `subagent-driven-development`, `dispatching-parallel-agents`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `using-git-worktrees` (`~/.gemini/config/plugins/superpowers/skills/`)

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

**Request flow**: `server.js` is the sole entry point — it wires Express middleware, mounts routers under `/api/*`, defines the QR check-in endpoints and the socket.io instance, then seeds the DB and starts listening. Route order matters (`server.js` comments call this out): `/api/auth` and `/api/packages` are public/self-guarded, `/api/queue` and `/api/assistant` require only `authenticateToken`, `/api/reports` additionally requires the `owner` role, and `/api/admin` plus the catch-all `/api` (both pointing at `routes/admin.js`) require `requireAdmin`. Every authenticated router additionally passes through `enforceIdleTimeout` (`session_activity.js`), which rejects a staff token that has gone 15 minutes without reported activity.

**Routers** (`routes/`), each a thin Express router pulling `{ pool }` from `database.js` directly:
- `auth.js` — login/register, ID-image upload + OCR-assisted verification, pending-registration approval
- `queue.js` — queue join/`next`/`complete-step`, `finalize` (front-desk-only close-out), `call-back` (undo the last advance), `reinsert` (front-desk line cutting), `hold`/`resume`, ticket status, `buildCustomerStatus()` (customer-facing state used by the assistant too)
- `admin.js` — staff/labs/doctors CRUD, analytics, searchable audit log and archives; exports `STAFF_ROLES`/`ADMIN_ROLES` guard sets consumed by `server.js` route mounting
- `packages.js` — service package catalog, searchable by ID/name/category; `DELETE` archives a package
- `reports.js` — owner-only reporting
- `assistant.js` — the "VA" (virtual assistant) backend; calls into `queue.js`'s `buildCustomerStatus()` and `ai_services.js`

**Auth & roles** (`config.js`): `JWT_SECRET`, and two role-guard middlewares — `requireStaff` (any of `STAFF_ROLES`) and `requireAdmin` (any of `ADMIN_ROLES` = admin/admintechnical/owner). `server.js` defines its own `authenticateToken`/`verifyRoles` inline rather than importing from `config.js`. Roles: `customer`, `frontdesk`, `laboratory`, `doctor`, `admin`, `admintechnical`, `owner` — see [README.md](README.md) for what each can access.

**Queue engine** (`queue_automation.js`): priority scoring (`calculateScore` — Senior/PWD/Pregnant get a weighted head start, plus 1 point per minute waited) and atomic per-day-per-station ticket numbering (`nextTicketNumber`, backed by the `ticket_counters` table with `ON DUPLICATE KEY UPDATE` to stay race-safe under concurrent check-ins). `peekTicketNumber` is a non-mutating lookahead used for previews.

`composeServiceSteps` is the single definition of the shape of a visit, and **every route is front-desk-to-front-desk**: it prepends `FRONT_DESK_STEP` (the cashier) and appends `FRONT_DESK_FINAL_STEP` (the gatekeeper) around the stations stored in `package_laboratories`. Neither bookend is a stored station row, so `hasServiceStations(steps)` — not `steps.length` — is what answers "does this package do anything?". Each queue row carries a `step_index` that indexes straight into that list, which is how `/complete-step` routes and how `/finalize` recognises the closing step.

`orderWaitingList` produces a station's waiting list *in the order it will actually be called* — priority scoring for ordinary rows, and for a re-inserted row, the position named by its `reinsert_after` (the queue id it must be called immediately after). Anchoring to a neighbour rather than storing a rank is deliberate: a stored rank re-applies itself as the line drains, so a patient placed "second" stays second forever and their turn never arrives.

Appointment-to-queue promotion (`startQueueFromAppointment` in `server.js`) derives `total_steps` from `composeServiceSteps` rather than re-deriving the arithmetic, and writes a `queue_sequences` row tracking `current_step`/`total_steps` plus the outcome fields the front desk fills in at the end.

**Audit trail** (`audit.js`): `recordAudit({ req, action, entityType, entityId, summary, before, after, reason })` writes one `audit_logs` row answering What / Who / When / Why, with scrubbed before+after snapshots and a `details` diff of only the fields that moved. `requireReason` is the Express guard that makes the Why mandatory — configuration endpoints reject the request rather than record a blank reason. `recordAudit` never throws: a failed audit write must not roll back a change the clinic has already made.

**Soft delete** (`archive.js`): `archiveRecord(table, idColumn, id, entityType, req, reason)` flags the row `archived`, files a scrubbed snapshot plus a human-readable `label` under `archived_records`, and audits the change. `ARCHIVE_TABLE_MAP` is the single map from `entity_type` back to its table, shared by restore and permanent-delete so the two cannot drift apart. It lives outside `routes/admin.js` because `routes/packages.js` archives through it too.

**Staff session timeout** (`session_activity.js`): the 15-minute inactivity rule, in two halves. The browser owns the clock (only it sees mouse/keyboard) and reports real activity via `POST /api/session/heartbeat`; the server owns the verdict and rejects a stale token with `401` + an `X-Session-Timeout` header. Deliberately heartbeat-driven rather than traffic-driven — the staff dashboards poll their queue every 5 seconds, so "time since last request" would never expire on an unattended screen.

**Database** (`database.js`): single `pool` (mysql2) exported alongside `initDB()` and `DEFAULT_SERVICES`. `initDB()` creates ~20 tables (`users`, `queue`, `queue_sequences`, `queue_logs`, `appointments`, `medical_records`, `clinical_records`, `lab_notes`, `pricing_faqs`, `ticket_counters`, `ai_settings`, `ai_logs`, `pending_registrations`, `audit_logs`, etc.) and uses `addColumnIfMissing`/`addIndexIfMissing` helpers to auto-migrate schema changes on every boot — new columns/indexes go there, not in a separate migration file.

**AI services** (`ai_services.js`): wraps external AI calls with fallback chains — tries a configured provider (Gemini / Hugging Face via `API_ALLAROUND`) then falls back to NVIDIA Nemotron (`nvidiaFallback`, requires `NVIDIA_API_KEY`) then to local mock logic (`callMockAI`) so the app degrades gracefully with zero keys configured. Also shells out to `pytesseract_ocr.py` (via `child_process.spawn`) for ID-image OCR during registration. All AI calls are gated by a DB-backed toggle (`checkAIToggle`, `ai_settings` table) and logged to `ai_logs`.

**Frontend** (`public/`): one HTML+JS pair per role (`frontdesk.html/js`, `laboratory.html/js`, `doctor.html/js`, `admintechnical.html/js`, `owner.html/js`, `customer.html/js`, plus landing `index.html/js`), no build step — pages are served statically and call `/api/*` directly with `fetch`. `shared.js`/`shared.css` hold cross-page utilities: token/role storage in `localStorage` (`clinicToken`, `clinicRole`, `clinicUsername`, `clinicCategory`), `authHeaders()`, `requireAuth(allowedRoles)` (redirects to `/index.html` if unauthorized), sidebar rendering, `logout()`, the promise-based `confirmAction()`/`promptReason()` dialogs (built from JS, since there is no templating to share markup through), `matchesSearch()`/`debounce()` for the search boxes, `initIdleTimeout()`, and the skeleton painters described below.

**Skeleton loading** (`shared.js` + the SKELETON LOADING block in `shared.css`): `skeletonTable`/`skeletonCards`/`skeletonStats`/`skeletonLines`/`skeletonValue` paint placeholder geometry for a section whose first fetch is in flight, and `clearSkeleton(...ids)` drops it plus the `aria-busy` flag. Two rules make them safe on these pages:

- A painter refuses to overwrite anything real (`skeletonSafe`), so the five-second queue poll on the station dashboards cannot flash placeholders over a list somebody is reading. Where the markup ships a static stand-in row ("No patients waiting in queue.") a first-load caller passes `replace: true`, and the station loaders additionally gate on `skeletonFirstLoad(key)`.
- The measurements come from the real CSS, not from numbers copied into the skeleton. `.skel-line` and friends are sized in `em`, so a placeholder dropped **inside** the real element (`<h3>`, `<div class="stat-value">`, a `<td>`) collapses to exactly one line box of that element. Build a new skeleton by reusing the real wrapper classes; guessing at generic bars measured 53px short per service card and 23px short per audit row. Block wrappers need `.skel-box` (`display: flow-root`) or the line's margins collapse out through them and the box comes up short.

`admin-shared.js` holds the five screens `admintechnical.html` and `owner.html` both host — Manage Accounts, Manage Laboratories, Service Management, Audit Log and Archives. Those existed as two near-identical copies that had already drifted apart; each page now keeps only its own sidebar, dashboard, and which roles it may create. It is loaded *after* `shared.js` and *before* the page script. `va.js` implements the customer-facing virtual assistant widget (speech recognition, VA state machine) that talks to `routes/assistant.js`.

**Real-time updates**: a single `socket.io` instance is created in `server.js` and attached to Express via `app.set('io', io)`; route handlers pull it from `req.app.get('io')` to emit events like `queueUpdate` after mutating queue state. Frontend pages listen for these to refresh live without polling.

## Conventions

- Uploaded ID images are deleted after OCR processing and never committed (`uploads/` is gitignored).
- Ticket types are single-letter prefixes: `S` (Senior), `D` (PWD), `P` (Pregnant), `Q` (Regular). A ticket is minted once, at the front desk, and follows the patient for the whole visit — later stations reuse the same number rather than minting their own.
- Every service route starts *and* ends at the front desk, and only the front desk can declare a visit `completed` or `unfinished` (`POST /api/queue/finalize`). A laboratory or doctor can only hand the patient on. `/complete-step` refuses to close the final step and points at finalization instead.
- Soft deletion is the norm — go through `archiveRecord` in `archive.js` rather than writing `archived=true` by hand, so the snapshot, the label and the audit entry are always written together. Every archivable `entity_type` needs an entry in `ARCHIVE_TABLE_MAP` or it cannot be restored. `account_deletion_logs` and `archived_records` retain history for owner-facing audit trails.
- Any endpoint that changes clinic configuration or data takes a `reason` in its body and mounts `requireReason` from `audit.js`; the matching UI collects it with `promptReason()`. Adding a new configuration endpoint without both is a gap in the audit trail, not a shortcut.
- The paused-patient state is called **On-Hold** (`queue.status = 'on-hold'`, `hold_reason`, `hold_at`, `POST /api/queue/hold` and `/resume`). It was previously "parked"; that spelling is gone from the schema, the API and the UI.
- New DB schema changes belong in `database.js`'s `initDB()` using `addColumnIfMissing`/`addIndexIfMissing`, so existing deployments auto-migrate on next boot.
- A section that fetches its own data shows a skeleton on first load, not a spinner or a stand-in figure - the markup used to ship `0`/`--`/"No patients waiting", which reads as an answer the page does not have yet. Reach for `showSectionLoader()` only for a genuine blocking overlay; it is no longer the default, and on the customer dashboard it was firing every five seconds over the patient's own ticket number.
