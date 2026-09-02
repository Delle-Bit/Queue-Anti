# Graph Report - Attempt1  (2026-08-29)

## Corpus Check
- 134 files · ~366,676 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1620 nodes · 2744 edges · 90 communities (81 shown, 9 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 127 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9f6746fa`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.js
- customer.js
- admintechnical.js
- dependencies
- owner.js
- Customer Dashboard & Core Actions Flow
- va.js
- frontdesk.js
- server.js
- shared.js
- queue.js
- .claude/skills/ui-ux-pro-max/scripts/validate_data.py
- CLAUDE.md — Project Guidance
- ai_services.js
- doctor.js
- graphify reference: extra exports and benchmark
- auth.js
- Update & Cluster-Only Reference (.agents)
- What You Must Do When Invoked
- What You Must Do When Invoked
- admin.js
- Query/Path/Explain Reference (.agents)
- database.js
- Graphify SKILL.md (.agents)
- /graphify
- packages.js
- auth.ts
- Medical Clinic Queueing System
- Add-Watch Reference (.agents)
- .claude/skills/ui-ux-pro-max/scripts/core.py
- Extraction Subagent Spec (.agents)
- Sample Data
- GitHub Clone & Merge Reference (.agents)
- queue_automation.js
- pytesseract_ocr.py
- CLAUDE.md
- DesignSystemGenerator
- search_stack
- search
- BM25
- .claude/skills/ui-ux-pro-max/scripts/design_system.py
- _select_palette_for_mode
- _palette_is_dark
- UI/UX Pro Max - Design Intelligence
- TestThresholdGate
- CatalogRefreshTest
- .claude/skills/ui-ux-pro-max/scripts/tests/test_data_contracts.py
- .agents/skills/ui-ux-pro-max/scripts/validate_data.py
- graphify reference: extra exports and benchmark
- Pre-Delivery Checklist (canonical — the only one)
- Quick Reference
- detect_domain
- .claude/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py
- /graphify
- test_text_layout_resilience.py
- AI Agent Instructions & Skills
- .agents/skills/ui-ux-pro-max/scripts/core.py
- _suggest_identities
- Web Interface Guidelines
- ui-ux-pro-max.md
- web-design-guidelines.md
- AI Agent Instructions & Skills
- Skills Resolution & Global Skills Rule
- .generate
- search_stack
- parse_decision_rules
- search
- DesignSystemGenerator
- BM25
- .agents/skills/ui-ux-pro-max/scripts/design_system.py
- .generate
- parse_decision_rules
- UI/UX Pro Max - Design Intelligence
- TestThresholdGate
- CatalogRefreshTest
- detect_domain
- _palette_is_dark
- Pre-Delivery Checklist (canonical — the only one)
- Quick Reference
- _select_palette_for_mode
- .agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py
- generate_design_system
- .agents/skills/ui-ux-pro-max/scripts/tests/test_text_layout_resilience.py
- _normalize
- _normalize
- .agents/skills/graphify/references/hooks.md
- _suggest_identities
- TestLandingAndStackContract
- TestLandingAndStackContract
- Web Interface Guidelines

## God Nodes (most connected - your core abstractions)
1. `DesignSystemGenerator` - 64 edges
2. `search()` - 46 edges
3. `search()` - 46 edges
4. `search_stack()` - 35 edges
5. `search_stack()` - 35 edges
6. `DesignSystemGenerator` - 32 edges
7. `BM25` - 30 edges
8. `CLAUDE.md — Project Guidance` - 28 edges
9. `detect_domain()` - 18 edges
10. `detect_domain()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Zero-Migration Auto Schema Creation` --references--> `initDB()`  [EXTRACTED]
  INSTRUCTIONS.md → database.js
- `CLAUDE.md — Project Guidance` --references--> `verifyRoles()`  [EXTRACTED]
  CLAUDE.md → server.js
- `CLAUDE.md — Project Guidance` --references--> `nvidiaFallback()`  [EXTRACTED]
  CLAUDE.md → ai_services.js
- `CLAUDE.md — Project Guidance` --references--> `checkAIToggle()`  [EXTRACTED]
  CLAUDE.md → ai_services.js
- `CLAUDE.md — Project Guidance` --references--> `callMockAI()`  [EXTRACTED]
  CLAUDE.md → ai_services.js

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

## Communities (90 total, 9 thin omitted)

### Community 0 - "index.js"
Cohesion: 0.05
Nodes (58): abandonPendingRegistration(), authOverlay, cancelLoginOTP(), captureRegID(), checkPasswordMatch(), checkPasswordStrength(), closeAuthPanel(), closeForgotModal() (+50 more)

### Community 1 - "customer.js"
Cohesion: 0.08
Nodes (40): APPT_SLOTS, apptNextStep(), apptPrevStep(), bookAppointment(), calendarDate, cancelQueue(), changeCalendarMonth(), checkMandatoryMedicalForm() (+32 more)

### Community 2 - "admintechnical.js"
Cohesion: 0.08
Nodes (30): allDoctors, allLabs, createAccount(), deleteLab(), deleteUser(), editService(), editUser(), fetchAllLabs() (+22 more)

### Community 3 - "dependencies"
Cohesion: 0.05
Nodes (38): axios, bcrypt, better-auth, body-parser, cors, dotenv, @emailjs/nodejs, express (+30 more)

### Community 4 - "owner.js"
Cohesion: 0.08
Nodes (29): allAudits, allDoctors, allLabs, deleteLab(), deleteUser(), editService(), editUser(), fetchAllLabs() (+21 more)

### Community 5 - "Customer Dashboard & Core Actions Flow"
Cohesion: 0.08
Nodes (30): 1. Registration & Authentication Flow, 2. Customer Dashboard & Core Actions Flow, 3. Real-time Status Data Flow Diagram (DFD), Book an Appointment Flow, Customer Dashboard & Core Actions Flow, Customer Side Flowchart & Data Flow Guide, Join a Service Queue Flow, Login Flow (+22 more)

### Community 6 - "va.js"
Cohesion: 0.18
Nodes (26): Virtual Nurse Assistant Widget (customer.html), addVaHistory(), answerQueueStatus(), answerWaitTime(), bindVaListeners(), clearVaHistory(), dismissVaBubble(), executeVaAction() (+18 more)

### Community 7 - "frontdesk.js"
Cohesion: 0.13
Nodes (20): allFdLogs, allLabs, editService(), fdCallNext(), fdComplete(), fetchLabs(), filterFdLogs(), labSequence (+12 more)

### Community 8 - "server.js"
Cohesion: 0.08
Nodes (23): adminRoutes, app, assistantRoutes, authRoutes, bcrypt, bodyParser, cors, dotenv (+15 more)

### Community 9 - "shared.js"
Cohesion: 0.10
Nodes (28): ANNOUNCEMENT_STAFF_ROLES, ANNOUNCEMENT_STATION_BY_ROLE, authHeaders(), closeModal(), dismissedAnnouncementIds, draftAnnouncement(), enforcePasswordPolicy(), escapeHtml() (+20 more)

### Community 10 - "queue.js"
Cohesion: 0.14
Nodes (18): peekTicketNumber(), aiServices, { buildCustomerStatus }, express, loadAssistantContext(), { pool }, router, buildCustomerStatus() (+10 more)

### Community 11 - ".claude/skills/ui-ux-pro-max/scripts/validate_data.py"
Cohesion: 0.08
Nodes (46): read_rows(), TestAccessibilityGuidance, TestChartsTypographyAndIcons, TestCurrentReactGuidance, TestSemanticColors, _catalog_date(), _check_app_interface_contract(), _check_catalog_contract() (+38 more)

### Community 12 - "CLAUDE.md — Project Guidance"
Cohesion: 0.23
Nodes (16): graphify, CLAUDE.md — Project Guidance, Graphify Knowledge Graph Tool, Priority Queueing (Senior/PWD/Pregnant), Role-Based Access Matrix, Seeded Dev Accounts, Auto-Migrating Schema Convention (addColumnIfMissing/addIndexIfMissing in initDB), Soft Deletion Convention (archived/archived_at columns, no hard deletes) (+8 more)

### Community 13 - "ai_services.js"
Cohesion: 0.12
Nodes (11): aiServices, axios, callMockAI(), checkAIToggle(), dotenv, fs, logAI(), nvidiaFallback() (+3 more)

### Community 14 - "doctor.js"
Cohesion: 0.09
Nodes (37): Clinic Heart Logo SVG (repo root copy), addPrescriptionItem(), commitClinicalRecord(), docCallNext(), docComplete(), findMyDoctor(), loadDocQueue(), loadDraftFromLocalStorage() (+29 more)

### Community 15 - "graphify reference: extra exports and benchmark"
Cohesion: 0.25
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 16 - "auth.js"
Cohesion: 0.06
Nodes (24): emailjs, sendOtpEmail(), sendPasswordResetEmail(), auth, loadAuthModule(), ensureShadowUser(), { pool }, require (+16 more)

### Community 17 - "Update & Cluster-Only Reference (.agents)"
Cohesion: 0.14
Nodes (15): Transcribe Reference (.agents), graphify reference: transcribe video and audio, Step 2.5 - Transcribe video / audio files (only if video files detected), Update & Cluster-Only Reference (.agents), For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only, Stamp-Only-On-Output Manifest Rule (+7 more)

### Community 18 - "What You Must Do When Invoked"
Cohesion: 0.13
Nodes (15): Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Part C - Merge AST + semantic into final extraction, Step 0 - GitHub repos and multi-path merge (only if a URL or several paths), Step 1 - Ensure graphify is installed, Step 2.5 - Video and audio (only if video files detected), Step 2 - Detect files, Step 3 - Extract entities and relationships (+7 more)

### Community 19 - "What You Must Do When Invoked"
Cohesion: 0.13
Nodes (15): Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Part C - Merge AST + semantic into final extraction, Step 0 - GitHub repos and multi-path merge (only if a URL or several paths), Step 1 - Ensure graphify is installed, Step 2.5 - Video and audio (only if video files detected), Step 2 - Detect files, Step 3 - Extract entities and relationships (+7 more)

### Community 20 - "admin.js"
Cohesion: 0.15
Nodes (14): ADMIN_ROLES, requireAdmin(), requireStaff(), STAFF_ROLES, aiServices, ANNOUNCEMENT_DEPARTMENT_NAMES, bcrypt, crypto (+6 more)

### Community 21 - "Query/Path/Explain Reference (.agents)"
Cohesion: 0.15
Nodes (14): Query/Path/Explain Reference (.agents), For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal, Constrained Query Vocabulary Expansion, Work Memory / Self-Improving Loop (+6 more)

### Community 22 - "database.js"
Cohesion: 0.21
Nodes (10): addColumnIfMissing(), addIndexIfMissing(), DEFAULT_SERVICES, initDB(), mysql, pool, aiServices, express (+2 more)

### Community 23 - "Graphify SKILL.md (.agents)"
Cohesion: 0.16
Nodes (12): graphify, Exports & Benchmark Reference (.agents), Graphify SKILL.md (.agents), Honesty Rules, Graphify Full Pipeline (Steps 0-9), #479 Shrink-Guard, Workflow: graphify, graphify (+4 more)

### Community 24 - "/graphify"
Cohesion: 0.25
Nodes (8): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Interpreter guard for subcommands, Usage, What graphify is for

### Community 25 - "packages.js"
Cohesion: 0.25
Nodes (6): aiServices, express, jwt, { JWT_SECRET, requireStaff }, { pool }, router

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

### Community 33 - "queue_automation.js"
Cohesion: 0.47
Nodes (5): calculateScore(), getNextFromList(), getNextPatient(), { pool }, callNextAtStation()

### Community 36 - "DesignSystemGenerator"
Cohesion: 0.13
Nodes (7): DesignSystemGenerator, Generates design system recommendations from aggregated searches., Load reasoning rules from CSV., Select best matching result based on priority keywords., TestReasoningMatch, read_rows(), TestReasoningContract

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
Cohesion: 0.12
Nodes (23): ansi_ljust(), _detect_page_type(), format_ascii_box(), format_master_md(), format_page_override_md(), _generate_intelligent_overrides(), hex_to_ansi(), persist_design_system() (+15 more)

### Community 41 - "_select_palette_for_mode"
Cohesion: 0.22
Nodes (7): _contrast_ratio(), _derive_dark_palette(), WCAG contrast ratio for two hex colors, or None if either is invalid., Keep product brand tokens while deriving accessible dark surfaces., Pick the highest-ranked palette matching the resolved mode. Only the dark case…, _select_palette_for_mode(), TestPaletteSelection

### Community 42 - "_palette_is_dark"
Cohesion: 0.18
Nodes (7): _palette_is_dark(), WCAG relative luminance of a #RRGGBB string, or None if unparseable., True when a colors.csv row's Background is a dark surface., _relative_luminance(), The exact reproduction from issue #428., TestEndToEndCoherence, TestLuminance

### Community 43 - "UI/UX Pro Max - Design Intelligence"
Cohesion: 0.11
Nodes (17): Before Delivering App UI, Example Workflow, If a search returns 0 results, Output Formats, Query Contract, Rule Categories by Priority, Running the search tool, Step 1: Analyze User Requirements (+9 more)

### Community 44 - "TestThresholdGate"
Cohesion: 0.13
Nodes (3): TestFixtureValidation, TestMetricMath, TestThresholdGate

### Community 46 - ".claude/skills/ui-ux-pro-max/scripts/tests/test_data_contracts.py"
Cohesion: 0.24
Nodes (4): split_values(), style_identities(), TestGeneratedCatalogContract, TestStyleIdentityContract

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

### Community 52 - ".claude/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py"
Cohesion: 0.23
Nodes (7): _query_wants_dark(), True when a styles.csv row describes itself as dark-first., True when the query explicitly asks for a dark theme., Resolve the mode the rest of the output has to agree with., _resolve_color_mode(), _style_is_dark_primary(), TestModeResolution

### Community 53 - "/graphify"
Cohesion: 0.20
Nodes (10): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Interpreter guard for subcommands, PowerShell 5.1: Vertical scrolling stops working, Troubleshooting (+2 more)

### Community 54 - "test_text_layout_resilience.py"
Cohesion: 0.22
Nodes (3): read_rows(), TestTextLayoutDataContracts, TestTextLayoutRetrieval

### Community 55 - "AI Agent Instructions & Skills"
Cohesion: 0.40
Nodes (4): AI Agent Instructions & Skills, Skills Resolution Priority, ui-ux-pro-max, web-design-guidelines

### Community 56 - ".agents/skills/ui-ux-pro-max/scripts/core.py"
Cohesion: 0.10
Nodes (29): _contains_phrase(), _domain_keywords(), _file_signature(), _get_bm25(), _load_csv(), _load_csv_snapshot(), _load_product_keywords(), _load_rows_or_empty() (+21 more)

### Community 57 - "_suggest_identities"
Cohesion: 0.25
Nodes (8): _exact_row_identity(), Suggest complete public identities so a retry can bypass score thresholds., Return non-empty public identities from ordinary and alias fields., Resolve an explicit style identity without opening generic variant ranking., Return one row whose stable public identity exactly matches the query., _row_identities(), _style_identity(), _suggest_identities()

### Community 58 - "Web Interface Guidelines"
Cohesion: 0.40
Nodes (4): Guidelines Source, How It Works, Usage, Web Interface Guidelines

### Community 61 - "AI Agent Instructions & Skills"
Cohesion: 0.40
Nodes (4): AI Agent Instructions & Skills, Skills Resolution Priority, ui-ux-pro-max, web-design-guidelines

### Community 62 - "Skills Resolution & Global Skills Rule"
Cohesion: 0.50
Nodes (3): Available Global Skills, Skill Resolution Priority, Skills Resolution & Global Skills Rule

### Community 63 - ".generate"
Cohesion: 0.16
Nodes (8): _filter_anti_patterns_for_mode(), Drop "avoid dark mode" advice once dark mode is the resolved answer., Execute searches across multiple domains., Extract results list from search result dict., Generate complete design system recommendation. variance/motion/density are…, Bucket a 1-10 dial value into its tier config. Returns None if value is None., _resolve_dial(), TestAntiPatternGating

### Community 64 - "search_stack"
Cohesion: 0.11
Nodes (6): Search stack-specific guidelines, search_stack(), _rows(), TestNativeDesktopStackFreshness, _rows(), TestWebStackFreshness

### Community 65 - "parse_decision_rules"
Cohesion: 0.19
Nodes (8): Find matching reasoning rule for a category., Apply reasoning rules to search results., apply_decision_rules(), _object_without_duplicates(), parse_decision_rules(), Return deterministic mutations and an audit trail; never execute data., Parse the canonical condition -> action-array representation., _validate_action()

### Community 66 - "search"
Cohesion: 0.11
Nodes (9): _exact_stack_identifier(), Resolve a deprecated in-domain alias, or expose a cross-domain redirect., Main search function with auto-domain detection, Resolve a standalone API identifier even when its BM25 IDF is low., search(), _style_search_destination(), TestSearchDomains, read_rows() (+1 more)

### Community 67 - "DesignSystemGenerator"
Cohesion: 0.13
Nodes (7): DesignSystemGenerator, Generates design system recommendations from aggregated searches., Load reasoning rules from CSV., TestReasoningMatch, read_rows(), TestGeneratedCatalogContract, TestReasoningContract

### Community 68 - "BM25"
Cohesion: 0.11
Nodes (10): BM25, BM25 ranking algorithm for text search, generate_design_system(), Main entry point for design system generation. Args: query: Search query (e.g.,…, format_output(), Format results for Claude consumption (token-optimized), TestBm25CoreBehavior, TestDiagnosticsContracts (+2 more)

### Community 69 - ".agents/skills/ui-ux-pro-max/scripts/design_system.py"
Cohesion: 0.11
Nodes (25): ansi_ljust(), _detect_page_type(), format_ascii_box(), format_markdown(), format_master_md(), format_page_override_md(), _generate_intelligent_overrides(), hex_to_ansi() (+17 more)

### Community 70 - ".generate"
Cohesion: 0.11
Nodes (11): _filter_anti_patterns_for_mode(), Drop "avoid dark mode" advice once dark mode is the resolved answer., Execute searches across multiple domains., Find matching reasoning rule for a category., Apply reasoning rules to search results., Select best matching result based on priority keywords., Extract results list from search result dict., Generate complete design system recommendation. variance/motion/density are… (+3 more)

### Community 71 - "parse_decision_rules"
Cohesion: 0.17
Nodes (10): apply_decision_rules(), _object_without_duplicates(), parse_decision_rules(), Return deterministic mutations and an audit trail; never execute data., Parse the canonical condition -> action-array representation., _validate_action(), split_values(), style_identities() (+2 more)

### Community 72 - "UI/UX Pro Max - Design Intelligence"
Cohesion: 0.11
Nodes (17): Before Delivering App UI, Example Workflow, If a search returns 0 results, Output Formats, Query Contract, Rule Categories by Priority, Running the search tool, Step 1: Analyze User Requirements (+9 more)

### Community 73 - "TestThresholdGate"
Cohesion: 0.13
Nodes (3): TestFixtureValidation, TestMetricMath, TestThresholdGate

### Community 75 - "detect_domain"
Cohesion: 0.23
Nodes (3): detect_domain(), Auto-detect the most relevant domain from query. Matches are weighted by…, TestDomainDetection

### Community 76 - "_palette_is_dark"
Cohesion: 0.18
Nodes (7): _palette_is_dark(), WCAG relative luminance of a #RRGGBB string, or None if unparseable., True when a colors.csv row's Background is a dark surface., _relative_luminance(), The exact reproduction from issue #428., TestEndToEndCoherence, TestLuminance

### Community 77 - "Pre-Delivery Checklist (canonical — the only one)"
Cohesion: 0.15
Nodes (12): Accessibility, Common Rules for Professional UI + Pre-Delivery Checklist, Icons & Visual Elements, Interaction, Interaction (App), Layout, Layout & Spacing, Light/Dark Mode (+4 more)

### Community 78 - "Quick Reference"
Cohesion: 0.15
Nodes (12): 10. Charts & Data (LOW), 1. Accessibility (CRITICAL), 2. Touch & Interaction (CRITICAL), 3. Performance (HIGH), 4. Style Selection (HIGH), 5. Layout & Responsive (HIGH), 6. Typography & Color (MEDIUM), 7. Animation (MEDIUM) (+4 more)

### Community 79 - "_select_palette_for_mode"
Cohesion: 0.22
Nodes (7): _contrast_ratio(), _derive_dark_palette(), WCAG contrast ratio for two hex colors, or None if either is invalid., Keep product brand tokens while deriving accessible dark surfaces., Pick the highest-ranked palette matching the resolved mode. Only the dark case…, _select_palette_for_mode(), TestPaletteSelection

### Community 80 - ".agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py"
Cohesion: 0.23
Nodes (7): _query_wants_dark(), True when a styles.csv row describes itself as dark-first., True when the query explicitly asks for a dark theme., Resolve the mode the rest of the output has to agree with., _resolve_color_mode(), _style_is_dark_primary(), TestModeResolution

### Community 81 - "generate_design_system"
Cohesion: 0.20
Nodes (7): format_markdown(), generate_design_system(), Format design system as markdown., Main entry point for design system generation. Args: query: Search query (e.g.,…, format_output(), Format results for Claude consumption (token-optimized), TestPersistence

### Community 82 - ".agents/skills/ui-ux-pro-max/scripts/tests/test_text_layout_resilience.py"
Cohesion: 0.22
Nodes (3): read_rows(), TestTextLayoutDataContracts, TestTextLayoutRetrieval

### Community 83 - "_normalize"
Cohesion: 0.25
Nodes (9): _exact_match_diagnostic(), _legacy_successor_guidance(), _normalize(), Apply longest-first synonym substitution at token boundaries., Whether a stack query explicitly targets an older framework generation., Choose one coherent applicability generation for stack retrieval., Prefer the explicit successor row for a brand-new app on legacy-only stacks., _stack_query_requests_legacy() (+1 more)

### Community 84 - "_normalize"
Cohesion: 0.25
Nodes (9): _exact_match_diagnostic(), _legacy_successor_guidance(), _normalize(), Apply longest-first synonym substitution at token boundaries., Whether a stack query explicitly targets an older framework generation., Choose one coherent applicability generation for stack retrieval., Prefer the explicit successor row for a brand-new app on legacy-only stacks., _stack_query_requests_legacy() (+1 more)

### Community 85 - ".agents/skills/graphify/references/hooks.md"
Cohesion: 0.25
Nodes (6): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration, For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 86 - "_suggest_identities"
Cohesion: 0.25
Nodes (8): _exact_row_identity(), Suggest complete public identities so a retry can bypass score thresholds., Return non-empty public identities from ordinary and alias fields., Resolve an explicit style identity without opening generic variant ranking., Return one row whose stable public identity exactly matches the query., _row_identities(), _style_identity(), _suggest_identities()

### Community 89 - "Web Interface Guidelines"
Cohesion: 0.40
Nodes (4): Guidelines Source, How It Works, Usage, Web Interface Guidelines

## Ambiguous Edges - Review These
- `README.md — Project Overview` → `server_pid.txt — Runtime Process ID Scratch File`  [AMBIGUOUS]
  server_pid.txt · relation: conceptually_related_to
- `Customize Section (admintechnical.html)` → `Clinic Building Exterior Photo`  [AMBIGUOUS]
  public/admintechnical.html · relation: references

## Knowledge Gaps
- **333 isolated node(s):** `axios`, `{ pool }`, `{ spawn }`, `path`, `fs` (+328 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `README.md — Project Overview` and `server_pid.txt — Runtime Process ID Scratch File`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Customize Section (admintechnical.html)` and `Clinic Building Exterior Photo`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `DesignSystemGenerator` connect `DesignSystemGenerator` to `DesignSystemGenerator`, `search`, `BM25`, `_select_palette_for_mode`, `_palette_is_dark`, `.claude/skills/ui-ux-pro-max/scripts/tests/test_data_contracts.py`, `detect_domain`, `.claude/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py`, `.generate`, `search`, `BM25`, `.agents/skills/ui-ux-pro-max/scripts/design_system.py`, `.generate`, `parse_decision_rules`, `detect_domain`, `_palette_is_dark`, `_select_palette_for_mode`, `.agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py`, `generate_design_system`, `TestLandingAndStackContract`, `TestLandingAndStackContract`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `search()` connect `search` to `BM25`, `.claude/skills/ui-ux-pro-max/scripts/design_system.py`, `.claude/skills/ui-ux-pro-max/scripts/validate_data.py`, `generate_design_system`, `detect_domain`, `_normalize`, `test_text_layout_resilience.py`, `_suggest_identities`, `.claude/skills/ui-ux-pro-max/scripts/core.py`, `.generate`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `search()` connect `search` to `BM25`, `.agents/skills/ui-ux-pro-max/scripts/design_system.py`, `.generate`, `detect_domain`, `.agents/skills/ui-ux-pro-max/scripts/validate_data.py`, `.agents/skills/ui-ux-pro-max/scripts/tests/test_text_layout_resilience.py`, `_normalize`, `_suggest_identities`, `.agents/skills/ui-ux-pro-max/scripts/core.py`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Are the 32 inferred relationships involving `DesignSystemGenerator` (e.g. with `TestBm25CoreBehavior` and `TestDiagnosticsContracts`) actually correct?**
  _`DesignSystemGenerator` has 32 INFERRED edges - model-reasoned connections that need verification._
- **What connects `axios`, `{ pool }`, `{ spawn }` to the rest of the system?**
  _333 weakly-connected nodes found - possible documentation gaps or missing edges._