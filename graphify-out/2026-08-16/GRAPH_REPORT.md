# Graph Report - Attempt1  (2026-08-06)

## Corpus Check
- 51 files · ~58,769 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 498 nodes · 617 edges · 46 communities (34 shown, 12 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 40 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8ff18c84`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- customer.js
- dependencies
- owner.js
- admintechnical.js
- index.js
- What You Must Do When Invoked
- What You Must Do When Invoked
- frontdesk.js
- shared.js
- server.js
- doctor.js
- laboratory.js
- queue.js
- va.js
- auth.js
- graphify reference: extra exports and benchmark
- graphify reference: extra exports and benchmark
- admin.js
- ai_services.js
- Sample Data
- packages.js
- graphify reference: query, path, explain
- graphify reference: query, path, explain
- database.js
- pool
- Medical Clinic Queueing System - Local Setup Instructions
- Customer Side Flowchart & Data Flow Guide
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- AGENTS.md
- rules/graphify.md
- .agents/skills/graphify/references/extraction-spec.md
- workflows/graphify.md
- CLAUDE.md
- .claude/CLAUDE.md
- .claude/skills/graphify/references/extraction-spec.md
- GEMINI.md

## God Nodes (most connected - your core abstractions)
1. `What You Must Do When Invoked` - 12 edges
2. `What You Must Do When Invoked` - 12 edges
3. `/graphify` - 11 edges
4. `/graphify` - 10 edges
5. `pool` - 9 edges
6. `loadLabQueue()` - 8 edges
7. `graphify reference: extra exports and benchmark` - 8 edges
8. `graphify reference: extra exports and benchmark` - 8 edges
9. `loadFdQueue()` - 7 edges
10. `loadDashboard()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `startServer()` --calls--> `initDB()`  [EXTRACTED]
  server.js → database.js

## Import Cycles
- None detected.

## Communities (46 total, 12 thin omitted)

### Community 0 - "customer.js"
Cohesion: 0.09
Nodes (31): APPT_SLOTS, apptNextStep(), apptPrevStep(), bookAppointment(), calendarDate, cancelQueue(), changeCalendarMonth(), checkMandatoryMedicalForm() (+23 more)

### Community 1 - "dependencies"
Cohesion: 0.06
Nodes (33): axios, bcrypt, body-parser, cors, dotenv, express, jsonwebtoken, multer (+25 more)

### Community 2 - "owner.js"
Cohesion: 0.08
Nodes (26): allAudits, allDoctors, allLabs, deleteLab(), deleteUser(), editService(), editUser(), fetchAllLabs() (+18 more)

### Community 3 - "admintechnical.js"
Cohesion: 0.09
Nodes (24): allDoctors, allLabs, deleteLab(), deleteUser(), editService(), editUser(), fetchAllLabs(), initCreateForm() (+16 more)

### Community 4 - "index.js"
Cohesion: 0.07
Nodes (18): authOverlay, captureRegID(), hamburgerBtn, handleRegister(), mobileOverlay, navbar, navLinks, navLinksEl (+10 more)

### Community 5 - "What You Must Do When Invoked"
Cohesion: 0.07
Nodes (26): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+18 more)

### Community 6 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 7 - "frontdesk.js"
Cohesion: 0.13
Nodes (16): allFdLogs, allLabs, editService(), fdCallNext(), fdComplete(), filterFdLogs(), labSequence, loadFdQueue() (+8 more)

### Community 8 - "shared.js"
Cohesion: 0.13
Nodes (10): authHeaders(), getRole(), getToken(), getUserId(), getUsername(), initDefaultSection(), logout(), navigateTo() (+2 more)

### Community 9 - "server.js"
Cohesion: 0.09
Nodes (19): adminRoutes, app, authRoutes, bcrypt, bodyParser, cors, dotenv, express (+11 more)

### Community 10 - "doctor.js"
Cohesion: 0.22
Nodes (16): addPrescriptionItem(), commitClinicalRecord(), docCallNext(), docComplete(), findMyDoctor(), loadDocQueue(), loadDraftFromLocalStorage(), loadPatientMedicalFile() (+8 more)

### Community 11 - "laboratory.js"
Cohesion: 0.25
Nodes (13): addWorkspaceLabNote(), allLabLogs, filterLabLogs(), findMyLab(), labCallNext(), labComplete(), loadLabQueue(), loadResultsWorkspace() (+5 more)

### Community 12 - "queue.js"
Cohesion: 0.19
Nodes (13): calculateScore(), getNextFromList(), getNextPatient(), { pool }, buildPackagePreview(), express, getCurrentProcessing(), getPackageSteps() (+5 more)

### Community 13 - "va.js"
Cohesion: 0.37
Nodes (12): addVaHistory(), bindVaListeners(), processVoiceCommand(), renderVaHistory(), setVaStatus(), speakAloud(), startSpeechRecognition(), stopSpeechRecognition() (+4 more)

### Community 14 - "auth.js"
Cohesion: 0.20
Nodes (8): aiServices, bcrypt, express, jwt, multer, { pool }, router, upload

### Community 15 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 16 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 17 - "admin.js"
Cohesion: 0.25
Nodes (6): bcrypt, crypto, express, { pool }, QRCode, router

### Community 18 - "ai_services.js"
Cohesion: 0.38
Nodes (6): aiServices, axios, callMockAI(), checkAIToggle(), logAI(), { pool }

### Community 19 - "Sample Data"
Cohesion: 0.29
Nodes (6): Doctor Stations, Example Test Accounts, Laboratories, Role Descriptions, Sample Data, Service Packages

### Community 20 - "packages.js"
Cohesion: 0.29
Nodes (5): aiServices, express, jwt, { pool }, router

### Community 21 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 22 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 23 - "database.js"
Cohesion: 0.47
Nodes (5): addColumnIfMissing(), addIndexIfMissing(), DEFAULT_SERVICES, initDB(), mysql

### Community 24 - "pool"
Cohesion: 0.33
Nodes (5): pool, aiServices, express, { pool }, router

### Community 25 - "Medical Clinic Queueing System - Local Setup Instructions"
Cohesion: 0.33
Nodes (5): 1. Prerequisites, 2. MySQL Setup, 3. Running the Application Locally, 4. Features, Medical Clinic Queueing System - Local Setup Instructions

### Community 26 - "Customer Side Flowchart & Data Flow Guide"
Cohesion: 0.40
Nodes (4): 1. Registration & Authentication Flow, 2. Customer Dashboard & Core Actions Flow, 3. Real-time Status Data Flow Diagram (DFD), Customer Side Flowchart & Data Flow Guide

### Community 27 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 28 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 29 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 30 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 31 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 32 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

## Knowledge Gaps
- **195 isolated node(s):** `axios`, `{ pool }`, `aiServices`, `mysql`, `name` (+190 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pool` connect `pool` to `server.js`, `queue.js`, `auth.js`, `admin.js`, `ai_services.js`, `packages.js`, `database.js`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `axios`, `{ pool }`, `aiServices` to the rest of the system?**
  _195 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `customer.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09103840682788052 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `owner.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08377896613190731 - nodes in this community are weakly interconnected._
- **Should `admintechnical.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08522727272727272 - nodes in this community are weakly interconnected._
- **Should `index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07459677419354839 - nodes in this community are weakly interconnected._