---
name: github
description: Work with the user's GitHub repos (github.com/vortsghost2025) via the gh CLI — repo discovery, issues, PRs, reviews. Safe skill (uses existing gh auth; no MCP, no credentials in config).
---

# GitHub via gh CLI

The user's repos live at https://github.com/vortsghost2025 (many repos; ~4.7k contributions/yr). Use the `gh` CLI through bash for all GitHub ops. Do NOT assume a GitHub MCP is configured.

## Setup check
- `gh auth status` — confirm authenticated. If not, tell the user; never attempt to authenticate.
- Always scope to the right repo: `gh issue list --repo vortsghost2025/<repo>`.

## Common ops
- Enumerate repos: `gh repo list vortsghost2025 --limit 200`
- Issues: `gh issue list --repo vortsghost2025/<repo>`, `gh issue view`, `gh issue create`
- PRs: `gh pr list`, `gh pr create`, `gh pr review`, `gh pr checks`
- Search: `gh search repos "topic" --owner vortsghost2025`, `gh search issues`
- Files: `gh api repos/vortsghost2025/<repo>/contents/<path>` or clone/branch locally.

## PR hygiene (matches repo conventions)
- Conventional commits; PR body 2-3 lines of intent (what + why).
- Run tests/typecheck locally before pushing.
- The human drives the actual `git push`/merge unless told otherwise; `gh pr create` is fine to run.

## Notes
- This is a skill (markdown), not an MCP — no credentials live in config.
- For many-repo sweeps, loop with `gh repo list` and operate per repo.
