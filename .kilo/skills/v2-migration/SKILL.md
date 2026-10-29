---
name: v2-migration
description: Use for any work on the Kilo v2 migration (branches v2, v2-*). Covers the sources of truth, branches, PRs and upstream syncs, branding drift, the isolated test profile, how to self-test the v2 CLI yourself, the test policy, the progress map and PR evidence.
---

# Kilo v2 migration

Kilo moves onto upstream OpenCode v2 from a clean base, one feature at a time. Verify your own work. The user should not need to test it for you.

## Sources of truth

- Rules: `migration-tracking/principles.md` (direction, placement order, clients, identity, behavioral reference). It overrides any other doc, this skill included.
- Intent: `migration-tracking/plan.md` (objective, milestones, epics, out of scope). Live state: root issue #15297, its feature epics, milestones M1 to M4 and Project 42.
- Known upstream test failures: `migration-tracking/technical-notes/baseline/pinned-v2-baseline.md` (re-measured after each sync; it names the release it describes).
- What a v1 client changes to talk to v2: `migration-tracking/technical-notes/v1-v2-client-breaking-changes.md`.
- Gateway, login and enterprise support: #14991. Upstream sync and merge tooling: #15020.

## Working rules

- The upstream base moves: every upstream release is merged into `v2` (see Branches and PRs), so the migration keeps up with upstream. Build and check against the current `v2`, not the initial base.
- Before you place a change, load the skill `v2-feature-placement`. It applies the placement order of `principles.md` (section 2) to one change, with the commands to find the upstream extension point and the done-proof the progress map needs. Branding and product strings are rung 5 (see "Branding and upstream drift").
- Kilo logic packages (for example `kilo-gateway-core`) import nothing from `@opencode/*`. Only thin adapters do.
- The Kilo Gateway is the only source of Kilo models (`models.set`, no models.dev fallback). Requests identify as Kilo (token, team header, `X-KILOCODE-*`). See #14991.
- Markdown tables in Kilo-owned files use the compact form: a `|---|---|` separator row and single-space-padded cells, so a one-cell edit does not rewrite every row. Do not run `prettier --write` over Kilo documents: this tree does not exclude markdown from prettier, and it re-pads every table. Leave upstream documents formatted the way upstream formats them.

## Branches and PRs

- Integration branch: `origin/v2`. Branch from it and target it. Never target `main`.
- Upstream: `upstream/dev` is upstream's v2 line since 2026-10-10. `upstream/v2` is frozen; never merge it. Never merge upstream in a feature PR. An upstream sync is its own PR (#15020). It targets the next release that `v2` does not have yet (the release commit, which is the parent of the `v2.x.y` tag), and merges with a merge commit, never a squash. After a sync, open PRs merge `v2` into their branch and check and self-test again.
- Stack on an open v2 PR when you depend on it, and target that PR's branch.
- Never push directly to `v2`. A human merges.
- Short hyphenated branch names, no slashes. Titles `type(scope): summary`.

## Branding and upstream drift

Decision: keep the approach in PR #15417 as an **interim adapter**, not a permanent branding API. Its reference implementation is `packages/kilo-cli/src/branding/`; check whether the PR is merged before assuming those files exist on your branch.

- For these CLI/TUI surfaces, v1 used Kilo constants and OAuth wrappers called from patched shared files, rather than a translation catalog. The v2 adapter instead transforms selected upstream source text in memory, through Kilo-owned runtime/build wiring. Upstream source and unhosted behavior stay unchanged. Compiled binaries contain the branded result; they do not rewrite installed source at startup.
- The adapter still depends on exact paths and text anchors. Fewer shared-file patches does **not** mean less semantic coupling or automatic adaptation to upstream changes.
- Known anchor changes throw, and the branding tests read every mapped file and check each replacement. Changed wording and moved/deleted files must fail CI. In source development a missing anchor can also fail module loading; do not promise that drift is always a harmless fallback.
- New upstream text outside the mapping can remain unbranded without failing current tests. It needs manual review. A dedicated sync-time branding audit/report is a proposed follow-up, **not implemented automation**.

At every upstream sync, and after merging a newer `v2` into a branding branch:

