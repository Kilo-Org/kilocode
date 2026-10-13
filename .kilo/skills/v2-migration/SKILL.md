---
name: v2-migration
description: Use for any work on the Kilo v2 migration (branches v2, v2-*). Covers strategy (plugin first), branches, PRs and upstream syncs, the isolated test profile, how to self-test the v2 CLI yourself, and the test policy.
---

# Kilo v2 migration

Kilo moves onto upstream OpenCode v2 from a clean base, one feature at a time. Verify your own work. The user should not need to test it for you.

## Sources of truth

- Behavior: v1 Kilo on `main`. Mechanism only: the old port, tag `kilo-v2-checkpoints-2026-09` (former `kilo-v2`). Never merge or copy it as a whole.
- The migration docs are still on `origin/kilo-v2-clean-bootstrap`. Until they land on `v2`, read them with `git show origin/kilo-v2-clean-bootstrap:<path>`:
  - Context and decisions: `migration-tracking/plans/migration-context.md`. Plan: `migration-tracking/plans/kilo-v2-migration-plan.md`.
  - Known upstream test failures: `migration-tracking/technical-notes/baseline/pinned-v2-baseline.md`.
  - Fork conventions: `migration-tracking/technical-notes/v2-fork-conventions.md`.
- Changes not yet in the plan (merge source, plugin first, host package): `migration-tracking/plans/v2-plan-delta-2026-10-13.md` on `v2`. Where it differs from the bootstrap docs, it wins.
- Epic #13750. Gateway, login and enterprise support: #14991. Upstream sync and merge tooling: #15020.

## Strategy

- Order: CLI/TUI first (G1), then VS Code (G2), then JetBrains (G3). Cloud consumers follow a versioned release.
- Kilo code lives in Kilo-owned paths (`packages/kilo-*`, `src/kilocode/`). Plugin first: use the first option that works, and name it in the PR.
  1. A Kilo plugin on the public plugin API (`@opencode/plugin`).
  2. The Kilo host (unit U-E0-01): plugin registration through `SdkPlugins.register`, Effect layer overrides (for example `Global.layerWith`), environment translation at the entry. The host does not exist yet. Until it lands, register a Kilo plugin in the upstream builtin list with one marked line.
  3. A small, generic seam patch in a shared upstream file: widen an API, add a hook, export a value. Prefer files that change rarely.
  4. A feature patch in a shared upstream file. Last resort. Say in the PR why options 1 to 3 do not work.
  5. Branding and product strings: the rename script during upstream syncs, never hand edits.
- Mark every change in a shared upstream file with `kilocode_change` (options 3 and 4). One generic seam is better than many small edits.
- Kilo logic packages (for example `kilo-gateway-core`) import nothing from `@opencode/*`. Only thin adapters do.
- The Kilo Gateway is the only source of Kilo models (`models.set`, no models.dev fallback). Requests identify as Kilo (token, team header, `X-KILOCODE-*`). See #14991.

## Branches and PRs

- Integration branch: `origin/v2`. Branch from it and target it. Never target `main` or `kilo-v2-clean-bootstrap`.
- Upstream: `upstream/dev` is upstream's v2 line since 2026-10-10. `upstream/v2` is frozen; never merge it. Never merge upstream in a feature PR. An upstream sync is its own PR (#15020). It targets the newest release commit (the parent of the newest `v2.x.y` tag), and merges with a merge commit, never a squash. After a sync, open PRs merge `v2` into their branch and check and self-test again.
- Stack on an open v2 PR when you depend on it, and target that PR's branch.
- One plan unit per PR. Never push directly to `v2`. A human merges.
- Short hyphenated branch names, no slashes. Titles `type(scope): summary`.

## Isolation: never touch the v1 setup

