---
name: v2-migration
description: Use for any work on the Kilo v2 migration (branches kilo-v2-clean*, v2-*). Covers strategy, branches and PRs, the isolated test profile, how to self-test the v2 CLI yourself, and the test policy.
---

# Kilo v2 migration

Kilo moves onto upstream OpenCode v2 from a clean base, one feature at a time. Verify your own work. The user should not need to test it for you.

## Sources of truth

- Behavior: v1 Kilo on `main`. Mechanism only: the old port, tag `kilo-v2-checkpoints-2026-09` (former `kilo-v2`). Never merge or copy it as a whole.
- Context and decisions: `migration-tracking/plans/migration-context.md`. Plan: `migration-tracking/plans/kilo-v2-migration-plan.md` (PR #14987).
- Epic #13750. Gateway, login and enterprise support: #14991.
- Known upstream test failures: `migration-tracking/technical-notes/baseline/pinned-v2-baseline.md`.
- Fork conventions: `migration-tracking/technical-notes/v2-fork-conventions.md`.

## Strategy

- Order: CLI/TUI first (G1), then VS Code (G2), then JetBrains (G3). Cloud consumers follow a versioned release.
- Kilo code lives in Kilo-owned paths (`packages/kilo-*`, `src/kilocode/`) and uses public upstream seams (`@opencode/plugin`). Keep changes to shared upstream files minimal and mark them `kilocode_change`.
- Kilo logic packages (for example `kilo-gateway-core`) import nothing from `@opencode/*`. Only thin adapters do.
- The Kilo Gateway is the only source of Kilo models (`models.set`, no models.dev fallback). Requests identify as Kilo (token, team header, `X-KILOCODE-*`). See #14991.

## Branches and PRs

- Integration branch: `kilo-v2-clean`. Use the working base named in `migration-context.md`. Never target `main`.
- Stack on an open v2 PR when you depend on it, and target that PR's branch.
- One plan unit per PR. Never push to `kilo-v2-clean*`. A human merges.
- Short hyphenated branch names, no slashes. Titles `type(scope): summary`.

## Isolation: never touch the v1 setup

- Run the CLI only through `bun dev` (`script/dev-isolated.ts`). It keeps all data in one profile directory. Never run `bun run --cwd packages/cli`, `dev:live` or `opencode` directly. They use the installed OpenCode data and service.
- Use a fresh profile per test: `KILO_V2_PROFILE=/tmp/kilo-v2-<id>`. Add `--standalone` so parallel agents do not share the service port.
- `bun dev` reuses the v1 Kilo login (read only). For a signed-out test, start it with `XDG_DATA_HOME=/tmp/kilo-v2-empty`.
- Do not edit the main checkout, `~/.config/kilo`, `~/.local/share/kilo` or OpenCode directories. `bun run extension` does not exist on v2.
- Models: `kilo/kilo-auto/free` by default. Use `kilo/deepseek/deepseek-v4.1-flash` only when a paid model is needed.

## Self-test the CLI

Self-testing means you use the real CLI like a user and judge the result. Unit tests and typecheck do not count as self-testing.

**Quick headless check:** `KILO_V2_PROFILE=/tmp/kilo-v2-<id> bun dev run --standalone "<prompt>"`.

**Visual TUI check.** Load `vscode-self-test`. Its harness hosts the TUI in the VS Code terminal. The v1 extension only provides the window, so no v2 extension is needed.

```bash
export KILO_SELF_TEST_REPO=<v1 checkout with built packages/kilo-vscode/dist>  # prefer a separate v1 worktree
st() { node ~/.config/kilo/scripts/vscode-self-test/cli.mjs "$@" --session <unique-id>; }
st start
st launch-vscode --mode dev --build false --auth false --workspace <disposable git repo>
st run-command --command "Terminal: Create New Terminal"
st run-command --command "View: Toggle Maximized Panel"
st type --submit --value "KILO_V2_PROFILE=/tmp/kilo-v2-<id> bun <v2 worktree>/script/dev-isolated.ts --standalone"
st screenshot   # then read the PNG
```

- Interact with `st type --value "<text>"` (prompts, slash commands such as `/connect`, `@file` mentions) and `st press --keys <keys>` (`Enter`, `Escape`, `Shift+Tab` agents, `Control+p` commands, `Control+x` then `m` models).
- Take and read a screenshot after every step. Dialogs chain: picking a model opens a variant dialog, and the next typed text lands in its search field.
- Terminal text is not in the DOM. Judge from screenshots.
- Never type real credentials. They would appear in screenshots. Stop auth flows before the secret input, or use a test account.
- Clean up: `st press --keys Control+c` twice, `st stop-vscode --cleanup true`, `st stop`, then delete the profile and fixture directories.
- Parallel agents: each uses its own session selector, profile directory and fixture repo.

The VS Code extension (G2) uses the same harness later, with `KILO_SELF_TEST_REPO` pointing at the v2 worktree.

## Test policy

Grow the test surface with each PR.

- Run `bun typecheck` and focused `bun test` from each changed package directory (never from the repo root).
- New Kilo code comes with tests for its behavior. Prefer real integration with the Kilo Gateway over mocks. Use small unit tests only for paths a live server cannot trigger (outage, malformed data).
- Upstream failures listed in `pinned-v2-baseline.md` are known. Do not fix unrelated ones. A new failure in a package you touched blocks the PR.
- Never delete or skip a test silently. List every skip in the PR with its reason.
- Self-test each user-visible behavior you add, and record the scenario so the next PR can repeat it.

## Evidence

In the PR and the final response, list the commands you ran, the self-test scenarios with pass, fail or blocked, and the limits (for example, a flow that needs credentials).