1. Read the previous and new upstream pins through the sync tooling. Inspect renames, deletions and changes to mapped files; do not rely only on merge conflicts.
2. Locate moved code and update its mapping. Review changed wording before updating replacement anchors. Remove an entry only when its behavior is gone or tracked elsewhere; never weaken assertions just to make CI pass.
3. Review new user-visible names, commands, titles, links and callback pages. Preserve real OpenCode provider identities, package imports, protocol/keybind IDs and schema URLs. Use the host's config filename source, such as `KiloConfigFiles.newFile`, rather than guessing from the product name.
4. Run the focused branding tests and affected package typechecks. Keep both upstream/hosted controls, OAuth escaping checks, and real TSX rendering coverage in source and compiled modes. Repeat isolated source/compiled smoke checks when their surfaces change.
5. Record mapping adaptations, test results and remaining gaps in the sync/feature PR. Keep live CI status and evidence current; source-rendered OAuth screenshots do not prove a live browser sign-in.

The legacy sync branding passes exist but are disabled by default and process conflicts only. Do not enable them as a substitute for this review: their broad rules and scope differ from the adapter. Moving the same mapping to sync time or generated copies does not remove its path/string dependency. A stable API or a different generation mechanism needs a separate approved design; do not add upstream seams solely to remove Kilo-owned code.

## Isolation: never touch the v1 setup

- Run the CLI only through `bun dev` (`script/dev-isolated.ts`, which starts the Kilo host entry `packages/kilo-cli/src/index.ts`). It keeps all data in one profile directory. Never run `bun run --cwd packages/cli`, `dev:live` or `opencode` directly. They use the installed OpenCode data and service.
- Use a fresh profile per test: `KILO_V2_PROFILE=/tmp/kilo-v2-<id>`. Add `--standalone` so parallel agents do not share the service port.
- `bun dev` starts signed out and does not read the v1 login. Signed out, the Kilo Gateway serves its free models. Sign in with `/connect`, or start a signed-in test with `KILO_API_KEY` (and `KILO_ORG_ID` for a team) from the v1 auth file, so that no secret shows on screen.
- Do not edit the main checkout, `~/.config/kilo`, `~/.local/share/kilo` or OpenCode directories.
- Models: `kilo/kilo-auto/free` by default. Use `kilo/deepseek/deepseek-v4.1-flash` only when a paid model is needed.
- Isolate tests too. Upstream tests can write into the real home and leave servers running. Run them with `T=$(mktemp -d)` and `env OPENCODE_TEST_HOME=$T XDG_DATA_HOME=$T/data XDG_CONFIG_HOME=$T/config XDG_STATE_HOME=$T/state XDG_CACHE_HOME=$T/cache bun test ...`. After the run, stop any of your processes that `pgrep -fl 'opencode-test-|opencode-service-lifecycle'` lists.

## Self-test the CLI

Self-testing means you use the real CLI like a user and judge the result. Unit tests and typecheck do not count as self-testing.

**Quick check without UI:** `env KILO_V2_PROFILE=$(mktemp -d) bun dev run --standalone "<prompt>"`.

**TUI check.** The `vscode-self-test` harness runs the TUI in a quiet VS Code terminal and reads the terminal text. It launches VS Code without an extension (`--mode none`), so no v1 checkout and no v2 extension are needed.

### 1. Setup (one shell call)

Run `bun install` once in a new worktree. Without `node_modules` the TUI exits with `Cannot find module`. Set the first line, then run the whole block from the v2 worktree. Use a new `ID` for each test.