- Run the CLI only through `bun dev` (`script/dev-isolated.ts`). It keeps all data in one profile directory. Never run `bun run --cwd packages/cli`, `dev:live` or `opencode` directly. They use the installed OpenCode data and service.
- Use a fresh profile per test: `KILO_V2_PROFILE=/tmp/kilo-v2-<id>`. Add `--standalone` so parallel agents do not share the service port.
- `bun dev` reuses the v1 Kilo login (read only). For a signed-out test, start it with `XDG_DATA_HOME=/tmp/kilo-v2-empty`.
- Do not edit the main checkout, `~/.config/kilo`, `~/.local/share/kilo` or OpenCode directories. `bun run extension` does not exist on v2.
- Models: `kilo/kilo-auto/free` by default. Use `kilo/deepseek/deepseek-v4.1-flash` only when a paid model is needed.
- Isolate tests too. Upstream tests can write into the real home and leave servers running. Run them with `T=$(mktemp -d)` and `env OPENCODE_TEST_HOME=$T XDG_DATA_HOME=$T/data XDG_CONFIG_HOME=$T/config XDG_STATE_HOME=$T/state XDG_CACHE_HOME=$T/cache bun test ...`. After the run, stop any of your processes that `pgrep -fl 'opencode-test-|opencode-service-lifecycle'` lists.

## Self-test the CLI

Self-testing means you use the real CLI like a user and judge the result. Unit tests and typecheck do not count as self-testing.

**Quick check without UI:** `env KILO_V2_PROFILE=$(mktemp -d) bun dev run --standalone "<prompt>"`.

**TUI check.** The `vscode-self-test` harness runs the TUI in a quiet VS Code terminal and reads the terminal text. The v1 extension only hosts the window. No v2 extension is needed.

### 1. Setup (one shell call)

