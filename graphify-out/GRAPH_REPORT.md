# Graph Report - Attempt1  (2026-09-03)

## Corpus Check
- 234 files · ~441,509 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1952 nodes · 3380 edges · 114 communities (107 shown, 7 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 173 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ccd9dcc7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.js
- customer.js
- admin-shared.js
- dependencies
- _palette_is_dark
- Customer Dashboard & Core Actions Flow
- va.js
- frontdesk.js
- server.js
- shared.js
- queue.js
- .claude/skills/ui-ux-pro-max/scripts/validate_data.py
- CLAUDE.md — Project Guidance
- ai_services.js
- laboratory.js
- graphify reference: extra exports and benchmark
- auth.js
- Update & Cluster-Only Reference (.agents)
- What You Must Do When Invoked
- authHeaders
- test_structures.js
- graphify reference: query, path, explain
- What You Must Do When Invoked
- Graphify SKILL.md (.agents)
- /graphify
- DesignSystemGenerator
- auth.ts
- Medical Clinic Queueing System
- Add-Watch Reference (.agents)
- .claude/skills/ui-ux-pro-max/scripts/core.py
- Extraction Subagent Spec (.agents)
- Sample Data
- GitHub Clone & Merge Reference (.agents)
- .generate
- pytesseract_ocr.py
- CLAUDE.md
- session_activity.js
- search_stack
- search
- BM25
- .claude/skills/ui-ux-pro-max/scripts/design_system.py
- .claude/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py
- admin.js
- UI/UX Pro Max - Design Intelligence
- TestThresholdGate
- CatalogRefreshTest
- read_rows
- .agents/skills/ui-ux-pro-max/scripts/validate_data.py
- graphify reference: extra exports and benchmark
- Pre-Delivery Checklist (canonical — the only one)
- Quick Reference
- detect_domain
- _style_is_dark_primary
- /graphify
- test_text_layout_resilience.py
- _search_csv_detailed
- .agents/skills/ui-ux-pro-max/scripts/core.py
- _suggest_identities
- Web Interface Guidelines
- ui-ux-pro-max.md
- web-design-guidelines.md
- Query/Path/Explain Reference (.agents)
- Skills Resolution & Global Skills Rule
- applyLoadedSettings
- search_stack
- parse_decision_rules
- search
- read_rows
- BM25
- .agents/skills/ui-ux-pro-max/scripts/design_system.py
- DesignSystemGenerator
- parse_decision_rules
- UI/UX Pro Max - Design Intelligence
- TestThresholdGate
- CatalogRefreshTest
- detect_domain
- build-psgc-data.js
- Pre-Delivery Checklist (canonical — the only one)
- Quick Reference
- applyBranding
- .agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py
- generate_design_system
- .agents/skills/ui-ux-pro-max/scripts/tests/test_text_layout_resilience.py
- _normalize
- .generate
- appointment_automation.js
- packages.js
- queue_automation.js
- setupAnnouncementComposer
- Web Interface Guidelines
- clinic-pdf.js
- getRole
- escapeHtml
- doctor.js
- AI Agent Instructions & Skills
- graphify reference: query, path, explain
- walkin-screen.js
- walkin.js
- public/display.js
- better_auth.mjs
- admintechnical.js
- _select_palette_for_mode
- Clinic Heart Logo SVG (served copy)
- loadFdQueue
- generate_design_system
- pool
- walkin-forms.js
- paintSkeleton
- renderStructureFieldRows
- loadServiceMgmt
- loadArchives
- fetchAllLabs
- loadAccounts
- renderLabSequence

## God Nodes (most connected - your core abstractions)
1. `DesignSystemGenerator` - 64 edges
2. `search()` - 46 edges
3. `search()` - 46 edges
4. `search_stack()` - 35 edges
5. `search_stack()` - 35 edges
6. `DesignSystemGenerator` - 32 edges
7. `BM25` - 30 edges
8. `CLAUDE.md — Project Guidance` - 28 edges
9. `pool` - 19 edges
10. `detect_domain()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Zero-Migration Auto Schema Creation` --references--> `initDB()`  [EXTRACTED]
  INSTRUCTIONS.md → database.js
- `CLAUDE.md — Project Guidance` --references--> `nvidiaFallback()`  [EXTRACTED]
  CLAUDE.md → ai_services.js
- `CLAUDE.md — Project Guidance` --references--> `checkAIToggle()`  [EXTRACTED]
  CLAUDE.md → ai_services.js
- `CLAUDE.md — Project Guidance` --references--> `callMockAI()`  [EXTRACTED]
  CLAUDE.md → ai_services.js
- `README.md — Project Overview` --references--> `callMockAI()`  [EXTRACTED]
  README.md → ai_services.js

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

## Communities (114 total, 7 thin omitted)

### Community 0 - "index.js"
Cohesion: 0.05
Nodes (64): abandonPendingRegistration(), announceSessionTimeout(), authOverlay, cancelLoginOTP(), captureRegID(), checkPasswordMatch(), checkPasswordStrength(), closeAuthPanel() (+56 more)

### Community 1 - "customer.js"
Cohesion: 0.06
Nodes (61): allPackages, APPT_SLOTS, apptNextStep(), apptPrevStep(), bookAppointment(), calendarDate, cancelQueue(), changeCalendarMonth() (+53 more)

### Community 2 - "admin-shared.js"
Cohesion: 0.08
Nodes (19): allDoctors, allLabs, allServices, archiveCache, AUDIT_ACTION_STYLES, auditCache, customerCache, formatAuditDetail() (+11 more)

### Community 3 - "dependencies"
Cohesion: 0.05
Nodes (38): axios, bcrypt, better-auth, body-parser, cors, dotenv, @emailjs/nodejs, express (+30 more)

### Community 4 - "_palette_is_dark"
Cohesion: 0.18
Nodes (7): _palette_is_dark(), WCAG relative luminance of a #RRGGBB string, or None if unparseable., True when a colors.csv row's Background is a dark surface., _relative_luminance(), The exact reproduction from issue #428., TestEndToEndCoherence, TestLuminance

### Community 5 - "Customer Dashboard & Core Actions Flow"
Cohesion: 0.08
Nodes (30): 1. Registration & Authentication Flow, 2. Customer Dashboard & Core Actions Flow, 3. Real-time Status Data Flow Diagram (DFD), Book an Appointment Flow, Customer Dashboard & Core Actions Flow, Customer Side Flowchart & Data Flow Guide, Join a Service Queue Flow, Login Flow (+22 more)

### Community 6 - "va.js"
Cohesion: 0.16
Nodes (28): Virtual Nurse Assistant Widget (customer.html), addVaHistory(), answerQueueStatus(), answerWaitTime(), bindVaListeners(), bubbleReadMs(), clearVaHistory(), dismissVaBubble() (+20 more)

### Community 7 - "frontdesk.js"
Cohesion: 0.11
Nodes (21): allFdLogs, allLabs, allServices, archiveService(), editService(), fetchLabs(), labSequence, loadServiceMgmt() (+13 more)

### Community 8 - "server.js"
Cohesion: 0.06
Nodes (40): DB_CONFIG, DEFAULT_SERVICES, DEFAULT_TEST_STRUCTURES, DOCTOR_SEEDS, LAB_SEEDS, mysql, SERVICE_STEPS, STAFF_SEEDS (+32 more)

### Community 9 - "shared.js"
Cohesion: 0.07
Nodes (21): ANNOUNCEMENT_STATION_BY_ROLE, CUSTOMIZE_FIELDS, dismissedAnnouncementIds, enforcePasswordPolicy(), initDefaultSection(), navigateTo(), RICH_TEXT_COMMANDS, RICH_TEXT_DROP_CONTENT (+13 more)

### Community 10 - "queue.js"
Cohesion: 0.08
Nodes (27): getPackageSteps(), aiServices, { buildCustomerStatus }, express, loadAssistantContext(), { pool }, router, announceCall() (+19 more)

### Community 11 - ".claude/skills/ui-ux-pro-max/scripts/validate_data.py"
Cohesion: 0.08
Nodes (46): read_rows(), TestAccessibilityGuidance, TestChartsTypographyAndIcons, TestCurrentReactGuidance, TestSemanticColors, _catalog_date(), _check_app_interface_contract(), _check_catalog_contract() (+38 more)

### Community 12 - "CLAUDE.md — Project Guidance"
Cohesion: 0.14
Nodes (23): graphify, CLAUDE.md — Project Guidance, Graphify Knowledge Graph Tool, Priority Queueing (Senior/PWD/Pregnant), Role-Based Access Matrix, Seeded Dev Accounts, Auto-Migrating Schema Convention (addColumnIfMissing/addIndexIfMissing in initDB), Soft Deletion Convention (archived/archived_at columns, no hard deletes) (+15 more)

### Community 13 - "ai_services.js"
Cohesion: 0.09
Nodes (19): aiServices, axios, callMockAI(), checkAIToggle(), dotenv, fs, GEMINI_ID_PROMPT, GEMINI_ID_SCHEMA (+11 more)

### Community 14 - "laboratory.js"
Cohesion: 0.18
Nodes (20): addWorkspaceLabNote(), allLabLogs, currentTestStructure(), filterLabLogs(), findMyLab(), labAdvance(), labCallBack(), labCallNext() (+12 more)

### Community 15 - "graphify reference: extra exports and benchmark"
Cohesion: 0.25
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 16 - "auth.js"
Cohesion: 0.08
Nodes (15): aiServices, bcrypt, express, fs, jwt, { JWT_SECRET }, LOGIN_REDIRECT_MAP, multer (+7 more)

### Community 17 - "Update & Cluster-Only Reference (.agents)"
Cohesion: 0.14
Nodes (15): Transcribe Reference (.agents), graphify reference: transcribe video and audio, Step 2.5 - Transcribe video / audio files (only if video files detected), Update & Cluster-Only Reference (.agents), For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only, Stamp-Only-On-Output Manifest Rule (+7 more)

### Community 18 - "What You Must Do When Invoked"
Cohesion: 0.13
Nodes (15): Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Part C - Merge AST + semantic into final extraction, Step 0 - GitHub repos and multi-path merge (only if a URL or several paths), Step 1 - Ensure graphify is installed, Step 2.5 - Video and audio (only if video files detected), Step 2 - Detect files, Step 3 - Extract entities and relationships (+7 more)

### Community 19 - "authHeaders"
Cohesion: 0.28
Nodes (13): ACTIVITY_EVENTS, authHeaders(), dismissIdleWarning(), endSessionForInactivity(), getToken(), getUserId(), initIdleTimeout(), installSessionExpiryInterceptor() (+5 more)

### Community 20 - "test_structures.js"
Cohesion: 0.12
Nodes (24): ARCHIVE_TABLE_MAP, archiveRecord(), describeRecord(), { pool }, { recordAudit, scrubSnapshot }, diffSnapshots(), normalizeReason(), { pool } (+16 more)

### Community 21 - "graphify reference: query, path, explain"
Cohesion: 0.40
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 22 - "What You Must Do When Invoked"
Cohesion: 0.13
Nodes (15): Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Part C - Merge AST + semantic into final extraction, Step 0 - GitHub repos and multi-path merge (only if a URL or several paths), Step 1 - Ensure graphify is installed, Step 2.5 - Video and audio (only if video files detected), Step 2 - Detect files, Step 3 - Extract entities and relationships (+7 more)

### Community 23 - "Graphify SKILL.md (.agents)"
Cohesion: 0.16
Nodes (12): graphify, Exports & Benchmark Reference (.agents), Graphify SKILL.md (.agents), Honesty Rules, Graphify Full Pipeline (Steps 0-9), #479 Shrink-Guard, Workflow: graphify, graphify (+4 more)

### Community 24 - "/graphify"
Cohesion: 0.25
Nodes (8): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Interpreter guard for subcommands, Usage, What graphify is for

### Community 25 - "DesignSystemGenerator"
Cohesion: 0.11
Nodes (9): DesignSystemGenerator, Generates design system recommendations from aggregated searches., Load reasoning rules from CSV., Find matching reasoning rule for a category., Apply reasoning rules to search results., Select best matching result based on priority keywords., TestReasoningMatch, The exact reproduction from issue #428. (+1 more)

### Community 27 - "Medical Clinic Queueing System"
Cohesion: 0.22
Nodes (8): Key routes, Medical Clinic Queueing System, Notes, Roles & access, Scripts, Seed accounts (dev only — change before any real deployment), Setup, Stack

### Community 28 - "Add-Watch Reference (.agents)"
Cohesion: 0.25
Nodes (8): Add-Watch Reference (.agents), For /graphify add, For --watch, graphify reference: add a URL and watch a folder, Add-Watch Reference (.claude), For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 29 - ".claude/skills/ui-ux-pro-max/scripts/core.py"
Cohesion: 0.10
Nodes (29): _contains_phrase(), _domain_keywords(), _file_signature(), _get_bm25(), _load_csv(), _load_csv_snapshot(), _load_product_keywords(), _load_rows_or_empty() (+21 more)

### Community 30 - "Extraction Subagent Spec (.agents)"
Cohesion: 0.33
Nodes (7): Extraction Subagent Spec (.agents), Discrete Confidence Rubric, graphify reference: extraction subagent prompt, Node ID Format Rule, Extraction Subagent Spec (.claude), Discrete Confidence Rubric, graphify reference: extraction subagent prompt

### Community 31 - "Sample Data"
Cohesion: 0.29
Nodes (6): Doctor Stations, Example Test Accounts, Laboratories, Role Descriptions, Sample Data, Service Packages

### Community 32 - "GitHub Clone & Merge Reference (.agents)"
Cohesion: 0.33
Nodes (6): GitHub Clone & Merge Reference (.agents), graphify reference: GitHub clone and cross-repo merge, Step 0 - Clone GitHub repo(s) (only if a GitHub URL was given), GitHub Clone & Merge Reference (.claude), graphify reference: GitHub clone and cross-repo merge, Step 0 - Clone GitHub repo(s) (only if a GitHub URL was given)

### Community 33 - ".generate"
Cohesion: 0.16
Nodes (8): _filter_anti_patterns_for_mode(), Drop "avoid dark mode" advice once dark mode is the resolved answer., Execute searches across multiple domains., Extract results list from search result dict., Generate complete design system recommendation. variance/motion/density are…, Bucket a 1-10 dial value into its tier config. Returns None if value is None., _resolve_dial(), TestAntiPatternGating

### Community 36 - "session_activity.js"
Cohesion: 0.24
Nodes (14): issueSessionToken(), activity, enforceIdleTimeout(), getLastActivity(), inspect(), isStaffRole(), loadLastActivity(), now() (+6 more)

### Community 37 - "search_stack"
Cohesion: 0.11
Nodes (6): Search stack-specific guidelines, search_stack(), _rows(), TestNativeDesktopStackFreshness, _rows(), TestWebStackFreshness

### Community 38 - "search"
Cohesion: 0.11
Nodes (9): _exact_stack_identifier(), Resolve a deprecated in-domain alias, or expose a cross-domain redirect., Main search function with auto-domain detection, Resolve a standalone API identifier even when its BM25 IDF is low., search(), _style_search_destination(), TestSearchDomains, read_rows() (+1 more)

### Community 39 - "BM25"
Cohesion: 0.16
Nodes (5): BM25, BM25 ranking algorithm for text search, TestBm25CoreBehavior, TestDiagnosticsContracts, TestTokenizer

### Community 40 - ".claude/skills/ui-ux-pro-max/scripts/design_system.py"
Cohesion: 0.11
Nodes (25): ansi_ljust(), _detect_page_type(), format_ascii_box(), format_markdown(), format_master_md(), format_page_override_md(), _generate_intelligent_overrides(), hex_to_ansi() (+17 more)

### Community 41 - ".claude/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py"
Cohesion: 0.16
Nodes (12): _contrast_ratio(), _derive_dark_palette(), _palette_is_dark(), WCAG relative luminance of a #RRGGBB string, or None if unparseable., True when a colors.csv row's Background is a dark surface., WCAG contrast ratio for two hex colors, or None if either is invalid., Keep product brand tokens while deriving accessible dark surfaces., Pick the highest-ranked palette matching the resolved mode. Only the dark case… (+4 more)

### Community 42 - "admin.js"
Cohesion: 0.09
Nodes (21): ALLOWED_TAGS, hasRichTextContent(), richTextToPlain(), sanitizeRichText(), aiServices, ANNOUNCEMENT_DEPARTMENT_NAMES, appointmentAutomation, { archiveRecord, ARCHIVE_TABLE_MAP } (+13 more)

### Community 43 - "UI/UX Pro Max - Design Intelligence"
Cohesion: 0.11
Nodes (17): Before Delivering App UI, Example Workflow, If a search returns 0 results, Output Formats, Query Contract, Rule Categories by Priority, Running the search tool, Step 1: Analyze User Requirements (+9 more)

### Community 44 - "TestThresholdGate"
Cohesion: 0.13
Nodes (3): TestFixtureValidation, TestMetricMath, TestThresholdGate

### Community 46 - "read_rows"
Cohesion: 0.11
Nodes (7): read_rows(), split_values(), style_identities(), TestGeneratedCatalogContract, TestLandingAndStackContract, TestReasoningContract, TestStyleIdentityContract

### Community 47 - ".agents/skills/ui-ux-pro-max/scripts/validate_data.py"
Cohesion: 0.08
Nodes (45): read_rows(), TestAccessibilityGuidance, TestChartsTypographyAndIcons, TestCurrentReactGuidance, TestSemanticColors, _catalog_date(), _check_app_interface_contract(), _check_catalog_contract() (+37 more)

### Community 48 - "graphify reference: extra exports and benchmark"
Cohesion: 0.25
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 49 - "Pre-Delivery Checklist (canonical — the only one)"
Cohesion: 0.15
Nodes (12): Accessibility, Common Rules for Professional UI + Pre-Delivery Checklist, Icons & Visual Elements, Interaction, Interaction (App), Layout, Layout & Spacing, Light/Dark Mode (+4 more)

### Community 50 - "Quick Reference"
Cohesion: 0.15
Nodes (12): 10. Charts & Data (LOW), 1. Accessibility (CRITICAL), 2. Touch & Interaction (CRITICAL), 3. Performance (HIGH), 4. Style Selection (HIGH), 5. Layout & Responsive (HIGH), 6. Typography & Color (MEDIUM), 7. Animation (MEDIUM) (+4 more)

### Community 51 - "detect_domain"
Cohesion: 0.23
Nodes (3): detect_domain(), Auto-detect the most relevant domain from query. Matches are weighted by…, TestDomainDetection

### Community 52 - "_style_is_dark_primary"
Cohesion: 0.21
Nodes (7): _query_wants_dark(), True when a styles.csv row describes itself as dark-first., True when the query explicitly asks for a dark theme., Resolve the mode the rest of the output has to agree with., _resolve_color_mode(), _style_is_dark_primary(), TestModeResolution

### Community 53 - "/graphify"
Cohesion: 0.20
Nodes (10): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Interpreter guard for subcommands, PowerShell 5.1: Vertical scrolling stops working, Troubleshooting (+2 more)

### Community 54 - "test_text_layout_resilience.py"
Cohesion: 0.22
Nodes (3): read_rows(), TestTextLayoutDataContracts, TestTextLayoutRetrieval

### Community 55 - "_search_csv_detailed"
Cohesion: 0.16
Nodes (14): _contains_phrase(), _passes_threshold(), _query_coverage(), Lowercase, normalize synonyms, split, remove punctuation, filter stopwords, Score all documents against query, All indexed terms, for suggestion/typo-recovery purposes., Calibrated search returning results, index, and internal diagnostics., Backward-compatible internal search tuple used by existing callers/tests. (+6 more)

### Community 56 - ".agents/skills/ui-ux-pro-max/scripts/core.py"
Cohesion: 0.10
Nodes (29): _domain_keywords(), _exact_match_diagnostic(), _exact_row_identity(), _file_signature(), _legacy_successor_guidance(), _load_csv(), _load_csv_snapshot(), _load_product_keywords() (+21 more)

### Community 57 - "_suggest_identities"
Cohesion: 0.25
Nodes (8): _exact_row_identity(), Suggest complete public identities so a retry can bypass score thresholds., Return non-empty public identities from ordinary and alias fields., Resolve an explicit style identity without opening generic variant ranking., Return one row whose stable public identity exactly matches the query., _row_identities(), _style_identity(), _suggest_identities()

### Community 58 - "Web Interface Guidelines"
Cohesion: 0.40
Nodes (4): Guidelines Source, How It Works, Usage, Web Interface Guidelines

### Community 61 - "Query/Path/Explain Reference (.agents)"
Cohesion: 0.20
Nodes (10): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration, Query/Path/Explain Reference (.agents), Constrained Query Vocabulary Expansion, Work Memory / Self-Improving Loop, For git commit hook, For native CLAUDE.md integration (+2 more)

### Community 62 - "Skills Resolution & Global Skills Rule"
Cohesion: 0.50
Nodes (3): Available Global Skills, Skill Resolution Priority, Skills Resolution & Global Skills Rule

### Community 63 - "applyLoadedSettings"
Cohesion: 0.18
Nodes (12): applyBackgroundImage(), applyLoadedSettings(), applyNavbarColor(), applySiteSettings(), applyTheme(), cssUrlValue(), fetchSiteSettings(), hexToRgb() (+4 more)

### Community 64 - "search_stack"
Cohesion: 0.10
Nodes (8): _exact_stack_identifier(), Resolve a standalone API identifier even when its BM25 IDF is low., Search stack-specific guidelines, search_stack(), _rows(), TestNativeDesktopStackFreshness, _rows(), TestWebStackFreshness

### Community 65 - "parse_decision_rules"
Cohesion: 0.31
Nodes (6): apply_decision_rules(), _object_without_duplicates(), parse_decision_rules(), Return deterministic mutations and an audit trail; never execute data., Parse the canonical condition -> action-array representation., _validate_action()

### Community 66 - "search"
Cohesion: 0.11
Nodes (7): Resolve a deprecated in-domain alias, or expose a cross-domain redirect., Main search function with auto-domain detection, search(), _style_search_destination(), TestSearchDomains, read_rows(), TestStyleTaxonomy

### Community 67 - "read_rows"
Cohesion: 0.10
Nodes (8): read_rows(), split_values(), style_identities(), TestGeneratedCatalogContract, TestLandingAndStackContract, TestReasoningContract, TestStyleIdentityContract, _check_reasoning_contract()

### Community 68 - "BM25"
Cohesion: 0.14
Nodes (8): BM25, _get_bm25(), BM25 ranking algorithm for text search, Build BM25 index from documents, Fitted index with cache identity covering fields and scorer version., TestBm25CoreBehavior, TestDiagnosticsContracts, TestTokenizer

### Community 69 - ".agents/skills/ui-ux-pro-max/scripts/design_system.py"
Cohesion: 0.12
Nodes (23): ansi_ljust(), _detect_page_type(), format_ascii_box(), format_master_md(), format_page_override_md(), _generate_intelligent_overrides(), hex_to_ansi(), persist_design_system() (+15 more)

### Community 70 - "DesignSystemGenerator"
Cohesion: 0.22
Nodes (5): DesignSystemGenerator, Generates design system recommendations from aggregated searches., Load reasoning rules from CSV., Select best matching result based on priority keywords., TestReasoningMatch

### Community 71 - "parse_decision_rules"
Cohesion: 0.19
Nodes (8): Find matching reasoning rule for a category., Apply reasoning rules to search results., apply_decision_rules(), _object_without_duplicates(), parse_decision_rules(), Return deterministic mutations and an audit trail; never execute data., Parse the canonical condition -> action-array representation., _validate_action()

### Community 72 - "UI/UX Pro Max - Design Intelligence"
Cohesion: 0.11
Nodes (17): Before Delivering App UI, Example Workflow, If a search returns 0 results, Output Formats, Query Contract, Rule Categories by Priority, Running the search tool, Step 1: Analyze User Requirements (+9 more)

### Community 73 - "TestThresholdGate"
Cohesion: 0.13
Nodes (3): TestFixtureValidation, TestMetricMath, TestThresholdGate

### Community 75 - "detect_domain"
Cohesion: 0.23
Nodes (3): detect_domain(), Auto-detect the most relevant domain from query. Matches are weighted by…, TestDomainDetection

### Community 76 - "build-psgc-data.js"
Cohesion: 0.27
Nodes (9): BRGY_DIR, byName(), fs, getJson(), main(), OUT_DIR, path, provinceKeyOf() (+1 more)

### Community 77 - "Pre-Delivery Checklist (canonical — the only one)"
Cohesion: 0.15
Nodes (12): Accessibility, Common Rules for Professional UI + Pre-Delivery Checklist, Icons & Visual Elements, Interaction, Interaction (App), Layout, Layout & Spacing, Light/Dark Mode (+4 more)

### Community 78 - "Quick Reference"
Cohesion: 0.15
Nodes (12): 10. Charts & Data (LOW), 1. Accessibility (CRITICAL), 2. Touch & Interaction (CRITICAL), 3. Performance (HIGH), 4. Style Selection (HIGH), 5. Layout & Responsive (HIGH), 6. Typography & Color (MEDIUM), 7. Animation (MEDIUM) (+4 more)

### Community 79 - "applyBranding"
Cohesion: 0.24
Nodes (10): accountCategoryLabel(), applyBranding(), buildMobileTopbar(), getCategory(), getUsername(), renderSidebar(), SITE_LOGO_SELECTORS, SITE_NAME_SELECTORS (+2 more)

### Community 80 - ".agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py"
Cohesion: 0.26
Nodes (7): _query_wants_dark(), True when a styles.csv row describes itself as dark-first., True when the query explicitly asks for a dark theme., Resolve the mode the rest of the output has to agree with., _resolve_color_mode(), _style_is_dark_primary(), TestModeResolution

### Community 81 - "generate_design_system"
Cohesion: 0.25
Nodes (5): generate_design_system(), Main entry point for design system generation. Args: query: Search query (e.g.,…, format_output(), Format results for Claude consumption (token-optimized), TestPersistence

### Community 82 - ".agents/skills/ui-ux-pro-max/scripts/tests/test_text_layout_resilience.py"
Cohesion: 0.22
Nodes (3): read_rows(), TestTextLayoutDataContracts, TestTextLayoutRetrieval

### Community 83 - "_normalize"
Cohesion: 0.25
Nodes (9): _exact_match_diagnostic(), _legacy_successor_guidance(), _normalize(), Apply longest-first synonym substitution at token boundaries., Whether a stack query explicitly targets an older framework generation., Choose one coherent applicability generation for stack retrieval., Prefer the explicit successor row for a brand-new app on legacy-only stacks., _stack_query_requests_legacy() (+1 more)

### Community 84 - ".generate"
Cohesion: 0.16
Nodes (8): _filter_anti_patterns_for_mode(), Drop "avoid dark mode" advice once dark mode is the resolved answer., Execute searches across multiple domains., Extract results list from search result dict., Generate complete design system recommendation. variance/motion/density are…, Bucket a 1-10 dial value into its tier config. Returns None if value is None., _resolve_dial(), TestAntiPatternGating

### Community 85 - "appointment_automation.js"
Cohesion: 0.43
Nodes (6): appointmentPrice(), findMissedAppointments(), { pool }, startMissedAppointmentSweep(), sweepMissedAppointments(), sweepQuietly()

### Community 86 - "packages.js"
Cohesion: 0.12
Nodes (15): ADMIN_ROLES, requireAdmin(), requireStaff(), STAFF_ROLES, aiServices, { APPOINTMENT_SURCHARGE_PCT, appointmentPrice }, { archiveRecord }, { composeServiceSteps } (+7 more)

### Community 87 - "queue_automation.js"
Cohesion: 0.15
Nodes (15): composeServiceSteps(), FRONT_DESK_FINAL_STEP, FRONT_DESK_STEP, getNextFromList(), getNextPatient(), hasServiceStations(), orderWaitingList(), peekTicketNumber() (+7 more)

### Community 88 - "setupAnnouncementComposer"
Cohesion: 0.32
Nodes (8): closeModal(), draftAnnouncement(), openAnnouncementComposer(), openModal(), saveCustomization(), sendAnnouncement(), setupAnnouncementComposer(), showToast()

### Community 89 - "Web Interface Guidelines"
Cohesion: 0.40
Nodes (4): Guidelines Source, How It Works, Usage, Web Interface Guidelines

### Community 90 - "clinic-pdf.js"
Cohesion: 0.11
Nodes (3): PDF, pdfLetterhead(), spacedTitle()

### Community 91 - "getRole"
Cohesion: 0.25
Nodes (9): ANNOUNCEMENT_STAFF_ROLES, getRole(), initAnnouncements(), initSocket(), publishAnnouncementHeight(), refreshAnnouncementBanner(), renderAnnouncementBanner(), requireAuth() (+1 more)

### Community 92 - "escapeHtml"
Cohesion: 0.43
Nodes (7): buildDialog(), confirmAction(), escapeHtml(), initRichTextEditor(), promptReason(), reflectRichTextState(), resetCustomization()

### Community 93 - "doctor.js"
Cohesion: 0.21
Nodes (18): addPrescriptionItem(), commitClinicalRecord(), docAdvance(), docCallBack(), docCallNext(), findMyDoctor(), loadDocQueue(), loadDraftFromLocalStorage() (+10 more)

### Community 94 - "AI Agent Instructions & Skills"
Cohesion: 0.40
Nodes (4): AI Agent Instructions & Skills, Skills Resolution Priority, ui-ux-pro-max, web-design-guidelines

### Community 95 - "graphify reference: query, path, explain"
Cohesion: 0.40
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 96 - "walkin-screen.js"
Cohesion: 0.18
Nodes (19): initWalkInScreen(), loadWalkIns(), loadWalkInServices(), registerWalkIn(), renderWalkInList(), resetWalkInForm(), WALKIN_ELEVATED_ROLES, WALKIN_HOLD_PRESETS (+11 more)

### Community 97 - "walkin.js"
Cohesion: 0.12
Nodes (12): bcrypt, CATEGORIES, crypto, express, GENDERS, { pool }, { recordAudit }, requireWalkInAuthority() (+4 more)

### Community 98 - "public/display.js"
Cohesion: 0.21
Nodes (13): dispChime(), dispDrainQueue(), dispEnqueueAnnouncement(), dispEscape(), dispLoad(), dispQueue, dispRenderStations(), dispSetStatus() (+5 more)

### Community 99 - "better_auth.mjs"
Cohesion: 0.15
Nodes (10): emailjs, sendOtpEmail(), sendPasswordResetEmail(), auth, loadAuthModule(), ensureShadowUser(), { pool }, require (+2 more)

### Community 100 - "admintechnical.js"
Cohesion: 0.16
Nodes (8): archiveStructure(), initCreateForm(), loadAuditLogs(), loadTestStructureAdmin(), populateAuditFacets(), renderStructureList(), saveStructure(), myRole

### Community 101 - "_select_palette_for_mode"
Cohesion: 0.22
Nodes (7): _contrast_ratio(), _derive_dark_palette(), WCAG contrast ratio for two hex colors, or None if either is invalid., Keep product brand tokens while deriving accessible dark surfaces., Pick the highest-ranked palette matching the resolved mode. Only the dark case…, _select_palette_for_mode(), TestPaletteSelection

### Community 102 - "Clinic Heart Logo SVG (served copy)"
Cohesion: 0.21
Nodes (12): Clinic Heart Logo SVG (repo root copy), Admin Technical Page, Customize Section (admintechnical.html), Doctor Dashboard Page, fdCallNext(), openEditPatientModal(), Front Desk Page, Payment Queue Section (frontdesk.html) (+4 more)

### Community 103 - "loadFdQueue"
Cohesion: 0.18
Nodes (12): fdAdvance(), fdCallBack(), fdFinalize(), filterFdLogs(), loadFdQueue(), loadPatientInfoPanel(), onQueueUpdate(), renderFdLogs() (+4 more)

### Community 104 - "generate_design_system"
Cohesion: 0.20
Nodes (7): format_markdown(), generate_design_system(), Format design system as markdown., Main entry point for design system generation. Args: query: Search query (e.g.,…, format_output(), Format results for Claude consumption (token-optimized), TestPersistence

### Community 105 - "pool"
Cohesion: 0.18
Nodes (9): pool, express, { pool }, queueAutomation, router, aiServices, express, { pool } (+1 more)

### Community 106 - "walkin-forms.js"
Cohesion: 0.35
Nodes (10): printWalkInForm(), WALKIN_HISTORY_CHECKLIST, WALKIN_HISTORY_QUESTIONS, wfBuildDiagnosisForm(), wfBuildIntakeForm(), wfClinic(), wfDate(), wfDateTime() (+2 more)

### Community 107 - "paintSkeleton"
Cohesion: 0.25
Nodes (9): clearSkeleton(), paintSkeleton(), skeletonCards(), skeletonLines(), skeletonSafe(), skeletonStats(), skeletonTable(), skeletonTarget() (+1 more)

### Community 108 - "renderStructureFieldRows"
Cohesion: 0.43
Nodes (7): addStructureField(), blankStructureField(), editStructure(), prepareNewStructure(), removeStructureField(), renderStructureFieldRows(), updateStructureField()

### Community 109 - "loadServiceMgmt"
Cohesion: 0.33
Nodes (6): archiveService(), loadServiceMgmt(), populateCategoryControls(), renderServiceList(), saveService(), serviceRouteLabel()

### Community 110 - "loadArchives"
Cohesion: 0.33
Nodes (6): loadArchives(), loadDeletionLogs(), populateArchiveTypes(), purgeArchive(), renderArchives(), restoreArchive()

### Community 111 - "fetchAllLabs"
Cohesion: 0.50
Nodes (5): deleteLab(), fetchAllLabs(), loadLabs(), populateDoctorSelect(), saveLab()

### Community 112 - "loadAccounts"
Cohesion: 0.40
Nodes (5): deleteUser(), loadAccounts(), renderCustomerTable(), renderStaffTable(), updateUser()

### Community 113 - "renderLabSequence"
Cohesion: 0.50
Nodes (5): editService(), populateStructureSelect(), prepareNewService(), removeLabStep(), renderLabSequence()

## Ambiguous Edges - Review These
- `Customize Section (admintechnical.html)` → `Clinic Building Exterior Photo`  [AMBIGUOUS]
  public/admintechnical.html · relation: references

## Knowledge Gaps
- **427 isolated node(s):** `axios`, `{ pool }`, `{ spawn }`, `path`, `fs` (+422 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Customize Section (admintechnical.html)` and `Clinic Building Exterior Photo`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `CLAUDE.md — Project Guidance` connect `CLAUDE.md — Project Guidance` to `server.js`, `queue.js`, `ai_services.js`, `authHeaders`, `packages.js`, `queue_automation.js`, `getRole`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Why does `DesignSystemGenerator` connect `DesignSystemGenerator` to `_palette_is_dark`, `DesignSystemGenerator`, `.generate`, `search`, `BM25`, `.claude/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py`, `read_rows`, `detect_domain`, `_style_is_dark_primary`, `search`, `read_rows`, `BM25`, `.agents/skills/ui-ux-pro-max/scripts/design_system.py`, `parse_decision_rules`, `detect_domain`, `.agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py`, `generate_design_system`, `.generate`, `_select_palette_for_mode`, `generate_design_system`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `Customer Dashboard Page` connect `customer.js` to `setupAnnouncementComposer`, `Clinic Heart Logo SVG (served copy)`, `va.js`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Are the 32 inferred relationships involving `DesignSystemGenerator` (e.g. with `TestBm25CoreBehavior` and `TestDiagnosticsContracts`) actually correct?**
  _`DesignSystemGenerator` has 32 INFERRED edges - model-reasoned connections that need verification._
- **What connects `axios`, `{ pool }`, `{ spawn }` to the rest of the system?**
  _427 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05370843989769821 - nodes in this community are weakly interconnected._