```bash
ID=my-test HEADLESS=true V2=$(git rev-parse --show-toplevel)
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
export KILO_SELF_TEST_REPO=$V2
T=$T
st() { node ~/.config/kilo/scripts/vscode-self-test/cli.mjs "\$@" --session kilo-v2-$ID; }
screen() { st evaluate --script 'return [...document.querySelectorAll(".xterm-rows > div")].map(r => r.textContent.trim()).filter(t => /[^\s┃╹▀]/.test(t)).join("\n")' | jq -r '.structuredContent.result | fromjson? // .'; }
idle() { sleep 1; for i in 1 2 3 4; do st wait --text "esc interrupt" --state hidden --timeout-ms 60000 | jq -e '.isError == false' >/dev/null && return 0; done; echo "idle wait failed (session busy or harness error)"; return 1; }
tclick() { P=\$(st evaluate --script "const el = [...document.querySelectorAll('.xterm-rows span')].find(s => s.textContent.includes(\$(jq -Rn --arg s "\$1" '\$s'))); if (!el) return ''; const r = el.getBoundingClientRect(); return Math.round(r.x + Math.min(r.width / 2, 20)) + ' ' + Math.round(r.y + r.height / 2)" | jq -r '.structuredContent.result | fromjson? // .'); [ -n "\$P" ] || { echo "not found: \$1"; return 1; }; st click --x \${P% *} --y \${P#* } >/dev/null; }
logs() { grep -h "\${1:-level=ERROR}" \$T/profile/data/opencode/log/*.log | tail -\${2:-20}; }
EOF
source $T/env.sh
st start >/dev/null
st launch-vscode --mode none --auth false --headless $HEADLESS --user-dir $T/user --workspace $T/repo >/dev/null
st run-command --command "View: Close Primary Side Bar" >/dev/null
st run-command --command "View: Close Secondary Side Bar" >/dev/null
st run-command --command "Terminal: Focus Terminal" >/dev/null
st type --submit --value "env KILO_V2_PROFILE=$T/profile bun $V2/script/dev-isolated.ts --standalone" >/dev/null
st wait --text "ctrl+p commands" --timeout-ms 60000 | jq -e '.isError == false' >/dev/null && screen
```

The TUI is ready when the last command prints the home screen (about 15 seconds). The CLI starts signed out. To test signed in, start it with `env KILO_API_KEY=$(jq -r .kilo.access ~/.local/share/kilo/auth.json) KILO_ORG_ID=$(jq -r '.kilo.accountId // empty' ~/.local/share/kilo/auth.json) KILO_V2_PROFILE=...` instead.

### 2. Test

Start every later shell call with `source /tmp/kilo-v2-st-<ID>/env.sh`. Then act, read `screen`, and check for the expected text.

| Command | Use |
|---|---|
| `st type --value "<text>" >/dev/null` | Type a prompt, a slash command (`/connect`) or a mention (`@math`) |
| `st press --keys <keys> >/dev/null` | `Enter`, `Escape`, `Shift+Tab` (agent), `Control+p` (commands). Chords are two calls: `Control+x`, then `n` (new tab) or `m` (model) |
| `idle` | Wait until the answer is complete (at most 4 minutes; reports a failure if the session does not become idle). Use after sending a prompt |
| `screen` | Print the terminal text |
| `tclick "<text>"` | Click visible TUI text, for example a tab title. Use a short unique part |
| `st wait --text "<text>"` | Wait until text appears. Default 10 seconds, `--timeout-ms` at most 60000. Check `isError` in the JSON |
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
- A free-model answer can show `Retrying` first when the Gateway upstream fails. `idle` waits through it. Report a test as blocked only when `idle` reports a failure.
- `st click --text` does not reach the terminal. Use `tclick`.
- Headless runs cannot take screenshots. Set `HEADLESS=false` only for visual review and for the PR screenshots (section `## Proof` under Evidence), because the window then opens on the user's screen.
- New tabs get their title a few seconds after the first answer. The active tab title scrolls, so match a short part.
- Never type real credentials. Stop auth flows before the secret input, or use a test account.
- CLI data of a test: log in `$T/profile/data/kilo2/log/opencode-local.log`, database files in `$T/profile/data/kilo2/`.
- Parallel agents use different `ID` values.

The VS Code extension uses the same harness later with `--mode dev`, after the v2 worktree has `packages/kilo-vscode`.

### Debug the server

The TUI is an HTTP client of a server process. `bun dev` uses the profile's background service unless you pass `--standalone`, which starts a private server for that one call. All commands below take the same `KILO_V2_PROFILE` as the test (`P=<profile>`). Outside the checkout, replace `bun dev` with `bun $V2/script/dev-isolated.ts`.

