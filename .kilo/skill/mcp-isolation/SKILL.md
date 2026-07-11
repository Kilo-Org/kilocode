---
name: mcp-isolation
description: Where MCP config loads, how to prevent global/config bleed, and a redacted doctor checklist before enabling any MCP server.
---

# MCP Isolation

## Where MCP config loads

| Source | File:Line | Notes |
|--------|-----------|-------|
| Legacy migrator `.kilo/mcp.json` | `packages/opencode/src/kilocode/config/config.ts:183-188`, `packages/opencode/src/kilocode/mcp-migrator.ts:87-128` | `migrate()` called from `loadLegacyConfigs` without `KILO_DISABLE_PROJECT_CONFIG` guard |
| VSCode global `mcp_settings.json` | `packages/opencode/src/kilocode/config/config.ts:184` | Gated by `KILO_PLATFORM === "vscode"` — terminal sessions skip this |
| Global config `~/.config/kilo/*.{json,jsonc}` | `packages/opencode/src/config/config.ts:1500-1509` | `mergeConfigConcatArrays` uses `mergeDeep` — shallow key-wise outcome: project adds/overwrites by name, never clears global |
| `KILO_CONFIG` env file | `packages/opencode/src/config/config.ts:1512-1525` | Per-invocation override (adds, does not subtract) |
| Project config walk-up | `packages/opencode/src/config/config.ts:1527-1545` | `.kilo`/`.kilocode`/`.opencode` from cwd to worktree root |
| Config dirs enumeration | `packages/opencode/src/config/paths.ts:22-43` | Global `Path.config`, walked-up project dirs, `KILO_CONFIG_DIR` |
| `KILO_CONFIG_CONTENT` env var | `packages/opencode/src/config/config.ts:1603-1619` | Inline config string, same merge semantics |
| Enterprise managed dir | `packages/opencode/src/config/config.ts:1654-1660` | Highest priority, last in merge chain |

**Critical merge behavior**: `mergeConfigConcatArrays` (`config.ts:93`) calls `mergeDeep(target, source)` (remeda), then only special-cases `plugin` and `instructions` arrays for dedup. The `mcp` record falls through to `mergeDeep` — deep merge that adds/overwrites keys **by name** but never deletes keys missing from the source. There is no "replace entire mcp map" sentinel — `null`-as-delete exists for `model`/`small_model`/permissions only (`config.ts:1026-1032`), not for `mcp`.

## Isolation mechanisms (ranked by safety)

1. **`KILO_PLATFORM !== "vscode"` gate** — `packages/opencode/src/kilocode/config/config.ts:184`. Prevents VSCode global `mcp_settings.json` from loading in terminal sessions. **Primary defense for this source build.**
2. **Per-server `enabled: false` stub** — `packages/opencode/src/config/config.ts:1076-1090`. Neutralize specific global MCP servers by name in project config without touching global config.
3. **Project-scoped config** — `.kilo/kilo.jsonc` in the repo root. Keeps MCP definitions local.
4. **`kilo mcp add` scope choice** — Defaults to **Global** (`packages/opencode/src/cli/cmd/mcp.ts:451`, `resolveConfigPath`). Always pick **"Current project"** when prompted (only shown for git repos).
5. **`KILO_CONFIG` / `KILO_CONFIG_CONTENT`** — Per-invocation override. Adds config layers but cannot subtract. Combine with disable stubs when needed.
6. **`KILO_DISABLE_PROJECT_CONFIG`** — Coarse. Kills agents/commands/plugins too, and does NOT gate the legacy `mcp-migrator.ts:97` path (project `.kilo/mcp.json` loads unconditionally when `projectDir` is provided).
7. **No global-disarm flag** — No `KILO_DISABLE_GLOBAL_MCP` exists. No "replace entire mcp map" sentinel. The only per-server disable is `{ enabled: false }`.

## Anti-contamination checklist (redacted — no secrets, no raw tokens)

- [ ] Inspect `~/.config/kilo/kilo.jsonc` keys only — confirm whether `mcp` has entries; redact all values containing TOKEN, KEY, SECRET, AUTH, PASSWORD.
- [ ] Inspect `~/.kilo/`, `~/.kilocode/`, `~/.opencode/` — any stray MCP configs? Use directory listings, not file contents.
- [ ] List env var names only — do not print env values. Redact values for any key containing TOKEN, KEY, SECRET, AUTH, PASSWORD.
- [ ] Search config dirs for files referencing sensitive keys using `rg -n 'GITHUB_PERSONAL_ACCESS_TOKEN|OPENROUTER_API_KEY|NVIDIA_API_KEY' ~/.config/kilo/` — review paths only, not values.
- [ ] Run `kilo mcp list` from the source build worktree to see which servers load for this project — do not paste output into chat if it contains commands or env refs.
- [ ] `echo $KILO_PLATFORM` — if `vscode`, the VSCode global store loads; run from plain terminal for isolation.
- [ ] Verify `.kilo/kilo.jsonc` (project) does not accidentally inherit global entries by name.
- [ ] Prefer a redacted config doctor/script over manual `cat`/`env` dumps.
- [ ] Never run `kilo mcp add` and pick "Global" for this source build.
- [ ] Never paste full provider, auth, or MCP env output into chat.

## First experiment: GitHub MCP read-only (documented, not enabled)

- **Package**: `ghcr.io/github/github-mcp-server` (Docker) or remote `https://api.githubcopilot.com/mcp/` (no Docker)
- **Read-only flag**: `--read-only` (or `GITHUB_READ_ONLY` env var)
- **Auth**: `GITHUB_PERSONAL_ACCESS_TOKEN` — NEVER commit the token. Use `{env:GITHUB_PERSONAL_ACCESS_TOKEN}` substitution (supported by `packages/opencode/src/config/paths.ts:84-88`)
- **Config location**: Project `.kilo/kilo.jsonc` only — never global
- **Tools exposed (read-only)**: `get_file_contents`, `search_code`, `search_issues`, `list_pull_requests`, `get_pull_request_reviews`, `get_me`, etc.
- **Enablement gate**: Pass every checklist item above, then flip `enabled: false → true`

## What not to try yet

- **Filesystem MCP** — blast radius too wide until isolation is proven
- **Sequential thinking MCP** — plan/orchestrator/subagents already cover this
- **Git MCP** — `git`/`gh` CLI is enough
- **Browser / Google / memory / database / shell-control MCPs** — out of scope
