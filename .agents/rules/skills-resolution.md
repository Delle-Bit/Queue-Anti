# Skills Resolution & Global Skills Rule

All AI Agents must use available skills to guide planning, debugging, testing, UI design, and development tasks.

## Skill Resolution Priority
1. **Workspace Skills First**: Always check for and prioritize project-local skills in `.agents/skills/<skill-name>/SKILL.md` (or `.claude/skills/<skill-name>/SKILL.md`). If a skill exists in the workspace, you MUST use the workspace copy.
2. **Global Skills Fallback**: If a skill is not found in the workspace, resolve and use the global skill from:
   - **Global Superpowers**: `C:\Users\wendelle\.gemini\config\plugins\superpowers\skills/<skill-name>/SKILL.md`
   - **Antigravity Builtin**: `C:\Users\wendelle\.gemini\antigravity-ide\builtin\skills/<skill-name>/SKILL.md`

## Available Global Skills
- `brainstorming` — Explore requirements and design before implementation
- `writing-plans` — Create detailed implementation plans from specs
- `executing-plans` — Execute implementation plans with review checkpoints
- `test-driven-development` — Enforce TDD cycles before code changes
- `systematic-debugging` — Root-cause debugging for bugs and errors
- `subagent-driven-development` — Orchestrate independent tasks via subagents
- `dispatching-parallel-agents` — Run concurrent parallel tasks
- `requesting-code-review` / `receiving-code-review` — Code review workflows
- `verification-before-completion` — Verify with commands before claiming completion
- `using-git-worktrees` — Workspace isolation
- `antigravity-guide` / `agy-customizations` — Antigravity platform reference