- **Service:** `env KILO_V2_PROFILE=$P bun dev service status|start|restart|stop`. `status` prints the server URL. Stop the service when the test is done.
- **API:** `bun dev api` sends one request through the same discovery and auth as the CLI, so you can compare what the TUI shows with the server state. Pass a method and path as separate arguments, or an OpenAPI operation ID: `bun dev api get /api/info`, `bun dev api server.info`, `bun dev api get /api/agent`. Use `--param key=value`, `--data '<json>'` and `-H name:value` as needed. `/api/info` returns the server `pid`.
- **Logs:** one shared file per profile, `$P/data/kilo2/log/opencode-local.log`. Each line is `key=value` text with `level`, `run=<id>` (one process) and `role=cli|server`; filter with `grep 'run=<id>'` or `grep 'role=server'`. For more detail, set `OPENCODE_LOG_LEVEL=DEBUG` before the server starts (restart the service). `--print-logs` copies logs to stderr (server logs only with `--standalone`).
- **Heap snapshot:** `kill -USR1 <server pid>`. Wait for `heap snapshot written` in the log; the file is `heap-<pid>-<time>.heapsnapshot` in the log directory, and its `path=` is authoritative. A large heap takes seconds to write.
- **CPU profile:** `kill -PROF <server pid>` records ten seconds. Wait for `CPU profile written`; the file is `cpu-<pid>-<time>.cpuprofile` in the log directory. Open both files in Chrome DevTools.
- **Inspector:** `env KILO_V2_PROFILE=$P BUN_OPTIONS=--inspect=127.0.0.1:0 bun dev <args>` prints two inspector URLs: the first is the `bun dev` wrapper, the second the CLI process.
- Heap and CPU signals do not exist on Windows.

## Test policy

Grow the test surface with each PR.

- Run `bun typecheck` and focused `bun test` from each changed package directory (never from the repo root), with the test isolation above.
- New Kilo code comes with tests for its behavior. Prefer real integration with the Kilo Gateway over mocks. Use small unit tests only for paths a live server cannot trigger (outage, malformed data).
- Known upstream failures are listed in `pinned-v2-baseline.md` for the release it names. When `v2` has moved past that release, compare against `origin/v2` before your change. Do not fix unrelated ones. A new failure in a package you touched blocks the PR.
- Never delete or skip a test silently. List every skip in the PR with its reason.
- Self-test each user-visible behavior you add, and record the scenario so the next PR can repeat it. Attach the proof (v1 and v2 screenshots, or another proof) as described in Evidence.

## Progress map

`migration-tracking/progress/README.md` is the generated map of Kilo's v1 delta: one cell per Kilo-owned file, `/kilocode/*` API operation and patch in a shared upstream file, grouped by feature. `bun script/upstream/progress.ts` regenerates it; CI fails when it is stale. Module and API cells turn done on their own only when the file name or path literal lands on v2. Renamed files, patch cells and decisions need a proof from you. Every port closes the cells it replaces in the same PR, so for every port:

- Before you start, run `bun script/upstream/progress.ts --list <feature>`. The open cells are the inventory of the feature; each patch cell names its v1 source line. Read a v1 hunk with `git show <v1Target>:<path> | sed -n '<line-10>,<line+15>p'` (the pin is `pins.v1Target` in `features.json`).
- Close each cell with the first proof that applies:
  1. The v2 code is a marked line in a shared upstream file: `// kilocode_change(<feature>:<id>)` on it.
  2. The v2 code is in a Kilo-owned file (rung 1 or 2): `// kilo_port(<feature>:<id>)` on it. This includes a Kilo adapter that only selects or configures upstream code, and a Kilo-owned v2 test that carries the assertions of a v1 test patch cell.
  3. A module or test ported under another name: give the new file the v1 name when that name fits the package (the cell then closes by name). Otherwise add a `ported` disposition with the v2 path and symbol in `note`.
  4. Upstream v2 has the behavior and no Kilo code is involved: a `native` disposition with the v2 pointer.
  5. The behavior is not carried: a `dropped` disposition with the evidence (see below).

  Dispositions go in `migration-tracking/progress/dispositions.json` with `state`, `note` and `by` (your branch name). Without a proof the cell stays open. An unknown ID, or a proof in the wrong kind of file, fails the run. The map records the rung where the cell landed.
- Verify before you close a cell. A proof or a disposition says that v2 has the behavior, not that a file exists:
  - Compare the v1 hunk or file with the v2 code you name, behavior by behavior: defaults, precedence, retries, error paths and tests.
  - Find the v1 callers: `git grep -n <symbol> <v1Target> -- packages`. Code with no caller on v1 is `dropped` (write that in the note), not `ported`.
  - `dropped` means the feature is not carried: a shim, dead v1 code, or a recorded decision (Out of scope in `plan.md`, or the epic or PR that made it). When an epic ports the behavior, the cell stays open and the PR names the epic. "Not ported yet" is never `dropped`.
  - When part of the behavior is missing, port the gap if it is small and in scope. Otherwise leave the cell open and give the gap in the PR. Do not close a cell with a known gap.
  - A hunk is attributed by its first Kilo import or identifier, so it can carry lines of other features (for example one plugin list with three plugins). Close it for your feature only when the other lines are tracked by their own cells, and say so in the PR.
  - A v1 test cell closes only when the v2 tests carry its important assertions. Add the missing ones when they are cheap. When v2 does the opposite on purpose, use `dropped` with the reason.
  - A classification in a task, a plan or a peer message is a claim. Verify it the same way, and report each one you found wrong.
