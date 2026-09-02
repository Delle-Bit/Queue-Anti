# AI Agent Instructions & Skills

## Skills Resolution Priority
All AI Agents must use skills when handling tasks. Follow this resolution order:
1. **Workspace Skills (Priority 1)**: If a skill exists in `.agents/skills/<name>/` or `.claude/skills/<name>/`, always use the workspace version first.
   - `graphify` (`.agents/skills/graphify/`) — Codebase knowledge graph & exploration
   - `ui-ux-pro-max` (`.agents/skills/ui-ux-pro-max/`) — UI/UX design intelligence, palettes, typography, components
   - `web-design-guidelines` (`.agents/skills/web-design-guidelines/`) — Vercel Web Interface Guidelines audit and accessibility rules
2. **Global Skills (Priority 2)**: If not present locally, use the global skills:
   - `brainstorming` (`C:\Users\wendelle\.gemini\config\plugins\superpowers\skills\brainstorming\`)
   - `writing-plans` (`C:\Users\wendelle\.gemini\config\plugins\superpowers\skills\writing-plans\`)
   - `executing-plans` (`C:\Users\wendelle\.gemini\config\plugins\superpowers\skills\executing-plans\`)
   - `test-driven-development` (`C:\Users\wendelle\.gemini\config\plugins\superpowers\skills\test-driven-development\`)
   - `systematic-debugging` (`C:\Users\wendelle\.gemini\config\plugins\superpowers\skills\systematic-debugging\`)
   - `subagent-driven-development` (`C:\Users\wendelle\.gemini\config\plugins\superpowers\skills\subagent-driven-development\`)
   - `dispatching-parallel-agents` (`C:\Users\wendelle\.gemini\config\plugins\superpowers\skills\dispatching-parallel-agents\`)
   - `requesting-code-review` / `receiving-code-review`
   - `verification-before-completion`
   - `using-git-worktrees`
   - `antigravity-guide` / `agy-customizations` (`C:\Users\wendelle\.gemini\antigravity-ide\builtin\skills\`)

## graphify

This project has a knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## ui-ux-pro-max

UI/UX design intelligence skill located at `.agents/skills/ui-ux-pro-max/`.
Use when designing, styling, reviewing, or enhancing frontend interfaces, palettes, typography, components, and UX patterns.

## web-design-guidelines

Web interface guidelines and accessibility audit skill located at `.agents/skills/web-design-guidelines/`.
Use when auditing or verifying HTML/CSS/JS against accessibility, focus state, animation, and web design compliance rules.