Set the first line, then run the whole block from the v2 worktree. `V1` must be a v1 checkout with a built `packages/kilo-vscode/dist` (prefer a separate v1 worktree, never build in the user's main checkout). Use a new `ID` for each test.

```bash
ID=my-test V1=/path/to/v1/checkout HEADLESS=true V2=$(git rev-parse --show-toplevel)
T=/tmp/kilo-v2-st-$ID; rm -rf $T; mkdir -p $T/user/User $T/repo
cat > $T/user/User/settings.json <<'EOF'
{
  "terminal.integrated.gpuAcceleration": "off",
  "terminal.integrated.tabs.enabled": false,
  "terminal.integrated.suggest.enabled": false,
  "terminal.integrated.shellIntegration.enabled": false,
  "terminal.integrated.enablePersistentSessions": false,
  "workbench.startupEditor": "none",
  "workbench.activityBar.location": "hidden",
  "workbench.statusBar.visible": false,
  "workbench.panel.opensMaximized": "always",
  "workbench.tips.enabled": false,
  "editor.accessibilitySupport": "off",
  "security.workspace.trust.enabled": false,
  "chat.disableAIFeatures": true,
  "telemetry.telemetryLevel": "off"
}
EOF
printf 'export const VERSION = "1.2.3"\n' > $T/repo/math.ts && git -C $T/repo init -q && git -C $T/repo add -A && git -C $T/repo -c user.name=t -c user.email=t@t commit -qm init
cat > $T/env.sh <<EOF
export KILO_SELF_TEST_REPO=$V1
T=$T
st() { node ~/.config/kilo/scripts/vscode-self-test/cli.mjs "\$@" --session kilo-v2-$ID; }
screen() { st evaluate --script 'return [...document.querySelectorAll(".xterm-rows > div")].map(r => r.textContent.trim()).filter(t => /[^\s┃╹▀]/.test(t)).join("\n")' | jq -r '.structuredContent.result | fromjson? // .'; }
idle() { sleep 1; st wait --text "esc interrupt" --state hidden >/dev/null; }
tclick() { P=\$(st evaluate --script "const el = [...document.querySelectorAll('.xterm-rows span')].find(s => s.textContent.includes(\$(jq -Rn --arg s "\$1" '\$s'))); if (!el) return ''; const r = el.getBoundingClientRect(); return Math.round(r.x + Math.min(r.width / 2, 20)) + ' ' + Math.round(r.y + r.height / 2)" | jq -r '.structuredContent.result | fromjson? // .'); [ -n "\$P" ] || { echo "not found: \$1"; return 1; }; st click --x \${P% *} --y \${P#* } >/dev/null; }
logs() { grep -h "\${1:-level=ERROR}" \$T/profile/data/opencode/log/*.log | tail -\${2:-20}; }
EOF
source $T/env.sh
st start >/dev/null
st launch-vscode --mode dev --build false --auth false --headless $HEADLESS --user-dir $T/user --workspace $T/repo >/dev/null
st run-command --command "View: Close Primary Side Bar" >/dev/null
st run-command --command "View: Close Secondary Side Bar" >/dev/null
st run-command --command "Terminal: Focus Terminal" >/dev/null
st type --submit --value "env KILO_V2_PROFILE=$T/profile bun $V2/script/dev-isolated.ts --standalone" >/dev/null
st wait --text "ctrl+p commands" >/dev/null && screen
```

The TUI is ready when the last command prints the home screen (about 15 seconds). To test signed out, start the CLI with `env XDG_DATA_HOME=$T/empty KILO_V2_PROFILE=...` instead.

### 2. Test

Start every later shell call with `source /tmp/kilo-v2-st-<ID>/env.sh`. Then act, read `screen`, and check for the expected text.

| Command | Use |
|---|---|
| `st type --value "<text>" >/dev/null` | Type a prompt, a slash command (`/connect`) or a mention (`@math`) |
| `st press --keys <keys> >/dev/null` | `Enter`, `Escape`, `Shift+Tab` (agent), `Control+p` (commands). Chords are two calls: `Control+x`, then `n` (new tab) or `m` (model) |
| `idle` | Wait until the answer is complete. Use after sending a prompt |
| `screen` | Print the terminal text |
| `tclick "<text>"` | Click visible TUI text, for example a tab title. Use a short unique part |
| `st wait --text "<text>"` | Wait until text appears |
| `logs` | Print CLI log errors. `logs "<pattern>" <lines>` for other lines |
| `st screenshot` | Only with `HEADLESS=false`. Read the PNG |

Example: check that an `@` mention attaches a file and the agent reads it.

```bash
source /tmp/kilo-v2-st-my-test/env.sh
st type --value "@math" >/dev/null; screen | grep math.ts   # suggestion is shown
st press --keys Enter >/dev/null
st type --value "What is VERSION? Reply with only the value." >/dev/null; st press --keys Enter >/dev/null; idle
screen | grep 1.2.3                                          # answer comes from the file
logs                                                         # no output means no errors
```

### 3. Clean up

```bash
source /tmp/kilo-v2-st-my-test/env.sh
st press --keys Control+c >/dev/null; st press --keys Control+c >/dev/null
st stop-vscode --cleanup true >/dev/null; st stop >/dev/null; rm -rf $T
```

### Pitfalls

- Read `screen` after every step. Dialogs chain: choosing a model opens a variant dialog, and the next typed text lands in its search field.
- Do not wait for text you typed. It is already on the screen. Use `idle`.
- `st click --text` does not reach the terminal. Use `tclick`.
- Headless runs cannot take screenshots. Set `HEADLESS=false` only for visual review, because the window then opens on the user's screen.
- New tabs get their title a few seconds after the first answer. The active tab title scrolls, so match a short part.
- Never type real credentials. Stop auth flows before the secret input, or use a test account.
- CLI data of a test: log in `$T/profile/data/opencode/log/`, database `$T/profile/data/opencode/opencode-local.db`.
- Parallel agents use different `ID` values.

The VS Code extension (G2) uses the same harness later, with `KILO_SELF_TEST_REPO` pointing at the v2 worktree.

## Test policy

Grow the test surface with each PR.

- Run `bun typecheck` and focused `bun test` from each changed package directory (never from the repo root), with the test isolation above.
- New Kilo code comes with tests for its behavior. Prefer real integration with the Kilo Gateway over mocks. Use small unit tests only for paths a live server cannot trigger (outage, malformed data).
- Upstream failures listed in `pinned-v2-baseline.md` are known. Do not fix unrelated ones. A new failure in a package you touched blocks the PR.
- Never delete or skip a test silently. List every skip in the PR with its reason.
- Self-test each user-visible behavior you add, and record the scenario so the next PR can repeat it.

## Evidence

In the PR and the final response, list:

- The commands you ran, and the self-test scenarios with pass, fail or blocked.
- Each shared upstream file you changed, with its option (1 to 5 above) and the missing seam.
- The CI state. For each red check, the cause: your change (fix it), a flake (one rerun) or a known baseline failure.
- The limits, for example a flow that needs credentials.