- Git must track a new file before the map sees it: `git add` new files before you regenerate.
- A loose patch that lands in `unattributed:<area>` can be proved in place with `kilo_port(unattributed:<area>:<id>)`, which closes the cell. It still belongs to a feature: tag its v1 marker on `main` as `kilocode_change(<feature>)` in a small follow-up PR; the next re-pin moves it into the feature box.
- Regenerate before you commit: run `bun script/upstream/progress.ts` twice (the output must be identical), then `--check`, then `--list <feature>` again. Every cell that stays open needs a reason in the PR. CI posts one comment per PR with the delta (percent, changed features, closed and dropped cells), the placement line (new marked lines in shared files by rung, new `kilo_port` annotations, new core-internal imports), the two ratchets and the treemap of the head commit; the `progress.json` diff carries the same information.

## Evidence

In the PR and the final response, list:

- The commands you ran, and the self-test scenarios with pass, fail or blocked.
- The proof that the change works as on v1, as the PR section `## Proof` below. This is mandatory for every PR that changes behavior.
- Each shared upstream file you changed, with its rung (`principles.md` section 2, or 5 for branding) and the missing seam.
- The progress map delta, as the PR section below.
- The CI state. For each red check, the cause: your change (fix it), a flake (one rerun) or a known baseline failure.
- The limits, for example a flow that needs credentials.

### PR section `## Proof`

Every PR that changes behavior shows that the behavior works on v2 as on v1. A PR without this section is not done.

- **User-facing change:** compare v1 and v2. Take screenshots of the same screen in the same state on v1 and on v2, and attach both to the PR description, labeled. When v2 differs on purpose, say why. When v1 has no such screen, show v2 only and say so.
- **No UI to show:** attach another proof from a real run (for example a transcript or captured requests, on v1 and v2 when possible). Test output alone is not enough.
- **Isolation:** run v1 so that it never reads or writes the real v1 data (a temporary home, not the user's profile).
- **Privacy:** show no real user data (emails, names, organizations, IDs, tokens, balances, session content). Use fixture accounts. Never commit screenshots to the repository.

### PR section `## Progress map`

Every PR that changes the map (a proof, a disposition, or a file that closes a cell by name) has this section. It tells the reviewer why each cell changed, so that the reviewer does not have to read `dispositions.json` or the CI comment. Keep it short: one line per cell or per group of cells with the same reason. The `note` in `dispositions.json` is the long form.

```
## Progress map

`<feature>`: 12/87 to 59/75 (12 dropped). module 9/44 to 30/35, patch 0/20 to 12/18, test 3/23 to 17/22; landed 11 plugin.

Done, and why:
- kilo_port (11): v1 kilo.ts import, settings and SDK -> core/src/kilocode/gateway.ts provider transform and packageFor; ...
- ported (30): renamed modules and tests, for example api/url.ts -> kilo-gateway-core/src/server.ts; ...
- by file name (5): ported tests autocomplete, edit, fim, ...
- native (1): 00d34e8d5cd7, upstream Variant.resolve.

Dropped, and why it is not needed:
- server/routes.ts, server/fim.ts, server/edit.ts: Hono routes with no caller on v1; the live routes are tracked in the server box.
- types/jsx.d.ts, types/tui.d.ts: type shims for TUI code outside the TUI package.

Still open:
- cloud-sessions.ts and its test: cloud session import, #15306.
- 5 transform.ts cells: default request settings for Gateway models, needs its own issue.

Corrections: <classifications from the task, plan or a peer that you changed, with the evidence>.
```

- "Done" names the v2 code that has the behavior. Name the gap you ported in the same PR, if any.
- "Dropped" says what the code did on v1 and why v2 does not need it, with the evidence (no caller, shim, recorded decision). Name a behavior change that a drop causes for users.
- "Still open" names what is missing and the epic or feature that owns it.
- Leave out a block that has no entries. Do not repeat the cell lists of the CI comment.
