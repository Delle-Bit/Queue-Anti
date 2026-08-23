# Graph Report - .  (2026-08-23)

## Corpus Check
- 2 files · ~67,523 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 645 nodes · 952 edges · 36 communities (34 shown, 2 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 67 edges (avg confidence: 0.63)
- Token cost: 79,499 input · 0 output

## Community Hubs (Navigation)
- Landing Page Auth & Registration
- Customer Dashboard (customer.js)
- Admin Technical Dashboard
- Core NPM Dependencies
- Owner Dashboard
- Setup & Flowchart Docs (Current)
- Virtual Nurse Assistant Widget
- Front Desk Dashboard
- Server Entry Point & Routing
- Shared Frontend Utilities
- VA Backend Dialogue Route
- Laboratory/Doctor Dashboard Assets
- Project Guidance Docs
- AI Services & Fallback Chain
- Doctor Dashboard
- Graphify Export Steps
- Auth & Registration Routes
- Graphify Transcribe & Update Refs
- Graphify Pipeline Steps
- Graphify Pipeline Steps
- Graphify Query/Path/Explain Reference
- Role & Auth Config + Packages Route
- Database Schema & Migrations
- Graphify Skill Core
- Graphify Subcommand Reference Index
- Graphify Subcommand Reference Index
- Admin Routes (admin.js)
- Project README
- Graphify Add/Watch Reference
- Graphify Hooks Reference
- Graphify Extraction Spec
- Seed Test Accounts
- Graphify GitHub Merge Reference
- Queue Priority Scoring
- OCR Script
- CLAUDE.md Graphify Note

## God Nodes (most connected - your core abstractions)
1. `CLAUDE.md — Project Guidance` - 28 edges
2. `Graphify SKILL.md (.agents)` - 15 edges
3. `Graphify SKILL.md (.claude)` - 14 edges
4. `What You Must Do When Invoked` - 12 edges
5. `What You Must Do When Invoked` - 12 edges
6. `/graphify` - 11 edges
7. `README.md — Project Overview` - 11 edges
8. `/graphify` - 10 edges
9. `pool` - 10 edges
10. `graphify reference: extra exports and benchmark` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Zero-Migration Auto Schema Creation` --references--> `initDB()`  [EXTRACTED]
  INSTRUCTIONS.md → database.js
- `Graphify SKILL.md (.agents)` --semantically_similar_to--> `Graphify SKILL.md (.claude)`  [INFERRED] [semantically similar]
  .agents/skills/graphify/SKILL.md → .claude/skills/graphify/SKILL.md
- `Honesty Rules` --semantically_similar_to--> `Honesty Rules`  [INFERRED] [semantically similar]
  .agents/skills/graphify/SKILL.md → .claude/skills/graphify/SKILL.md
- `Add-Watch Reference (.agents)` --semantically_similar_to--> `Add-Watch Reference (.claude)`  [INFERRED] [semantically similar]
  .agents/skills/graphify/references/add-watch.md → .claude/skills/graphify/references/add-watch.md
- `Exports & Benchmark Reference (.agents)` --semantically_similar_to--> `Exports & Benchmark Reference (.claude)`  [INFERRED] [semantically similar]
  .agents/skills/graphify/references/exports.md → .claude/skills/graphify/references/exports.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Four-Step Registration Wizard** — flowchart_registration_wizard [EXTRACTED 1.00]
- **Live Queue Status Sync Pattern** — routes_queue_buildcustomerstatus [EXTRACTED 1.00]
- **Graphify Skill + Core References (.agents)** — agents_skills_graphify_skill, agents_skills_graphify_references_extraction_spec, agents_skills_graphify_references_query, agents_skills_graphify_references_update [EXTRACTED 1.00]
- **Graphify Skill + Core References (.claude)** — claude_skills_graphify_skill, claude_skills_graphify_references_extraction_spec, claude_skills_graphify_references_query, claude_skills_graphify_references_update [EXTRACTED 1.00]
- **Self-Improving Query Loop (save-result + reflect + hook)** — agents_skills_graphify_references_query, agents_skills_graphify_references_query_work_memory, agents_skills_graphify_references_hooks [INFERRED 0.85]
- **Graphify Instructions Duplicated Across Config Files** — agents_graphify, claude_overview, gemini_graphify, concept_graphify [INFERRED 0.85]
- **Staff Role-Gated Dashboard Page Family** — public_admintechnical_page, public_owner_page, public_frontdesk_page, public_doctor_page, public_laboratory_page [INFERRED 0.75]
- **Seed Account & Role Matrix Documentation** — readme_overview, example_accounts_seedlist, concept_seed_accounts, concept_role_based_access [INFERRED 0.75]

## Communities (36 total, 2 thin omitted)

### Community 0 - "Landing Page Auth & Registration"
Cohesion: 0.06
Nodes (39): authOverlay, captureRegID(), checkPasswordMatch(), checkPasswordStrength(), closeAuthPanel(), finishRegistration(), formatTime(), goToStep() (+31 more)

### Community 1 - "Customer Dashboard (customer.js)"
Cohesion: 0.08
Nodes (39): APPT_SLOTS, apptNextStep(), apptPrevStep(), bookAppointment(), calendarDate, cancelQueue(), changeCalendarMonth(), checkMandatoryMedicalForm() (+31 more)

### Community 2 - "Admin Technical Dashboard"
Cohesion: 0.08
Nodes (29): allDoctors, allLabs, createAccount(), deleteLab(), deleteUser(), editService(), editUser(), fetchAllLabs() (+21 more)

### Community 3 - "Core NPM Dependencies"
Cohesion: 0.06
Nodes (34): axios, bcrypt, body-parser, cors, dotenv, express, jsonwebtoken, multer (+26 more)

### Community 4 - "Owner Dashboard"
Cohesion: 0.08
Nodes (28): allAudits, allDoctors, allLabs, deleteLab(), deleteUser(), editService(), editUser(), fetchAllLabs() (+20 more)

### Community 5 - "Setup & Flowchart Docs (Current)"
Cohesion: 0.08
Nodes (30): 1. Registration & Authentication Flow, 2. Customer Dashboard & Core Actions Flow, 3. Real-time Status Data Flow Diagram (DFD), Book an Appointment Flow, Customer Dashboard & Core Actions Flow, Customer Side Flowchart & Data Flow Guide, Join a Service Queue Flow, Login Flow (+22 more)

### Community 6 - "Virtual Nurse Assistant Widget"
Cohesion: 0.18
Nodes (26): Virtual Nurse Assistant Widget (customer.html), addVaHistory(), answerQueueStatus(), answerWaitTime(), bindVaListeners(), clearVaHistory(), dismissVaBubble(), executeVaAction() (+18 more)

### Community 7 - "Front Desk Dashboard"
Cohesion: 0.13
Nodes (19): allFdLogs, allLabs, editService(), fdCallNext(), fdComplete(), filterFdLogs(), labSequence, loadFdQueue() (+11 more)

### Community 8 - "Server Entry Point & Routing"
Cohesion: 0.09
Nodes (22): adminRoutes, app, assistantRoutes, authRoutes, bcrypt, bodyParser, cors, dotenv (+14 more)

### Community 9 - "Shared Frontend Utilities"
Cohesion: 0.14
Nodes (10): authHeaders(), getRole(), getToken(), getUserId(), getUsername(), initDefaultSection(), logout(), navigateTo() (+2 more)

### Community 10 - "VA Backend Dialogue Route"
Cohesion: 0.14
Nodes (18): peekTicketNumber(), aiServices, { buildCustomerStatus }, express, loadAssistantContext(), { pool }, router, buildCustomerStatus() (+10 more)

### Community 11 - "Laboratory/Doctor Dashboard Assets"
Cohesion: 0.17
Nodes (18): Clinic Heart Logo SVG (repo root copy), Doctor Dashboard Page, Clinic Heart Logo SVG (served copy), addWorkspaceLabNote(), allLabLogs, filterLabLogs(), findMyLab(), labCallNext() (+10 more)

### Community 12 - "Project Guidance Docs"
Cohesion: 0.18
Nodes (17): graphify, CLAUDE.md — Project Guidance, Graphify Knowledge Graph Tool, Priority Queueing (Senior/PWD/Pregnant), Role-Based Access Matrix, Seeded Dev Accounts, Auto-Migrating Schema Convention (addColumnIfMissing/addIndexIfMissing in initDB), Soft Deletion Convention (archived/archived_at columns, no hard deletes) (+9 more)

### Community 13 - "AI Services & Fallback Chain"
Cohesion: 0.12
Nodes (11): aiServices, axios, callMockAI(), checkAIToggle(), dotenv, fs, logAI(), nvidiaFallback() (+3 more)

### Community 14 - "Doctor Dashboard"
Cohesion: 0.22
Nodes (17): addPrescriptionItem(), commitClinicalRecord(), docCallNext(), docComplete(), findMyDoctor(), loadDocQueue(), loadDraftFromLocalStorage(), loadPatientMedicalFile() (+9 more)

### Community 15 - "Graphify Export Steps"
Cohesion: 0.11
Nodes (18): Exports & Benchmark Reference (.agents), graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag) (+10 more)

### Community 16 - "Auth & Registration Routes"
Cohesion: 0.11
Nodes (11): aiServices, bcrypt, express, fs, jwt, { JWT_SECRET }, multer, { pool } (+3 more)

### Community 17 - "Graphify Transcribe & Update Refs"
Cohesion: 0.14
Nodes (15): Transcribe Reference (.agents), graphify reference: transcribe video and audio, Step 2.5 - Transcribe video / audio files (only if video files detected), Update & Cluster-Only Reference (.agents), For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only, Stamp-Only-On-Output Manifest Rule (+7 more)

### Community 18 - "Graphify Pipeline Steps"
Cohesion: 0.13
Nodes (15): Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Part C - Merge AST + semantic into final extraction, Step 0 - GitHub repos and multi-path merge (only if a URL or several paths), Step 1 - Ensure graphify is installed, Step 2.5 - Video and audio (only if video files detected), Step 2 - Detect files, Step 3 - Extract entities and relationships (+7 more)

### Community 19 - "Graphify Pipeline Steps"
Cohesion: 0.13
Nodes (15): Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Part C - Merge AST + semantic into final extraction, Step 0 - GitHub repos and multi-path merge (only if a URL or several paths), Step 1 - Ensure graphify is installed, Step 2.5 - Video and audio (only if video files detected), Step 2 - Detect files, Step 3 - Extract entities and relationships (+7 more)

### Community 20 - "Graphify Query/Path/Explain Reference"
Cohesion: 0.15
Nodes (14): Query/Path/Explain Reference (.agents), For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal, Constrained Query Vocabulary Expansion, Work Memory / Self-Improving Loop (+6 more)

### Community 21 - "Role & Auth Config + Packages Route"
Cohesion: 0.19
Nodes (10): ADMIN_ROLES, requireAdmin(), requireStaff(), STAFF_ROLES, aiServices, express, jwt, { JWT_SECRET, requireStaff } (+2 more)

### Community 22 - "Database Schema & Migrations"
Cohesion: 0.21
Nodes (10): addColumnIfMissing(), addIndexIfMissing(), DEFAULT_SERVICES, initDB(), mysql, pool, aiServices, express (+2 more)

### Community 23 - "Graphify Skill Core"
Cohesion: 0.20
Nodes (8): graphify, Graphify SKILL.md (.agents), Graphify Full Pipeline (Steps 0-9), #479 Shrink-Guard, Workflow: graphify, graphify, Graphify SKILL.md (.claude), PowerShell 5.1 Scrolling Fix

### Community 24 - "Graphify Subcommand Reference Index"
Cohesion: 0.20
Nodes (10): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Usage (+2 more)

### Community 25 - "Graphify Subcommand Reference Index"
Cohesion: 0.20
Nodes (10): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Interpreter guard for subcommands, PowerShell 5.1: Vertical scrolling stops working, Troubleshooting (+2 more)

### Community 26 - "Admin Routes (admin.js)"
Cohesion: 0.20
Nodes (8): bcrypt, crypto, ELEVATED_ROLES, express, { pool }, QRCode, { requireStaff, requireAdmin }, router

### Community 27 - "Project README"
Cohesion: 0.22
Nodes (8): Key routes, Medical Clinic Queueing System, Notes, Roles & access, Scripts, Seed accounts (dev only — change before any real deployment), Setup, Stack

### Community 28 - "Graphify Add/Watch Reference"
Cohesion: 0.25
Nodes (8): Add-Watch Reference (.agents), For /graphify add, For --watch, graphify reference: add a URL and watch a folder, Add-Watch Reference (.claude), For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 29 - "Graphify Hooks Reference"
Cohesion: 0.25
Nodes (6): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration, For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 30 - "Graphify Extraction Spec"
Cohesion: 0.33
Nodes (7): Extraction Subagent Spec (.agents), Discrete Confidence Rubric, graphify reference: extraction subagent prompt, Node ID Format Rule, Extraction Subagent Spec (.claude), Discrete Confidence Rubric, graphify reference: extraction subagent prompt

### Community 31 - "Seed Test Accounts"
Cohesion: 0.29
Nodes (6): Doctor Stations, Example Test Accounts, Laboratories, Role Descriptions, Sample Data, Service Packages

### Community 32 - "Graphify GitHub Merge Reference"
Cohesion: 0.33
Nodes (6): GitHub Clone & Merge Reference (.agents), graphify reference: GitHub clone and cross-repo merge, Step 0 - Clone GitHub repo(s) (only if a GitHub URL was given), GitHub Clone & Merge Reference (.claude), graphify reference: GitHub clone and cross-repo merge, Step 0 - Clone GitHub repo(s) (only if a GitHub URL was given)

### Community 33 - "Queue Priority Scoring"
Cohesion: 0.60
Nodes (4): calculateScore(), getNextFromList(), getNextPatient(), { pool }

## Ambiguous Edges - Review These
- `README.md — Project Overview` → `server_pid.txt — Runtime Process ID Scratch File`  [AMBIGUOUS]
  server_pid.txt · relation: conceptually_related_to
- `Customize Section (admintechnical.html)` → `Clinic Building Exterior Photo`  [AMBIGUOUS]
  public/admintechnical.html · relation: references

## Knowledge Gaps
- **228 isolated node(s):** `graphify`, `Usage`, `What graphify is for`, `Step 0 - GitHub repos and multi-path merge (only if a URL or several paths)`, `Step 1 - Ensure graphify is installed` (+223 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `README.md — Project Overview` and `server_pid.txt — Runtime Process ID Scratch File`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Customize Section (admintechnical.html)` and `Clinic Building Exterior Photo`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `Customer Dashboard Page` connect `Customer Dashboard (customer.js)` to `Laboratory/Doctor Dashboard Assets`, `Virtual Nurse Assistant Widget`?**
  _High betweenness centrality (0.310) - this node is a cross-community bridge._
- **Why does `Clinic Heart Logo SVG (served copy)` connect `Laboratory/Doctor Dashboard Assets` to `Landing Page Auth & Registration`, `Customer Dashboard (customer.js)`, `Admin Technical Dashboard`, `Owner Dashboard`, `Front Desk Dashboard`?**
  _High betweenness centrality (0.287) - this node is a cross-community bridge._
- **Why does `CLAUDE.md — Project Guidance` connect `Project Guidance Docs` to `Queue Priority Scoring`, `Shared Frontend Utilities`, `VA Backend Dialogue Route`, `AI Services & Fallback Chain`, `Role & Auth Config + Packages Route`, `Database Schema & Migrations`?**
  _High betweenness centrality (0.243) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `CLAUDE.md — Project Guidance` (e.g. with `graphify` and `graphify`) actually correct?**
  _`CLAUDE.md — Project Guidance` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `Graphify SKILL.md (.agents)` (e.g. with `rules/graphify.md` and `Graphify SKILL.md (.claude)`) actually correct?**
  _`Graphify SKILL.md (.agents)` has 2 INFERRED edges - model-reasoned connections that need verification._