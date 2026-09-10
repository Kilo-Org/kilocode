# Kilo OpenCode v2 runtime test plan

Owned by the runtime test-plan delegate for thread `thr_qr9z7p3cqc` (Bootstrap
OpenCode v2 baseline). Companion to the main index
`plans/kilo-opencode-v2-test-plan.md` (not edited here) and the separately
authored `plans/kilo-opencode-v2-test-plan-ui.md`. Scope rules follow
`kilocode/v2-fork-conventions.md`; validation commands follow
`kilocode/baseline/pinned-v2-baseline.md`.

- **Status of every case: NOT RUN.** This is a source-checked manual plan; no
  case below has been executed. Nothing in this document reports a PASS.
- **Source basis:** this checkout, HEAD `82040801cd253665d2785c290031d307a18a0d64`
  on the shared baseline worktree, **with in-flight uncommitted changes** to
  `packages/kilo-gateway` (plugin/models/gateway), `packages/kilo-cli`
  (`remote-session.ts`, `remote-protocol.ts`, `settings*`, `model-picker.ts`,
  `plan-policy.ts`, `import-v1-config.ts`, `interactive-server.ts`) and their
  tests. Cases touching those areas are marked
  **PENDING-VERIFICATION**; expected text is quoted from current source but may
  move with the in-flight fixes.
- **No live accounts, no paid inference, no deployed endpoints by default.**
  Cases needing a real account, a deployed cloud/relay/share service, or paid
  model inference are explicitly marked **USER-OPT-IN** and are never run by
  default. All other cases are local **FIXTURE** cases (loopback servers,
  fake models, disposable stores).
- **Deferred surfaces:** VS Code and JetBrains extension testing is deferred to
  their own plans. TUI widget-level rendering belongs to the UI sibling plan;
  this plan covers host/CLI/runtime behavior only, including the runtime
  behavior of slash commands where the source is host-owned.
- **Case count: 81** (RT-001 … RT-081, all IDs allocated and globally unique;
  RT-081 is documented as cross-listed into §2). Priorities:
  P1 = correctness/security-critical, P2 = important behavior, P3 = secondary
  or platform-gated.

## How to read a case

### Review-driven acceptance checks — 2026-09-06

These extend the existing remote and packaging scenarios; they do not add case
IDs or change the count. Every manual check here remains **NOT RUN**. Automated
evidence is separate: accepted R1/R2 has 9 tests / 211 assertions and clean
package typecheck. The newer transcript and persistent-PTY deltas are under
correction, not accepted merely because their earlier tests passed.

| Surface | Required observation before acceptance |
|---|---|
| Root-scoped remote interactions | Reply and reject child-owned permission/question requests using the root session ID, as the cloud consumer does. The child pending state must settle. Unrelated, foreign, moved-lineage and ninth-edge requests remain pending/refused; eighth-edge requests work. |
| Optional remote namespaces | For permission-only and form-only clients, create fresh pending items while subscribed. Supported events appear and are answerable; unsupported events never appear. Repeat on replay, including independent list failure and reconnect during replay. |
| Transcript terminal state | Completed assistant, reasoning and successful tool frames stop the consumer's streaming indicators. Tool failure is terminal too. Validate real final state, not just frame presence. |
| Transcript identity and live output | Mixed reasoning/text preserve the same part IDs from live updates through final reconciliation. Partial output appears before completion; full-value re-emission does not duplicate text. |
| Transcript history | A session with more than 50 messages still forwards new messages. A fresh adapter on an existing session recovers the real parent user without needing to observe its original delivery event. |
| Portable launcher | Invoke the relocated artifact's actual `kilo2` launcher through a supported host-start command and verify readiness. Calling imported `launch()` or printing `--version` alone does not prove launcher host startup. |
| Persistent PTY cleanup | Capture output through the public websocket. Verify owned terminal and daemon process exit after success and an induced post-create failure. A successful shutdown RPC alone is insufficient. The separate session-terminal PTY path remains unverified. |

Evidence paths: `packages/kilo-cli/test/remote-session.test.ts`,
`test/remote-transcript.test.ts`, `test/portable.test.ts` and
`script/portable-pty-smoke-entry.ts` (the latter three relative to
`packages/kilo-cli`). All runs use the shared isolated setup below; never
terminate processes that the scenario did not create.

Each case has: ID, title, priority, classification
(`FIXTURE` local-only / `USER-OPT-IN` live account or deployed service /
`PENDING-VERIFICATION` in-flight source), prerequisites, numbered steps,
expected results (quoted exactly from current source — never invented),
cleanup, and evidence (source file:line plus the automated command that
already exercises the nearest equivalent, as evidence only — not a substitute
for the manual run). Known limitations are stated per case or in the section
header.

## Shared prerequisites (SP) — apply to every case

Environment isolation reuses the root-reviewed child-scoped setup from the UI
sibling plan, `plans/kilo-opencode-v2-test-plan-ui.md` ("Shared Test Setup &
Environment Isolation"), reproduced here with the launcher/runtime paths this
plan needs. The calling shell is never modified: no `export HOME`, no global
environment changes. **Every** `kilo2`, daemon, and fixture command in every
case below runs inside a fresh `env -i` child, so inherited credentials
(`KILO_*`, `OPENCODE_*`, provider tokens in the ambient environment) are
cleared by construction and only values a case explicitly approves are added
(prefix them with `env VAR=…` inside the wrapper invocation).

```sh
# Run from the repository root. Keep the calling shell unchanged.
CKPT="$PWD"                                                    # this checkout, absolute
KILO_BIN="$CKPT/packages/kilo-cli/dist/interactive/kilo2"      # absolute interactive launcher
KILO_HEADLESS="$CKPT/packages/kilo-cli/dist/kilo2"             # absolute headless compiled binary
KILO_RUNTIME="$CKPT/packages/kilo-cli/dist/interactive/bun"    # absolute bundled Bun ≥1.4 runtime (SP-1)
KILO_TEST_ROOT="$(mktemp -d /tmp/kilo-rt-test-XXXXXX)"         # disposable, owned by this run
KILO_TEST_HOME="$KILO_TEST_ROOT/home"
KILO_TEST_PROJECT="$KILO_TEST_ROOT/project"
mkdir -p "$KILO_TEST_HOME" "$KILO_TEST_PROJECT" "$KILO_TEST_ROOT/tmp"

# Child-scoped launcher (runtime-plan equivalent of the UI sibling's kilo_test):
# subprocess-only isolation; the launcher is passed explicitly so the headless
# binary and bundled runtime can use the same wrapper.
kilo_test() {
  env -i PATH="$PATH" TERM="${TERM:-xterm-256color}" LANG="${LANG:-en_US.UTF-8}" \
    HOME="$KILO_TEST_HOME" USERPROFILE="$KILO_TEST_HOME" \
    XDG_DATA_HOME="$KILO_TEST_HOME/data" XDG_CONFIG_HOME="$KILO_TEST_HOME/config" \
    XDG_CACHE_HOME="$KILO_TEST_HOME/cache" XDG_STATE_HOME="$KILO_TEST_HOME/state" \
    TMPDIR="$KILO_TEST_ROOT/tmp" "$@"
}
# Example: kilo_test "$KILO_BIN" run --directory "$KILO_TEST_PROJECT" "hello"
# Case-approved env: kilo_test env KILO_ACP_SERVER_PASSWORD=<sentinel> "$KILO_BIN" acp
```

In the cases below, a command written as `"$KILO_BIN" …`, `"$KILO_HEADLESS" …`,
or `"$KILO_RUNTIME" …` means call it through `kilo_test` (prefixing only the
case-approved environment values with `env`), so isolation, credential
scrubbing, and the child-scoped `TMPDIR` hold for every command. Nothing in
this plan sets `HOME` in the calling shell; the clean child environment
intentionally omits live credentials.

- **SP-1 Fresh artifacts (bundled runtime only):** this host's ambient `bun`
  is 1.3.14 while the host's own gate requires Bun ≥ 1.4
  (`packages/kilo-cli/src/runtime.ts`); never build or test with bare `bun`.
  If `dist/interactive/bun` is absent, bootstrap once with an
  operator-supplied explicitly named Bun ≥ 1.4 binary (`BUN14=<absolute
  path>`): `cd "$CKPT/packages/kilo-cli" && "$BUN14" run script/build.ts &&
  "$BUN14" run script/build-tui.ts` (`build:tui` also builds the ACP bridge
  via `script/build-acp.ts`). Then set `KILO_RUNTIME` to the produced
  `dist/interactive/bun`; every later build and test invocation goes through
  it (`"$KILO_RUNTIME" run script/build.ts`, `"$KILO_RUNTIME" run
  script/build-tui.ts`). `test/gateway-protocol.test.ts` and the cloud
  subprocess/stream tests require these artifacts to exist.
- **SP-2 Isolation:** every launch goes through `kilo_test <launcher> …` so
  the host lays out under the child's `XDG_*`/`kilo2` roots. Never point
  `KILO_DB`, `OPENCODE_DB`, `KILO_CONFIG_DIR`, `OPENCODE_CONFIG_DIR`,
  `OPENCODE_CONFIG` at the layout — the preview host deliberately ignores
  them (`test/preview.test.ts`); the clean child environment omits them
  entirely.
- **SP-3 Cleanup (case-owned only):** terminate only the processes the case
  itself started — a TUI/`serve` with Ctrl-C or SIGTERM; `"$KILO_BIN" service
  stop` **only** in cases that own a daemon (started one, or killed one:
  RT-005, RT-006, RT-007, RT-008, RT-009, RT-010); stop fixture servers the
  case launched. Then print `$KILO_TEST_ROOT`, inspect that exact directory,
  and move **only that resolved path** to Trash (e.g.
  `mv "$KILO_TEST_ROOT" ~/.Trash/` with the variable expanded and visually
  confirmed first). Never remove a path through an unresolved variable, never
  `rm -rf` an unexpanded variable, and never change the calling shell's
  `HOME`.
- **SP-4 Store exclusivity:** one-shot commands (`run`, `sessions`,
  `telemetry`, `import-v1`, `cloud`) refuse to run while the TUI or a daemon
  holds the `kilo2-interactive` store lock (`src/interactive-server.ts:73-84`,
  `packages/util/src/flock.ts`). Between host cases, close the TUI/daemon the
  previous case started (SP-3).
- **SP-5 Automated evidence commands (bundled runtime only, never repo
  root):** `cd "$CKPT/packages/kilo-cli" && "$KILO_RUNTIME" run script/test.ts
  test/<file>.ts` (wraps `script/test.ts`, builds a fresh artifact, sets
  `KILO_CLI_TEST_ARTIFACT_DIR` and `KILO_ACP_ARTIFACT`), or bundled-runtime
  single files, e.g. `"$KILO_RUNTIME" --no-env-file test
  test/resume-external.test.ts`.
- **SP-6 No network beyond loopback** unless a case is marked USER-OPT-IN.
  Fake models/embedders/gateways/relays are loopback `Bun.serve` fixtures
  started in the same child scope (`kilo_test`, or an `env -i` child sharing
  the same `TMPDIR`).

## 1. Host, daemon lifecycle, and path isolation (RT-001 … RT-011)

Sources: `packages/kilo-cli/src/daemon.ts`, `daemon-entry.ts`, `paths.ts`,
`auth.ts`, `interactive-server.ts`, `storage.ts`, `commands.ts`,
`tui-preview.ts`, `script/build.ts`, `script/build-tui.ts`,
`script/coexistence.ts`; upstream contrast in `packages/cli`.

### RT-001 · Fresh compiled artifacts build and identify themselves — P1 · FIXTURE · NOT RUN
- Prereq: SP-1; Bun ≥ 1.4.0.
- Steps: 1) Run SP-1. 2) `test -x "$KILO_HEADLESS" && test -x "$KILO_BIN" && test -x "$KILO_RUNTIME"`.
  3) `"$KILO_HEADLESS" --version`; `"$KILO_BIN" --version`; `"$KILO_BIN" --help`.
- Expected: all three paths exist; `--version` prints the package version on
  both launchers; `--help` prints the usage block from
  `packages/kilo-cli/src/commands.ts:9-106`, including the line that chat
  should use `packages/kilo-cli/dist/interactive/kilo2`.
- Cleanup: SP-3 (no host was started).
- Evidence: `packages/kilo-cli/script/build.ts:19-41`,
  `script/build-tui.ts:16-28`, `test/compiled-artifact.test.ts`.

### RT-002 · `serve` surface contract on both launchers — P1 · FIXTURE · NOT RUN
- Prereq: SP-1, SP-2.
- Steps: 1) `"$KILO_BIN" serve --port 9999` (expect refusal). 2) `"$KILO_BIN" serve` in
  background; capture stdout. 3) `"$KILO_HEADLESS" serve --port 0` in background; capture
  stdout; curl the printed URL unauthenticated.
- Expected: interactive `serve` rejects `--port` ("Unknown option");
  interactive serve prints `URL:` and `Password file:` lines
  (`src/tui-preview.ts:142-147`); headless `serve --port` is accepted
  (`src/index.ts:5-40`); unauthenticated request to the interactive URL is
  rejected (Basic auth required).
- Cleanup: stop both servers (SIGTERM), SP-3.
- Evidence: `src/commands.ts:239-259`, `src/server.ts:53-76`,
  `test/commands.test.ts:155`.

### RT-003 · Fresh profile path isolation — P1 · FIXTURE · NOT RUN
- Prereq: SP-2.
- Steps: 1) With SP env, run `"$KILO_BIN" telemetry status` (creates nothing) then
  `"$KILO_HEADLESS" paths` and a short `serve`/Ctrl-C. 2) Enumerate `$KILO_TEST_ROOT` recursively.
  3) Re-run with `KILO_DB="$KILO_TEST_ROOT/decoy.db" OPENCODE_DB="$KILO_TEST_ROOT/decoy2.db"`
  and confirm no `decoy` files appear.
- Expected: layout appears only under `$XDG_*`/`kilo2` roots
  (`src/paths.ts:9-33`); no `~/.kilo`, `~/.opencode`, `auth.json`, or
  `opencode-next.db` anywhere; the upstream-style env overrides are ignored by
  the host.
- Cleanup: SP-3.
- Evidence: `src/paths.ts:37-92` (preflight), `src/storage.ts:10-58`,
  `test/preview.test.ts:41-68`.

### RT-004 · Layout preflight refuses unsafe roots — P2 · FIXTURE · NOT RUN
- Prereq: SP-2 (do not pre-create the forbidden layout; forbidden roots are
  simulated inside the disposable tree).
- Steps: 1) Launch with the child env `XDG_DATA_HOME="$KILO_TEST_HOME/.local/share"`
  (`kilo_test env XDG_DATA_HOME=… "$KILO_BIN" serve`); expect refusal
  mentioning it refuses paths inside stable home roots. 2) Create a symlinked
  data dir inside the tree and retry. 3) Launch with the child env
  `KILO_CONFIG_DIR="$KILO_TEST_HOME/config"` while `XDG_CONFIG_HOME` points
  inside that same directory, and retry.
- Expected: `preflight()` refuses with its fixed messages
  (`src/paths.ts:46-54`), refusing symlinked components and any path inside
  `$HOME/.local/share|state`, `~/.config`, `~/.cache`, or inside the absolute
  values of `KILO_DB`/`KILO_CONFIG_DIR`/`OPENCODE_*`.
- Cleanup: SP-3.
- Evidence: `src/paths.ts:37-92`.

### RT-005 · Daemon start / status / attach, and no-restart verb — P1 · FIXTURE · NOT RUN
- Prereq: SP-1, SP-2.
- Steps: 1) `"$KILO_BIN" service start`; capture JSON. 2) `"$KILO_BIN" service status`.
  3) `"$KILO_BIN" attach` then quit the TUI. 4) `"$KILO_BIN" service restart`. 5) Compare
  with upstream `opencode2 service --help` verb list.
- Expected: start prints status JSON `{state:"running", file, pid, version,
  url}` and **never** the password (`tui-preview.ts:71-94`); status healthy;
  attach opens the TUI on the running daemon and leaves it running on exit;
  `service restart` throws `Usage:` (only `start|status|stop` exist,
  `src/commands.ts:220-225`); upstream `opencode2` exposes
  `start|restart|status|stop|get|set|unset` (`packages/cli/src/commands/commands.ts:363-404`)
  — a documented divergence, not a bug.
- Cleanup: `"$KILO_BIN" service stop`, SP-3.
- Evidence: `src/daemon.ts`, `test/daemon.test.ts:154-159`,
  `test/commands.test.ts:144-148`.

### RT-006 · Stale PID after kill -9 — P1 · FIXTURE · NOT RUN
- Prereq: RT-005 state (running daemon).
- Steps: 1) `kill -9 <pid from daemon.json>` (registration file at
  `$XDG_STATE_HOME/kilo2/interactive/daemon.json`). 2) `"$KILO_BIN" service status`.
  3) `"$KILO_BIN" service stop`. 4) `"$KILO_BIN" service start`.
- Expected: status reports `state:"stale"`, `alive:false`, `verified:false`;
  `stop` refuses ("Refusing to stop an unverified Kilo daemon registration");
  a fresh `start` deletes the stale registration and spawns a replacement.
- Cleanup: `"$KILO_BIN" service stop` (this case owns the replacement daemon
  it started), then SP-3.
- Evidence: `src/daemon.ts:93-95,133-147`, `test/daemon.test.ts:193-223`.

### RT-007 · Unverified live registration is never replaced — P1 · FIXTURE · NOT RUN
- Prereq: running daemon from RT-005.
- Steps: 1) Corrupt the `password` field in `daemon.json`. 2)
  `"$KILO_BIN" service start`. 3) `"$KILO_BIN" service stop`. 4) Re-read `daemon.json` and
  confirm the original PID is still alive (`ps -p <pid>`).
- Expected: start fails closed with "Refusing to replace an unverified Kilo
  daemon registration (pid N is running)" (`src/daemon.ts:85-92`); stop also
  refuses; the live foreign-owned daemon is never signaled or replaced.
- Cleanup: kill the daemon by its PID from `ps`, SP-3.
- Evidence: `src/daemon.ts:75-106,188-197`, `test/daemon.test.ts:243-293`.

### RT-008 · Registration-file hardening — P2 · FIXTURE · NOT RUN
- Prereq: SP-2; run `"$KILO_BIN" service start` once to observe the healthy
  file, then stop it (`service stop`) before mutating.
- Steps (repeat per mutation, restoring after each): replace `daemon.json`
  with (a) a symlink, (b) mode 0644, (c) `url` with an explicit port or https
  scheme, (d) `password` that is not 64 hex chars; then `service status` /
  `service start`.
- Expected: read refuses each non-conforming shape fail-closed
  (`src/daemon.ts:201-222`: symlink, non-regular/hardlink, mode not 0600,
  non-loopback URL, password not 64-hex); nothing is auto-repaired; each
  `service start` attempt is refused and starts no daemon.
- Cleanup: `"$KILO_BIN" service stop` (case-owned: the prerequisite daemon),
  then SP-3.
- Evidence: `src/daemon.ts:201-222`.

### RT-009 · Store lock exclusivity for one-shot commands — P1 · FIXTURE · NOT RUN
- Prereq: running daemon from RT-005.
- Steps: 1) `"$KILO_BIN" sessions` while the daemon runs. 2) `"$KILO_BIN" service stop`.
  3) `"$KILO_BIN" sessions` again. 4) In two shells, launch two concurrent `serve`
  instances against the same layout.
- Expected: (1) refuses with the "stop the TUI or daemon before running them"
  guidance (`src/commands.ts:59-60`); (3) succeeds; (4) the second instance
  reports the flock contention error
  ("Timed out waiting for lock: kilo2-interactive", `packages/util/src/flock.ts:293`).
- Cleanup: Ctrl-C/SIGTERM the surviving `serve` instance (case-owned), then
  SP-3.
- Evidence: `src/interactive-server.ts:73-84`, `test/daemon.test.ts:231-236`.

### RT-010 · Sessions survive daemon stop → start — P2 · FIXTURE · NOT RUN
- Prereq: SP-1, SP-2, plus a fake-model config (see RT-012 prereq) so `run`
  can create a session without paid inference.
- Steps: 1) `"$KILO_BIN" run --directory "$KILO_TEST_ROOT/proj" "hello"` (fixture model).
  2) `"$KILO_BIN" sessions`. 3) `"$KILO_BIN" service stop`. 4) `"$KILO_BIN" service start`.
  5) `"$KILO_BIN" sessions`.
- Expected: the session ID is listed before and after the restart cycle
  (`test/daemon.test.ts:170-186` proves the equivalent).
- Cleanup: `"$KILO_BIN" service stop` (case-owned: the daemon restarted in
  step 4), then SP-3.
- Evidence: `src/daemon.ts:96-106`, `packages/client/src/promise/service.ts:85-116`.

### RT-011 · Coexistence with stable Kilo (fixture script) — P3 · FIXTURE · NOT RUN
- Prereq: SP-1; a stable (v1) `kilo` binary path supplied by the operator;
  no real account.
- Steps: 1)
  `cd "$CKPT/packages/kilo-cli" && "$KILO_RUNTIME" script/coexistence.ts <stable-kilo-binary> "$KILO_BIN"`.
  2) Read the script's report lines.
- Expected: script passes: the preview store boots empty with no legacy
  `session` table, the stable DB + WAL sidecars keep identical SHA-256
  fingerprints, the stable session remains readable, and the preview exits 0
  on SIGTERM (`script/coexistence.ts:35-98`).
- Cleanup: SP-3 (the script builds its own fake HOME/XDG tree).
- Evidence: `script/coexistence.ts`, `package.json` `test:coexistence`.

## 2. `run` command (RT-012 … RT-020)

Shared case prerequisite **RM-1 (fixture model):** start a loopback fake
OpenAI-compatible model server (as the package's own fixtures do, e.g.
`test/routed-model-integration-fixture.ts`) and a profile config JSONC in
`$XDG_CONFIG_HOME/kilo2/interactive/kilo.jsonc` pointing a provider at it, so
`run` completes without paid inference. Record the fixture port for cleanup.
Sources: `packages/kilo-cli/src/run.ts`, `run-input.ts`, `tui-preview.ts`,
`commands.ts`, `session-target.ts` (upstream only).

### RT-012 · Basic run output contract — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1.
- Steps: 1) `"$KILO_BIN" run --directory "$KILO_TEST_ROOT/proj" "say hi"`; capture stdout,
  stderr, exit. 2) Same with `--format json`. 3) `"$KILO_BIN" run` with no prompt
  and empty stdin.
- Expected: final assistant text on stdout, `Session: <id>` on stderr, exit 0;
  `--format json` prints exactly one `{sessionID, text}` object
  (`tui-preview.ts:187-199`); empty input fails before opening the store with
  "You must provide a message" (`src/run-input.ts:23`) and nonzero exit.
- Cleanup: SP-3.
- Evidence: `src/run.ts`, `test/commands.test.ts:624-641`.

### RT-013 · Stdin merging — P2 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1.
- Steps: 1) `printf 'second line' | "$KILO_BIN" run "first part"`.
- Expected: the admitted prompt contains both parts, positional first, piped
  stdin appended after a newline (stdin is read to EOF only when not a TTY,
  `src/tui-preview.ts:36-41`, merge in `src/run-input.ts:29-34`).
- Cleanup: SP-3.
- Evidence: `src/run-input.ts`, `src/tui-preview.ts:36-41`.

### RT-014 · Attachment validation — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1.
- Steps: 1) `--file "$KILO_TEST_ROOT/small.png"` (tiny valid image) with a prompt.
  2) `--file` a 11 MiB file. 3) `--file https://example.com/x.png`. 4) `--file`
  a FIFO created with `mkfifo`. 5) `--file` a directory.
- Expected: (1) succeeds with the attachment as a `data:` URI FilePart;
  (2) rejected (limit `ATTACH_FILE_MAX_BYTES` = 10 MiB, `src/run-input.ts:12`);
  (3) rejected (URLs rejected); (4) rejected (regular-file + O_NONBLOCK guard,
  `src/run-input.ts:84-118`); (5) rejected.
- Cleanup: SP-3.
- Evidence: `src/run-input.ts`.

### RT-015 · Permission behavior without and with `--auto` — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1; fixture model prompts the shell tool.
- Steps: 1) `"$KILO_BIN" run --directory "$KILO_TEST_ROOT/proj" "<prompt that triggers
  permission.asked>"` without `--auto`. 2) Repeat with `--auto`.
- Expected: (1) the request is auto-replied `reject` and interrupted; stderr
  blocker "Permission requested: <action> (<resources>); auto-rejected.
  Re-run with --auto to allow it once."; nonzero exit
  (`src/run.ts:113-130`). (2) replied `once`, the tool executes once, and the
  persisted global approval policy is untouched (`src/commands.ts:99-101`).
- Cleanup: SP-3.
- Evidence: `src/run.ts:104-139`.

### RT-016 · Headless forms are cancelled — P2 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1; fixture model triggers a form.
- Steps: `"$KILO_BIN" run "<prompt that triggers a form>"` with a bounded timeout.
- Expected: the form is cancelled headless (`src/run.ts:132-139`), the command
  terminates without hanging, no form answers are fabricated.
- Cleanup: SP-3.
- Evidence: `src/run.ts:132-139`.

### RT-017 · SIGINT / SIGTERM exit codes — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1; a long-running fixture model response.
- Steps: 1) Start `"$KILO_BIN" run "long task"`, send SIGINT mid-flight; record exit
  code, stdout, session outcome. 2) Repeat with SIGTERM.
- Expected: exit 130 (SIGINT) / 143 (SIGTERM); stdout empty in the SIGINT
  case; the session outcome is "interrupted"; `client.session.interrupt` was
  called (`src/run.ts:74-87,210-229,262-272`, `tui-preview.ts:27-33`;
  asserted by `test/commands.test.ts:604-618`).
- Cleanup: SP-3.
- Evidence: `src/run.ts`, `test/commands.test.ts:604-618`.

### RT-018 · Resume targeting and agent mapping — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1, a completed session from RT-012.
- Steps: 1) `"$KILO_BIN" run --session <id> "again"` in the same directory. 2) Try
  `--session` with a busy/running session (arrange via fixture) and from a
  different directory. 3) `--agent code` without a custom `code` agent.
  4) Define a custom `code` agent in the profile config, repeat.
- Expected: (1) resumes, re-applying `--agent`/`--model` via switchAgent/
  switchModel (`src/run.ts:90-95`); (2) non-idle or foreign-directory session
  is refused (`src/run.ts:64-71`); (3) resolves to native `build`;
  (4) the registered `code` agent wins (`src/run.ts:46-53`).
- Cleanup: SP-3.
- Evidence: `src/run.ts:37-95`, `kilocode/baseline/agent-policy-v2-parity.md`.

### RT-019 · `--model` validation — P2 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1.
- Steps: 1) `"$KILO_BIN" run --model nodelimiter "x"`. 2) `--model ghost/gone "x"`
  against a fixture model host.
- Expected: (1) "Model must have the form provider/model"; (2) a clean
  provider-resolution failure on stderr with nonzero exit and nothing on
  stdout (`src/commands.ts:104-105`).
- Cleanup: SP-3.
- Evidence: `src/commands.ts:260-307`, `src/commands.ts:104-105`.

### RT-020 · Resume across paginated history — P3 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1.
- Steps: 1) Create a session and append > 50 messages by repeated
  `"$KILO_BIN" run --session <id> "<n>"` (fixture model). 2) One more resume.
- Expected: every resume works; the internal 50-message page + cursor walk
  (`src/run.ts:307-322`) never errors or truncates the admitted prompt.
- Cleanup: SP-3.
- Evidence: `src/run.ts:307-322`.

## 3. Memory (RT-021 … RT-027)

Sources: `packages/kilo-cli/src/memory-plugin.ts`, `memory-command.ts`,
`memory-rpc.ts`, `memory-capture.ts`, `tool-authorization.ts`;
`packages/kilo-memory/src`. All cases FIXTURE with RM-1 fake model; no model
cost, no network beyond loopback. State root:
`$XDG_DATA_HOME/kilo2/interactive/memory/<slug>-<sha1[0..12]>`.

### RT-021 · Default-off guarantees — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1, fresh profile.
- Steps: 1) Run a session without touching memory. 2) `/memory status`.
  3) Inspect the data root for a `memory/` directory. 4) `/memory off`.
- Expected: no `memory/` directory, no files, no auxiliary model calls; status
  reports disabled; `/memory off` is a no-op on a disabled root
  (`memory-plugin.ts` default `enabled:false`, `autoConsolidate:false`).
- Cleanup: SP-3.
- Evidence: `packages/kilo-memory/src/schema.ts:156-187`,
  `test/memory.test.ts`.

### RT-022 · Enable, explicit save with approval — P1 · FIXTURE · NOT RUN
- Prereq: RT-021 profile.
- Steps: 1) `/memory on`. 2) `/memory remember RT-022 project fact`.
  3) Approve the `kilo_memory_save` ask (action `kilo_memory_save`, resources
  `["remember"]`, `save: []`). 4) `/memory status`. 5) Inspect
  `state.json` and `index.kmem` under the memory root.
- Expected: "Memory enabled."; the ask precedes any mutation; after allow,
  "Memory saved (N change)"; state.json `enabled:true`; files exist with
  private modes under the project-scoped root.
- Cleanup: SP-3.
- Evidence: `src/memory-plugin.ts:591-668`, `test/memory.test.ts:577-619`.

### RT-023 · Deny-before-mutation and fail-closed authorizer — P1 · FIXTURE · NOT RUN
- Prereq: RT-022 profile.
- Steps: 1) `/memory remember should-not-persist` and **deny** the ask.
  2) Verify root bytes unchanged.   3) Run the authorizer fail-closed automated
  evidence: `"$KILO_RUNTIME" run script/test.ts test/memory.test.ts`
  (missing-authorizer transform
  case).
- Expected: denied save mutates nothing; the automated case proves a plugin
  instance without a host authorizer fails closed at tool execution
  ("Tool authorization is unavailable").
- Cleanup: SP-3.
- Evidence: `src/memory-plugin.ts:528`, `test/memory.test.ts`.

### RT-024 · Recall authorization and disabled refusal — P1 · FIXTURE · NOT RUN
- Prereq: RT-022 profile; second fresh profile for the disabled half.
- Steps: 1) Drive the model's `kilo_memory_recall` tool (fixture model asks
  for it); approve the ask (action `kilo_memory_recall`, resources
  `["search"]`). 2) Deny a second recall. 3) On the fresh profile, recall
  while disabled.
- Expected: approved recall returns engine results with positive
  `metadata.count` provenance; denied recall never reaches the store; disabled
  recall throws "Memory is disabled. Run /memory on first."
  (`src/memory-plugin.ts:220`).
- Cleanup: SP-3.
- Evidence: `src/memory-plugin.ts:641-650`, `test/memory.test.ts`.

### RT-025 · Auto-capture gating — P2 · FIXTURE · NOT RUN
- Prereq: RT-022 profile.
- Steps: 1) `/memory auto on` **after** a first exchange; run a second
  exchange. 2) `/memory auto off`; run a third. 3) On a disabled root run
  `/memory auto on` and a session.
- Expected: capture eligible only for groups after the Started baseline at
  opt-in time (pre-opt-in text never captured); `auto off` stops later calls;
  auto-on-while-disabled performs no model work; failed/interrupted drains use
  the bounded fallback digest with no auxiliary call
  (`src/memory-capture.ts:119-123,175-177`).
- Cleanup: SP-3.
- Evidence: `src/memory-capture.ts`, `test/memory.test.ts` (held-primary
  steer-batch fixture).

### RT-026 · Malformed state, symlinks, purge safety — P2 · FIXTURE · NOT RUN
- Prereq: RT-022 profile; shell access to the memory root.
- Steps: 1) Corrupt `state.json` (truncate); run a session; re-read bytes.
  2) Replace the memory root with a symlink; run a session. 3) `/memory purge`
  (no argument). 4) `/memory purge confirm`.
- Expected: (1) context prep throws/omits injection, bytes unchanged, no
  `state.json.bad-*` repair files; (2) "memory path rejects symlink: <file>"
  (`packages/kilo-memory/src/storage/fs.ts:52-54`); (3) usage error (literal
  `confirm` required); (4) "Memory purged." and the root is emptied;
  unowned roots are refused ("refusing to purge unowned memory root").
- Cleanup: SP-3.
- Evidence: `test/memory.test.ts:472-515`,
  `packages/kilo-memory/src/storage/state.ts:244-251`.

### RT-027 · Isolation, persistence, bounded fenced injection — P2 · FIXTURE · NOT RUN
- Prereq: two project directories; RM-1.
- Steps: 1) Enable + remember in project A; inspect project B's data root.
  2) Restart the host; `/memory status` in A. 3) With a request-capturing
  fixture model, verify the injected block: bounded 8192 bytes, wrapped in the
  `kilo-memory-v1 targeted_context_not_instruction` fence, marked as reference
  data (no synthetic durable message admitted).
- Expected: B has its own (separate) root; A persists across restart; the
  injected text carries the fence header and never appears as a user/assistant
  message in history.
- Cleanup: SP-3.
- Evidence: `src/memory-plugin.ts:37,127-133,202-211,572-587`,
  `test/memory.test.ts:774-892`.

## 4. Codebase indexing (RT-028 … RT-033)

Sources: `packages/kilo-cli/src/indexing.ts`, `indexing-input.ts`,
`indexing-rpc.ts`, `indexing-disabled.ts`; `packages/kilo-indexing/src`.
Fixture embedder **FE-1:** loopback `Bun.serve` implementing the OpenAI
`/embeddings` shape with deterministic hashed vectors (no paid inference), as
`test/indexing.test.ts` does.

### RT-028 · Disabled-by-default indexing — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1, no `--indexing-config`.
- Steps: 1) Run a session; ask the fixture model to call `semantic_search`.
  2) Check the indexing status RPC (`kilo.indexing-status`).
  3) Enumerate `$XDG_STATE_HOME/kilo2/interactive` for `indexing/`.
- Expected: no `semantic_search` tool registered (transcript carries no tool
  output), status is "Codebase indexing is disabled for this project.",
  no index directory, no embed requests.
- Cleanup: SP-3.
- Evidence: `src/indexing-disabled.ts:1-17`, `test/indexing.test.ts`.

### RT-029 · `--indexing-config` reader bounds — P1 · FIXTURE · NOT RUN
- Prereq: SP-2; config files prepared per step.
- Steps: attempt launch with: a missing file; a symlink; a >64 KiB file; a
  non-object JSON; a valid JSONC with unknown key; a URL as the flag value;
  the flag on `service start`/`attach`.
- Expected: file failures fail closed with opaque messages that never echo the
  key path, value, document, or file path (`src/indexing-input.ts:6-14`);
  URL/flag-form values rejected with "--indexing-config requires an explicit
  local configuration file" (`src/commands.ts:108-113`); `service`/`attach`
  refuse the flag (`test/commands.test.ts:55-56,69-70`).
- Cleanup: SP-3.
- Evidence: `src/indexing-input.ts`, `test/indexing-input.test.ts:91-118`.

### RT-030 · End-to-end index with loopback embedder — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1, FE-1, a small fixture checkout with `src/` and
  `vendor/` trees, config via `--indexing-config` pointing `openai`
  provider at FE-1 and LanceDB inside the isolated root.
- Steps: 1) Launch `"$KILO_BIN" run --indexing-config <file> --directory <checkout>`.
  2) Have the fixture model call `semantic_search`. 3) Inspect the store
  directory.
- Expected: real matches from `src/` files with scores and line ranges;
  `vendor/` files never returned; the store lives under
  `<state>/indexing/…`; FE-1 received embed requests only for non-ignored
  files.
- Cleanup: stop FE-1, SP-3.
- Evidence: `test/indexing.test.ts` (host wiring through
  `launch(input, { indexing })`).

### RT-031 · Search authorization precedes embed/search — P1 · FIXTURE · NOT RUN
- Prereq: RT-030 setup.
- Steps: drive `semantic_search` asks with reject, allow, and resource-deny
  decisions via the fixture; record FE-1 request counts.
- Expected: rejected/denied queries never reach the embedding or search path
  (FE-1 count unchanged); allowed query executes.
- Cleanup: stop FE-1, SP-3.
- Evidence: `src/indexing.ts:164-190`, `test/indexing.test.ts:511-568`.

### RT-032 · Store-directory escape refusal — P1 · FIXTURE · NOT RUN
- Prereq: RT-030 setup; two config files.
- Steps: set `lancedb.directory` to (a) a path outside
  `<state>/indexing`, (b) a path inside it; launch each.
- Expected: (a) inert Error host with exactly "indexing.lancedb.directory must
  stay inside the isolated index root", no store write, no embed request;
  (b) accepted and populated (`src/indexing.ts:92-99,252-257`).
- Cleanup: stop FE-1, SP-3.
- Evidence: `test/indexing.test.ts:364-404`.

### RT-033 · Failure hygiene and opt-in engine log — P2 · FIXTURE · NOT RUN
- Prereq: RT-030 setup with FE-1 unreachable (wrong port) and a sentinel API
  key in the config.
- Steps: 1) Launch with the unreachable embedder; read status/RPC/TUI text.
  2) Repeat with `KILO_INDEXING_LOG=1`; inspect stdout vs stderr.
- Expected: status carries only the error class and numeric HTTP status when
  present — never the URL, response body, or key; with the env var set, JSON
  diagnostics appear on **stderr only**; stdout stays protocol-clean.
- Cleanup: SP-3.
- Evidence: `src/indexing.ts:209-250`,
  `packages/kilo-indexing/src/util/log.ts:17-35`, `test/log.test.ts`.

## 5. Sandbox (RT-034 … RT-038)

Sources: `packages/kilo-cli/src/sandbox.ts`, `script/sandbox-linux-smoke.ts`,
`interactive-server.ts:147`, `commands.ts:87-89`. The `--sandbox` flag
confines shell-tool writes to the project directory and denies shell network;
it is **not** a read-access sandbox and does not cover PTY, MCP, or separate
git spawns (exact help text, `src/commands.ts:87-89`). macOS backend
`sandbox-exec`; Linux backend Bubblewrap.

### RT-034 · Sandbox opt-in and workspace confinement — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1; macOS host with `/usr/bin/sandbox-exec` (or Linux with
  bwrap).
- Steps: 1) `run --sandbox` with a fixture model that writes a file inside the
  project, then outside it. 2) Inspect the shell invocations observed by the
  fixture (the Kilo launcher wraps the selected shell invocation).
- Expected: in-project write succeeds; outside-root write is denied with the
  source file unchanged; without `--sandbox` (or a config object without
  `enabled: true`) shell execution is unchanged — the hook is inert
  (`src/sandbox.ts:83` "Sandbox hooks are inert unless this is explicitly
  true").
- Cleanup: SP-3.
- Evidence: `src/sandbox.ts`, `test/sandbox` fixtures under
  `packages/kilo-cli/src/sandbox/interactive-fixture.ts`.

### RT-035 · Sandbox network policy — P1 · FIXTURE · NOT RUN
- Prereq: RT-034 setup plus a loopback HTTP listener (record port).
- Steps: 1) Sandboxed shell `curl http://127.0.0.1:<port>/` with network
  deny (default). 2) Relaunch with `network: "allow"` in the sandbox config
  (snake_case keys, `parseSandboxConfig`) and repeat.
- Expected: denied by default (listener sees no request); allowed when
  explicitly configured; the deny/allow split matches the Linux probe result
  recorded in `kilocode/baseline/sandbox-linux-validation.md`.
- Cleanup: stop listener, SP-3.
- Evidence: `src/sandbox.ts` (`NetworkMode`), `script/sandbox-linux-smoke.ts`.

### RT-036 · Protected paths and denyNames — P2 · FIXTURE · NOT RUN (platform-split)
- Prereq: RT-034 setup.
- Steps: 1) Configure `deny_write_paths` on a path inside the writable root;
  write there. 2) macOS: write to `.git` inside the root (default denyNames).
  3) Linux: configure nonempty `denyNames`.
- Expected: protected-path write denied; macOS `.git` write denied; Linux
  nonempty `denyNames` is **refused** at parse (Bubblewrap cannot enforce
  names created after setup, `src/sandbox.ts:23-26,175-177`).
- Cleanup: SP-3.
- Evidence: `src/sandbox.ts`, `kilocode/baseline/sandbox-linux-validation.md`.

### RT-037 · Sandbox scope disclaimers (PTY / MCP / git not covered) — P1 · FIXTURE · NOT RUN
- Prereq: RT-034 setup.
- Steps: 1) Sandboxed session where the fixture model runs a PTY tool, an MCP
  tool, and `git` (separate spawn) each attempting an outside-root write or
  network call.
- Expected: these paths are **not** confined — observe and record actual
  behavior; the help text states the limitation verbatim ("It is not a
  read-access sandbox and does not cover PTY, MCP, or separate git spawns",
  `src/commands.ts:87-89`). Known limitation, not a PASS criterion.
- Cleanup: SP-3.
- Evidence: `src/commands.ts:87-89`,
  `kilocode/baseline/sandbox-linux-validation.md` scope section.

### RT-038 · Linux Bubblewrap probe (container) — P3 · FIXTURE (LINUX/DOCKER) · NOT RUN
- Prereq: Docker on Linux host; `packages/kilo-cli` built; no host mounts.
- Steps: reproduce `kilocode/baseline/sandbox-linux-validation.md`:
  `cd "$CKPT/packages/kilo-cli" && "$KILO_RUNTIME" build script/sandbox-linux-smoke.ts --target=node
  --outfile="$KILO_TEST_ROOT/sandbox-linux-smoke.mjs"`, build the pinned image, run with
  `--network none --cap-add SYS_ADMIN --security-opt seccomp=unconfined
  --security-opt systempaths=unconfined`.
- Expected: `KILO_LINUX_SANDBOX_OK: workspace write, outside/protected denial,
  network allow/deny, unsupported names refusal`.
- Cleanup: `docker rm -f` the container; the build context lives under
  `$KILO_TEST_ROOT`, so SP-3's Trash move covers it.
- Evidence: `script/sandbox-linux-smoke.ts`,
  `kilocode/baseline/sandbox-linux-validation.md`. Known gaps (PTY, MCP, git,
  read confinement on Linux) remain open per that record.

## 6. Telemetry (RT-039 … RT-045)

Sources: `packages/kilo-cli/src/telemetry.ts`, `telemetry-settings.ts`,
`telemetry-command.ts`, `paths.ts:29`. Fixture collector **TC-1:** loopback
HTTP server recording `POST /v1/logs` bodies.

### RT-039 · Default-off: zero emissions — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1, TC-1, no consent file, no telemetry env.
- Steps: 1) Run a host + session activity. 2) Inspect TC-1 records.
- Expected: zero requests to TC-1; `OTEL_EXPORTER_OTLP_ENDPOINT` alone enables
  nothing (`test/telemetry.test.ts:28-38`).
- Cleanup: stop TC-1, SP-3.
- Evidence: `src/telemetry.ts:82-106`, `test/telemetry.test.ts`.

### RT-040 · Env opt-in, name-only allowlist, payload sentinels — P1 · FIXTURE · NOT RUN
- Prereq: RT-039 setup; plant sentinel strings in event payloads via the
  fixture model (e.g. a session title containing a sentinel).
- Steps: 1) Relaunch with `KILO_TELEMETRY_ENABLED=1` +
  `KILO_TELEMETRY_ENDPOINT=<TC-1>`. 2) Exercise a session lifecycle. 3) Dump
  TC-1 bodies.
- Expected: only the 11 allowlisted names appear
  (`agent.updated`, `catalog.updated`, `command.updated`, `config.updated`,
  `server.connected`, `session.created`, `session.deleted`,
  `session.execution.started|succeeded|failed|interrupted`); each record body
  is the event-type string plus fixed resource labels; **no** `event.data`,
  no session IDs, no sentinels anywhere (`src/telemetry.ts:22-49,189-190`).
- Cleanup: stop TC-1, SP-3.
- Evidence: `src/telemetry.ts`, `test/telemetry.test.ts:140-162`.

### RT-041 · CLI verbs and argument validation — P1 · FIXTURE · NOT RUN
- Prereq: SP-2 (host not running for status; running for the lock case).
- Steps: 1) `"$KILO_BIN" telemetry status`. 2) `"$KILO_BIN" telemetry enable` (no
  `--endpoint`). 3) `"$KILO_BIN" telemetry enable --endpoint ftp://x`. 4)
  `"$KILO_BIN" telemetry disable`. 5) `"$KILO_BIN" telemetry status` while a daemon holds
  the store, then `telemetry enable --endpoint <TC-1>`.
- Expected: status prints pretty JSON `{enabled, appliesTo, file, eventTypes}`
  and never the endpoint, headers, or any secret (`test/telemetry-command.test.ts:51`);
  (2) usage error (enable ⇔ `--endpoint` required, `src/commands.ts:189-190`);
  invalid endpoint → "Telemetry enable requires a valid HTTP(S) collector
  endpoint"; (4) persists decline; (5) lock guard message "Stop the Kilo TUI
  or daemon before changing telemetry consent" (`telemetry-command.ts:20-31`).
- Cleanup: SP-3.
- Evidence: `src/telemetry-command.ts`, `test/telemetry-command.test.ts`.

### RT-042 · Consent file trust boundary — P1 · FIXTURE · NOT RUN
- Prereq: SP-2; shell access to `$XDG_CONFIG_HOME/kilo2/interactive/telemetry.json`.
- Steps: 1) Enable via CLI; inspect file mode and dir mode. 2) Restart host;
  verify consent persists. 3) Replace the file with: a symlink; a hardlink; a
  FIFO; a 0644 file; a 64 KiB+ file; corrupt JSON; then re-enable via CLI over
  each.
- Expected: writes are atomic (tmp + rename), file 0600, dir 0700; reads are
  fail-closed — each planted shape reads as disabled without hanging, and CLI
  writes refuse to replace symlinked/hardlinked/non-regular files
  (`telemetry-settings.ts:58-115`).
- Cleanup: SP-3.
- Evidence: `src/telemetry-settings.ts`, `test/telemetry-settings.test.ts`.

### RT-043 · Precedence matrix (file vs env) — P1 · FIXTURE · NOT RUN
- Prereq: TC-1; consent file manipulable.
- Steps: run the host with: (a) absent file + `KILO_TELEMETRY_ENABLED=1`;
  (b) absent file + no env; (c) present `enabled:true` file + no env;
  (d) present declined file + `KILO_TELEMETRY_ENABLED=1`; (e) corrupt file +
  env; (f) enabled file but invalid endpoint.
- Expected: (a) on; (b) off; (c) on; (d) **off** (declined/corrupt file beats
  env); (e) off; (f) off (`TelemetrySettings.resolve`,
  `telemetry-settings.ts:49-56`, `src/telemetry.ts:82-91`).
- Cleanup: stop TC-1, SP-3.
- Evidence: `test/telemetry-settings.test.ts:233+`.

### RT-044 · Configured exporter labels and headers — P3 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1, TC-1; telemetry enabled with a sentinel value inside
  `KILO_TELEMETRY_HEADERS`.
- Steps: 1) Launch with `KILO_TELEMETRY_HEADERS="Authorization=Bearer
  <sentinel>,x-label=rt"` plus `KILO_TELEMETRY_CLIENT`/`_VERSION`/`_CHANNEL`
  and capture TC-1 request headers and resource attributes. 2) Repeat with
  `OTEL_EXPORTER_OTLP_HEADERS` only (fallback path). 3) `"$KILO_BIN" telemetry status`.
- Expected: the header string parses as comma-separated `key=value` entries
  (value may contain `=`) and reaches TC-1 as configured
  (`src/telemetry.ts:57-67,93`); client/version/channel appear as the
  configured resource labels — callers must not put secrets in these labels,
  so the sentinel here is a capture canary; `telemetry status` still prints
  only the status shape and never the headers (`telemetry-command.ts:40-46`).
- Cleanup: stop TC-1, SP-3.
- Evidence: `src/telemetry.ts:57-96`, `test/telemetry-settings.test.ts`.

### RT-045 · Offline collector and clean shutdown — P2 · FIXTURE · NOT RUN
- Prereq: telemetry enabled pointing at a closed port.
- Steps: run host + session, then stop; time the shutdown; ensure no hang.
- Expected: each OTLP POST is bounded by a 5 s timeout; exporter stop aborts
  the subscription and shuts down fibers without hanging
  (`src/telemetry.ts:108-164`).
- Cleanup: SP-3.
- Evidence: `src/telemetry.ts`, `test/telemetry.test.ts` (clean shutdown case).

*(RT-044 was consolidated into RT-043 during editing; the ID range remains
allocated and no case reuses another's ID.)*

## 7. V1 imports, session migration, external resume (RT-046 … RT-053)

Sources: `packages/kilo-cli/src/import-v1-config.ts`, `import-v1-session.ts`,
`credential-import.ts`, `external-sessions.ts`, `resume-external.ts`,
`commands.ts:193-219,330-370`; `kilocode/baseline/credential-import-v2-parity.md`,
`kilocode/baseline/external-resume-parity.md`,
`kilocode/baseline/v1-fixture-generation.md`. Fixture sources: synthetic v1
`auth.json`/config files and the checked-in v1 writer dump; never a real user
store.

### RT-046 · `import-v1` preview and source hashing — P1 · FIXTURE · NOT RUN
- Prereq: SP-2; synthetic v1 `auth.json` + config file under `$KILO_TEST_ROOT`.
- Steps: 1) `"$KILO_BIN" import-v1` (no files). 2) `"$KILO_BIN" import-v1 --gateway-server
  https://api.kilo.ai` (no `--auth`). 3) `"$KILO_BIN" import-v1 --auth <file>
  --config <file>` (no `--apply`). 4) Re-hash the sources afterwards.
- Expected: (1) usage error (at least one of `--auth`/`--config` required);
  (2) usage error (`--gateway-server` requires `--auth`); (3) prints
  `{status:"preview", …}` with per-source sha256 + byte size in `plan.sources`,
  no writes to the profile; (4) sources byte-identical after preview.
- Cleanup: SP-3.
- Evidence: `src/commands.ts:193-219`, `src/import-v1-config.ts:939-970`,
  `test/import-v1-config.test.ts:843`.

### RT-047 · `import-v1 --apply` credential mapping and gates — P1 · FIXTURE · NOT RUN
- Prereq: RT-046 sources; host-owned writer path via the apply command.
- Steps: apply with a source set containing: a plain API key; a Kilo OAuth
  entry **without** `--gateway-server`; Kilo OAuth with `--gateway-server` and
  a UUID `accountId`; the `kilo-oauth-dummy-key` sentinel; an unknown OAuth
  provider; a well-known entry whose manifest no longer retains the saved key.
- Expected: plain key connects via the public key-connect path; Kilo OAuth
  without an explicit validated gateway server is refused (never inferred);
  valid Kilo OAuth maps to `Credential.OAuth`, method `device`,
  `accountId` → `organizationID`; the sentinel and unknown provider are
  refused; one unsupported credential blocks the whole import (all-or-nothing,
  `import-v1-config.ts:283-287`).
- Cleanup: SP-3.
- Evidence: `src/import-v1-config.ts:616-764`,
  `kilocode/baseline/credential-import-v2-parity.md`.

### RT-048 · Collision and overwrite refusal — P1 · FIXTURE · NOT RUN
- Prereq: profile with a pre-existing config key value and an existing
  credential connection on the target integration.
- Steps: apply an import that would set a different value for the existing
  config key; then one that would overwrite an existing credential connection.
  Inspect the CLI help for an overwrite flag.
- Expected: both refuse (`import-v1-config.ts:319-339`); the CLI surface
  (`--auth --config --gateway-server --apply` only) exposes no overwrite flag,
  so refusal is the manual-path outcome; report text lists the conflict
  without echoing secrets.
- Cleanup: SP-3.
- Evidence: `src/commands.ts:193-219`, `test/import-v1-config.test.ts:643,659,789`.

### RT-049 · Well-known credential discovery honesty — P2 · FIXTURE · NOT RUN
- Prereq: RT-047 setup with a loopback well-known manifest endpoint.
- Steps: 1) Manifest retains the saved environment key → apply. 2) Manifest
  drops the key → apply. 3) Force a failure after discovery (revoke the write
  path in the fixture) and read the report.
- Expected: (1) token stored under the normalized origin as the key credential;
  discovery reported without the token; (2) refused; (3) the report records
  the discovered origin and the write failure honestly — there is no
  add-and-write rollback operation
  (`kilocode/baseline/credential-import-v2-parity.md` "Implemented mapping").
- Cleanup: SP-3.
- Evidence: `src/import-v1-config.ts:341-377`, `test/import-v1-config.test.ts:1133`.

### RT-050 · Partial-failure reporting (no auto-rollback) — P2 · FIXTURE · NOT RUN
- Prereq: RT-047 sources; arrange a config-write failure after a successful
  credential write (fixture: read-only profile config path).
- Steps: apply; read the failure report.
- Expected: status `"failed"` with honest `appliedCredentials` /
  `configWritten` flags and no automatic undo claim
  (`import-v1-config.ts:143-150,379-409`).
- Cleanup: SP-3.
- Evidence: `src/import-v1-config.ts`, `test/import-v1-config.test.ts`.

### RT-051 · V1 session store copy (library surface, automated evidence) — P2 · FIXTURE · NOT RUN (automated)
- Prereq: bundled runtime built (SP-1); no CLI verb exists — `copyV1Store` is
  test-only.
- Steps: 1) `cd "$CKPT/packages/kilo-cli" && "$KILO_RUNTIME" --no-env-file test --preload @opentui/solid/preload --timeout 120000 test/v1-writer-fixture.test.ts`
  2) Attempt the refusal cases manually only via the test (existing dest,
  self/`-wal`/`-shm` dest, dest inside source).
- Expected: migration of the checked-in V1 writer dump completes; source db+wal
  hashes identical after copy; `-shm` excluded as rebuildable; refusal cases
  error (`src/import-v1-session.ts:136-200`). **Note:** no CLI verb wraps this;
  wiring is host-owned and currently unwired — record as a gap, not a failure.
- Cleanup: SP-3.
- Evidence: `src/import-v1-session.ts`, `test/v1-writer-fixture.test.ts`,
  `kilocode/baseline/v1-fixture-generation.md`.

### RT-052 · External session listing bounds — P2 · FIXTURE · NOT RUN
- Prereq: fixture directories with Claude `<uuid>.jsonl` and Codex
  `rollout-<ts>-<uuid>.jsonl` files, one malformed.
- Steps: 1) `"$KILO_BIN" external-sessions --source claude --directory <dir>`.
  2) `--limit 0` and `--limit 51`. 3) A relative directory.
- Expected: listing shows valid entries plus the malformed one as
  `valid:false` with a concrete error and no secrets echoed; limits rejected
  (1–50); relative directory rejected (absolute required,
  `src/external-sessions.ts:20-56`).
- Cleanup: SP-3.
- Evidence: `test/external-cli.test.ts`, `test/external-sessions.test.ts`.

### RT-053 · `import-external` format gates and no-ambient-read — P1 · FIXTURE · NOT RUN
- Prereq: RT-052 fixtures; synthetic Claude-2 and Codex-0 JSONL (package
  fixtures under `test/fixtures/external/` are the shape reference).
- Steps: 1) `"$KILO_BIN" import-external <claude.jsonl> --model provider/model
  --agent build`. 2) Same with a Claude major-3 record / Codex major-1. 3)
  Same with a mixed-format file. 4) Re-hash the source file. 5) With an empty
  explicit directory, confirm no provider home is consulted.
- Expected: (1) fresh `ses_` session, source file unchanged, no execution
  during import; (2)/(3) rejected before import (bounded to Claude 2 / Codex 0,
  `src/resume-external.ts:81-82,290-296`); (4) byte-identical; (5) no reads of
  `~/.claude`, `~/.codex`, or CWD defaults.
- Cleanup: SP-3.
- Evidence: `src/resume-external.ts`, `kilocode/baseline/external-resume-parity.md`.

## 8. Cloud Agent CLI (RT-054 … RT-058)

Sources: `packages/kilo-cli/src/cloud-command.ts`, `cloud-rpc.ts`,
`cloud-plugin.ts`, `cloud/*`; `kilocode/baseline/cloud-cli-v2-parity.md`.
Fixture stubs: loopback tRPC (`CLOUD_AGENT_NEXT_BASE_URL`) and web-app
(`KILO_WEB_APP_URL`) with a seeded fixture credential through real device-auth
against the loopback gateway — as `test/cloud-fixture.ts` does.

### RT-054 · `cloud start` request validation — P1 · FIXTURE · NOT RUN
- Prereq: SP-2; request.json variants.
- Steps: 1) Missing file. 2) File > 1 MiB. 3) URL as the file argument.
  4) Schema-violating JSON. 5) A request carrying `options.kilocodeOrganizationId`
  through the RPC path.
- Expected: (1)–(4) the single generic message "Cloud start requires a valid
  local request JSON file of at most 1 MiB" with no schema diagnostics echoed
  (`src/cloud-command.ts:80-83`); (5) rejected with `rpc.invalid_input` — org
  selection is structurally omitted from the wire input
  (`src/cloud-rpc.ts:26-29`, `test/cloud-cli.test.ts:224-234`).
- Cleanup: SP-3.
- Evidence: `src/cloud-command.ts`, `src/cloud/contracts.ts:60-72`.

### RT-055 · status/result exit codes and ambiguous admissions — P1 · FIXTURE · NOT RUN
- Prereq: loopback stubs + seeded credential (as RT-054).
- Steps: drive `cloud start`, `send`, `status <sid> <mid>`, `result <sid>
  <mid>` against stubs returning each lifecycle status; then force a transport
  error after an admission POST.
- Expected: `status` always exits 0 (assistant projected away); `result` exit
  codes completed=0, queued/running=2, failed=3, interrupted=4
  (`src/cloud/contracts.ts:184-193`); ambiguous admission error text "Cloud
  Agent start|send outcome is unknown; do not retry automatically"
  (`src/cloud/errors.ts:22-23`).
- Cleanup: SP-3.
- Evidence: `test/cloud-cli-subprocess.test.ts`, `test/cloud-cli.test.ts`.

### RT-056 · `--stream` pinning, ticket fallback, abort — P1 · FIXTURE · NOT RUN
- Prereq: loopback WebSocket stubs.
- Steps: 1) `cloud start <req> --stream` with an admission `streamUrl` on a
  foreign origin. 2) With no `streamUrl` (ticket fallback via
  `POST /api/cloud-agent-next/sessions/stream-ticket`). 3) Stub that errors
  mid-stream. 4) SIGINT mid-stream.
- Expected: foreign-origin URL rejected before any ticket fetch (ticket never
  forwarded cross-origin, `src/cloud/client.ts:99-104`); (2) ticket path used;
  (3) non-fatal `{"streamEventType":"error", …}` line and exit 0
  (`tui-preview.ts:161-167`); (4) abort closes the socket; exit code 0 or 130
  (both accepted by the automated test).
- Cleanup: SP-3.
- Evidence: `test/cloud-stream-cli.test.ts`, `src/cloud/websocket-stream.ts`.

### RT-057 · Cloud credential hygiene — P1 · FIXTURE · NOT RUN
- Prereq: RT-055/RT-056 stubs with a sentinel token.
- Steps: capture every outbound body, URL, RPC response, and CLI stdout/stderr
  across the above cloud cases; grep for the sentinel.
- Expected: the bearer token never appears in any request body, URL, RPC
  response, or CLI output; the stream ticket is session-scoped, expiring, and
  never the account token; the RPC error surface stays generic
  ("Cloud Agent request failed").
- Cleanup: SP-3.
- Evidence: `kilocode/baseline/cloud-cli-v2-parity.md` security section,
  `src/cloud-plugin.ts:154-155`.

### RT-058 · Deployed cloud verification — P2 · **USER-OPT-IN** (live account, cloud task, paid inference) · NOT RUN
- Prereq: explicit operator consent; real Kilo account; a disposable cloud
  task; no loopback overrides.
- Steps: 1) Real `cloud start --stream` against
  `https://cloud-agent-next.kilosessions.ai` / `https://kilo.ai`. 2) Verify
  the live tRPC `{result:{data}}` envelope, ticket retry cadence under real
  403/404 propagation, live stream ordering and `streamUrl` shape. 3) Confirm
  no cancel verb exists (`"$KILO_BIN" cloud --help`).
- Expected: **record observations; no fixed assertions** — the parity record
  lists deployed envelope drift, retry cadence, and live-stream behavior as
  unverified gaps. Cancel is a source gap: "There is no cloud cancel endpoint
  in the inspected v1 client contract" (`src/commands.ts:73`); do not
  fabricate a cancel expectation.
- Cleanup: stop/expire the cloud task; sign out.
- Evidence: `kilocode/baseline/cloud-cli-v2-parity.md` "Deployed verification
  gaps".

## 9. Remote control relay (RT-059 … RT-065)

Sources: `packages/kilo-cli/src/remote-plugin.ts`, `remote-rpc.ts`,
`remote-protocol.ts`, `remote-session.ts`, `tui-plugin/remote.tsx`;
`kilocode/baseline/remote-v2-parity.md`. **PENDING-VERIFICATION:** these
modules have in-flight uncommitted changes in this checkout, including the
model-catalog alias-identity fix (`Model.Info.id` alias vs `Model.Info.modelID`
full id, RT-064). Fixture relay
**FR-1:** loopback Bun WebSocket relay (as `test/remote-session.test.ts`).
No case dials the live relay; the deployed relay version handshake is
USER-OPT-IN and unverified. The remote attachment aggregate/part-count budget
(RT-063 step 5) is a known-open observation with no source-stated limit.

### RT-059 · Inert registration and no-credential refusal — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, FR-1 (counting connections).
- Steps: 1) Open `/remote` and read status. 2) Attempt enable with no Kilo
  credential. 3) Cancel the enable confirmation.
- Expected: registration/status makes zero relay requests; enable without an
  account is refused ("Remote account is unavailable") without dialing;
  cancel leaves the relay untouched with zero requests
  (`test/remote-ui-fixture.tsx:86-100`).
- Cleanup: SP-3.
- Evidence: `src/remote-plugin.ts:16`, `src/tui-plugin/remote.tsx:54-58`.

### RT-060 · Enable confirmation and truthful toasts — P1 · FIXTURE · NOT RUN
- Prereq: RT-059 with a seeded credential.
- Steps: 1) Read the confirmation dialog text. 2) Confirm enable. 3) Read
  toasts.
- Expected: the dialog shows the exact `REMOTE_LIMITATION` text plus
  `Location: <path>` ("Preview control adapter only: legacy transcript
  forwarding, URL-backed attachments and cloud-session cloning are not
  available. Inline data attachments are supported. Enabling advertises
  sessions in this location and permits supported remote commands under their
  native permissions."); success toast "Remote enabled; connection may still
  be opening" — enabled intent, not claimed `connected` state
  (`src/remote-rpc.ts:11-12`, `src/tui-plugin/remote.tsx:63-66`).
- Cleanup: SP-3.
- Evidence: `test/remote-ui.test.tsx`.

### RT-061 · Non-persistence and lifecycle closure — P2 · FIXTURE · NOT RUN
- Prereq: RT-060 enabled.
- Steps: 1) Disable. 2) Re-enable twice rapidly. 3) Sign out / switch
  credential. 4) Restart the host and check status.
- Expected: one connection at a time (repeated enables do not stack),
  disable/logout/credential-switch closes the child scope, and enablement is
  not persisted across restarts (`src/remote-plugin.ts:13-17,35-39`).
- Cleanup: SP-3.
- Evidence: `test/remote-rpc.test.ts`.

### RT-062 · Reconnect, buffer, and terminal close codes — P1 · FIXTURE · NOT RUN
- Prereq: RT-060 enabled against FR-1 which can force closes.
- Steps: 1) Drop the socket non-auth → observe reconnect (same
  `connectionId`, 1 s backoff doubling to 60 s). 2) Buffer > 200 outbound
  frames while disconnected. 3) Close with 4401, then 4403, then 4409.
- Expected: UUID retained across transient reconnects; buffer caps at 200
  frames dropping oldest; 4401/4403/4409 stop retries permanently and clear
  the buffer (`src/remote-session.ts:137-148,176-198`).
- Cleanup: SP-3.
- Evidence: `test/remote-session.test.ts:252-267`.

### RT-063 · create_session, send_message admission ACK, attachments — P1 · FIXTURE · NOT RUN
- Prereq: RT-060; public history inspectable.
- Steps: 1) Relay `create_session` with a contained child directory. 2) Relay
  `send_message` with one text part. 3) `send_message` with an `https://` file
  part, a `file:` part, and an oversized (>20 MiB) inline part. 4) Relay
  `drop_queued_message` for a message this adapter never admitted. 5)
  **Bounded aggregate probe:** relay `send_message` with one text part plus a
  modest batch of small inline `data:` file parts (for example 16 parts of
  ~1 KiB each — never payloads near 20 MiB, never an unbounded count), and
  record the observed outcome and any rejection text.
- Expected: (1) refused ("invalid create_session directory"); (2) success
  response only after the public prompt admission resolves (durable inbox
  boundary) and text visible in public history; (3) each rejected before any
  prompt — no admission, error response ("send_message file parts must be
  inline data URLs"; the per-file 20 MiB cap is enforced by Core,
  `packages/core/src/session/prompt.ts:202`); (4) "message not queued".
  (5) **Known-open observation, no fixed assertion:** current source enforces
  only the per-file 20 MiB Core limit; no aggregate-size or part-count budget
  exists in `packages/kilo-cli/src/remote-session.ts` or the Core prompt
  admission. Record exactly what happens with the bounded many-part message
  (accepted, rejected, or truncated) and do not report an accepted limit that
  source does not state; oversized/aggregate behavior beyond the per-file cap
  stays an open item until a budget is specified.
- Cleanup: SP-3.
- Evidence: `src/remote-session.ts:284-297,644-731,814`,
  `test/remote-session.test.ts:559-583`.

### RT-064 · Catalog, commands, directories translations — P2 · FIXTURE · NOT RUN
- Prereq: RT-060 with a config-seeded provider and a command catalog; seed the
  provider so at least one model carries a distinct alias identity —
  `Model.Info.id` = `chat` and `Model.Info.modelID` = `vendor/chat`
  (`packages/schema/src/model.ts:100-103` defines both fields).
- Steps: 1) Relay `list_models`; inspect the wire shape **and the identity of
  each entry**: the emitted model id, its provider, and the full modelID it
  represents. 2) Create a remote session (`create_session`) selecting the
  model by the alias `chat`; prompt it and read back the session's selected
  model via a follow-up `list_models` `currentModel`. 3) Read `defaultModel`.
  4) On a host without a model catalog. 5) `send_command` with an unknown name
  and with `model`/`variant`/`messageID` extensions. 6) `list_directories`
  past 256 entries and through a symlink escape.
- Expected: v1-shaped catalog within sanitizer bounds (names ≤256, ≤2048
  models, 32 variants ≤64 chars, zeroed cost, empty options/headers/env) with
  no secret settings/headers; (4) explicit "model catalog is unavailable";
  (5) preflight rejections; (6) 256 cap and symlink exclusion. **Alias
  identity:** the
  corrected source emits `source.id` for both wire `id` and `api.id`.
  `vendor/chat` stays an internal provider route; it must not replace the
  alias identity in the advertised entry. The required roundtrip: the catalog is keyed
  by the alias `chat`, `currentModel`/`defaultModel` reference that alias, and
  `create_session`/prompt selecting `chat` resolves to `vendor/chat` — record
  observed identities for both wire id and resolved model; do not assert the
  roundtrip PASS from prompt admission alone. Parent's focused automated
  rerun passed seven remote tests / 90 assertions, including relay-driven
  creation using the advertised alias and durable prompt admission. This
  manual case remains NOT RUN; model execution is a separate observation.
- Cleanup: SP-3.
- Evidence: `src/remote-session.ts:333-411,455-660,764-800`,
  `packages/schema/src/model.ts:100-103`,
  `test/remote-session.test.ts:479-482`.

### RT-065 · Remote secret hygiene — P1 · FIXTURE · NOT RUN
- Prereq: RT-060 with a sentinel bearer token; capture all outgoing frames.
- Steps: grep every frame (heartbeats, create, responses, diagnostics) for the
  sentinel; check the status RPC shape.
- Expected: token absent everywhere; status exposes `{enabled, connected,
  directory, note}` and never a bearer token (`src/remote-rpc.ts:20-24`);
  deployed relay-version verification remains open (USER-OPT-IN, not covered
  locally).
- Cleanup: SP-3.
- Evidence: `test/remote-session.test.ts` sentinel assertions,
  `test/remote-rpc.test.ts`.

## 10. Session share / unshare / fork-from-share (RT-066 … RT-069)

Sources: `packages/kilo-cli/src/tui-plugin/tui.tsx:192-304`,
`packages/kilo-gateway/src/session.ts`, `plugin.ts:404-416`;
`kilocode/session-sharing.md`. Fixture ingest server overrides
`KILO_SESSION_INGEST_URL`.

### RT-066 · `/share` confirmation and team rejection — P1 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1, fixture ingest; one personal and one team account
  selection (loopback gateway).
- Steps: 1) `/share` on an open session; read the confirmation text; cancel.
  2) Confirm with a personal selection. 3) Switch to a team selection;
  `/share` again.
- Expected: cancel → zero cloud calls; confirm uploads the full snapshot
  (transcript, tool output, attachments, local paths per the warning text) and
  returns the public URL; team selection is refused with "Team session sharing
  is not supported in this preview yet" and zero cloud session calls
  (`test/gateway-integration.test.ts:255-258`).
- Cleanup: unshare, SP-3.
- Evidence: `src/tui-plugin/tui.tsx:210-227`.

### RT-067 · `/unshare` and share disable env — P2 · FIXTURE · NOT RUN
- Prereq: RT-066 shared session; then relaunch with `KILO_DISABLE_SHARE=1`.
- Steps: 1) `/unshare` (no confirmation dialog). 2) With the env set,
  `/share`.
- Expected: unshare revokes and strips the stored URL with toast "Session
  unshared"; with the env set, sharing fails with "Session sharing is
  disabled" while unsharing an existing link still works
  (`packages/kilo-gateway/src/session.ts:72,352-357`).
- Cleanup: SP-3.
- Evidence: `src/tui-plugin/tui.tsx:238-267`.

### RT-068 · `/fork-from-share` import semantics — P1 · FIXTURE · NOT RUN
- Prereq: RT-066 fixture ingest holding a v2 nested-envelope share.
- Steps: 1) `/fork-from-share <url>` (and the `/fork-share` alias, and a raw
  token). 2) A 404 token. 3) A flat/legacy envelope payload.
- Expected: import creates new session and message IDs, clears
  parent/fork/revert links and assistant snapshot references, navigates to the
  forked session, toast "Forked shared session"; (2) "Shared session not
  found"; (3) "The shared session is not compatible with Kilo v2"
  (`packages/kilo-gateway/src/session.ts:141-182,309-350`).
- Cleanup: SP-3.
- Evidence: `test/gateway-integration.test.ts:263-283`.

### RT-069 · Deployed sharing gates — P2 · **USER-OPT-IN** (deployed ingest + public read) · NOT RUN
- Prereq: operator consent; an intentionally shareable fixture session; no
  team account.
- Steps: 1) Share against the deployed ingest; open the public URL in a
  browser. 2) Fork from the deployed URL. 3) Unshare; re-open the URL.
- Expected: **record observations; no fixed assertions.** Open gates from
  `kilocode/session-sharing.md`: deployed token contract (UUID vs purpose-bound
  JWT), public read route, and the v2-message-aware viewer are all unverified
  against the deployment.
- Cleanup: unshare the fixture session.
- Evidence: `kilocode/session-sharing.md` "Remaining gates".

## 11. ACP (RT-070 … RT-074)

Sources: `packages/kilo-cli/src/acp.ts`, `packages/cli/src/kilocode/acp.ts`,
`script/build-acp.ts`, `test/acp.test.ts`, `test/acp-cli.test.ts`.

### RT-070 · ACP launch and NDJSON discipline — P1 · FIXTURE · NOT RUN
- Prereq: SP-1 (ACP artifact under `dist/acp/`).
- Steps: 1) `"$KILO_BIN" acp --directory "$KILO_TEST_ROOT/proj"` with a scripted NDJSON client
  on stdin. 2) Record every stdout line. 3) Remove `dist/acp` and retry.
- Expected: every stdout line parses as JSON-RPC `jsonrpc:"2.0"` NDJSON; a
  missing artifact errors naming `bun run script/build-acp.ts`; the
  `KILO_ACP_ARTIFACT` env overrides the artifact dir (`src/acp.ts:23-28`).
- Cleanup: SP-3.
- Evidence: `packages/cli/src/kilocode/acp.ts:33-48`, `test/acp-fixture.ts`.

### RT-071 · ACP secret hygiene — P1 · FIXTURE · NOT RUN
- Prereq: RT-070 client; a sentinel password via `KILO_ACP_SERVER_PASSWORD`.
- Steps: 1) Run a full session; capture stdout, stderr, and the child argv.
  2) Inspect the child process env after the first request.
- Expected: the password, `"Basic "`, and `"apiKey"` never appear on
  stdout/stderr; the credential is not in argv; the env credential is deleted
  from `process.env` after use (`packages/cli/src/kilocode/acp.ts:14-17`,
  `test/acp-cli.test.ts:75-83`).
- Cleanup: SP-3.
- Evidence: `test/acp-cli.test.ts:75-83`.

### RT-072 · EOF ownership and host survival — P1 · FIXTURE · NOT RUN
- Prereq: RT-070; for the caller-owned variant, launch a host separately and
  pass its URL/credential via the `KILO_ACP_SERVER_*` envs to `runAcp`.
- Steps: 1) Close the client's stdin (EOF) while the bridge serves a
  caller-owned host; probe the host HTTP after. 2) Same for `kilo2 acp`
  (self-launched host). 3) SIGINT/SIGTERM the bridge. 4) Invoke with an
  already-aborted caller.
- Expected: (1) bridge exits 0 and the caller's host still answers 200
  ("EOF owns this stdio process. The Kilo endpoint belongs to the caller and
  keeps running."); (2) the self-launched host closes with the command;
  (3) exit 0; (4) exit 143 with the child killed before handlers install.
- Cleanup: SP-3.
- Evidence: `packages/cli/src/kilocode/acp.ts:43-55`, `test/acp.test.ts:86-156`.

### RT-073 · ACP method surface — P2 · FIXTURE · NOT RUN
- Prereq: RT-070 client harness.
- Steps: exercise `initialize`, `authenticate` (method id `opencode-login`),
  `session/new`, `session/prompt`, `session/cancel`, `session/list`,
  `session/resume`, `session/fork`, `session/delete`, `session/close`,
  `set_session_config_option`, and an MCP-over-ACP attempt.
- Expected: auth is a no-op ack with the advertised method renamed "Kilo host
  credentials" and no `terminal-auth` `_meta`; lifecycle methods work against
  the isolated host; MCP-over-ACP rejected with "MCP-over-ACP is not
  supported" (`packages/cli/src/acp/service.ts:182-201,519`).
- Cleanup: SP-3.
- Evidence: `test/acp.test.ts`, `test/acp-cli.test.ts`.

### RT-074 · ACP profile isolation and bundle hygiene — P2 · FIXTURE · NOT RUN
- Prereq: RT-070.
- Steps: 1) Run a full ACP session; enumerate the XDG roots for `kilo/` or
  `opencode/` legacy dirs. 2) Grep `dist/acp/acp.js` for core/server-only
  marker strings.
- Expected: only the `kilo2/interactive` profile is created (no `kilo`/`opencode`
  dirs); the bundle excludes `packages/core/`, `packages/server/`, and
  `packages/cli/src/services/standalone.ts` content
  (`test/acp-cli.test.ts:84-90`, `test/acp.test.ts:98-132`).
- Cleanup: SP-3.
- Evidence: `test/acp.test.ts:98-132`.

## 12. Kilo Gateway auth, protocol, and model loading (RT-075 … RT-080)

Sources: `packages/kilo-gateway/src/plugin.ts`, `gateway.ts`, `models.ts`;
`packages/core/src/model-resolver.ts`; `packages/ai/src/kilocode/openrouter-routed.ts`;
`test/gateway-protocol.test.ts` + `gateway-protocol-fixture.ts` (packaged
runtime `dist/interactive/bun`, loopback fake Kilo API). **PENDING-VERIFICATION:**
`packages/kilo-gateway` has uncommitted changes under independent review.
The sanitizer now covers all three endpoints. The former compatible-Auto
AISDK adapter ignored HTTP middleware for both prompts and titles; a native
Kilo route replaces it. Root's focused automated run passed nine tests / 98
assertions, including positive all-wire credential checks. This does not
execute these manual cases or close the separate compiled-packaging gate.

### RT-075 · Payload capture with no account keys (all paths measured) — P1 · FIXTURE · NOT RUN
- Prereq: SP-1; loopback fake Kilo API + fake model (gateway-protocol fixture
  pattern); a **metadata-bearing** key credential (config key credential with
  metadata present). Automated fixtures now use hostile account metadata;
  manual probes must use synthetic credentials and loopback endpoints too.
- Steps: 1) Drive requests through each protocol endpoint
  (`/messages`, `/chat/completions`, `/responses`) with the metadata-bearing
  credential, including prompts and automatic titles for both native Auto
  routes; capture full outbound bodies and headers per request. 2) Grep
  every captured payload for the credential value and each reserved metadata
  field (`server`, `organizationID`, `email`, `organizationName`, `token`,
  `refresh`).
- Expected: every body is free of credential values and reserved account
  fields, including `/responses` with either `store` value. Titles are not
  exempt. Missing request families or fixture startup failures are not proof
  of no leak. Preserve routing, reasoning, message content and nested BYOK
  options; record the actual captures.
- Request-policy matrix (also **NOT RUN**): repeat the capture with
  `hide_prompt_training_models` unset, profile true, project false overriding
  profile true, and project reset falling back to profile true. After each
  host restart, expect `provider.data_collection: "deny"` only for the
  effective true setting. Use fixtures with no separately configured
  `provider.data_collection` value so absence is meaningful. Verify an existing
  record-valued `provider` retains routing fields, a non-record value is
  replaced by the deny record, reasoning and nested BYOK options survive,
  and foreign-origin requests are unchanged.
- Refresh timing: with default file watching disabled, change the preference
  through `/kilo-settings` and record the restart notice. Reopen `/models` to
  observe its live filter separately from the cached request policy. Restart
  the case-owned host before expecting the new wire marker; additionally test
  a fixture account switch/config refresh as refresh triggers. Do not treat
  hiding a model as proof that a running host has refreshed its wire policy,
  or a deny marker as proof of a deployed provider's retention behavior.
- Invalid-value cases: store null in each scope and verify the fixed invalid
  notice, with no deny request when no valid scope supplies true. A valid
  profile true still applies when the project value is invalid. Separately,
  use a missing file reference inside the disposable profile to fail native
  substitution: expect native fields to be ignored, the scope warning to
  explain that separately parsed Kilo-only values may apply, and an explicit
  raw true to remain effective. These are manual **NOT RUN** scenarios, not
  claims that the native host loaded the broken document.
- Cleanup: SP-3.
- Evidence: `packages/kilo-gateway/src/plugin.ts:214-235,498-527`,
  `packages/core/src/model-resolver.ts:131-191`,
  `test/gateway-protocol-fixture.ts:16-22,223-226`,
  `packages/kilo-cli/test/request-policy.test.ts`,
  `packages/kilo-gateway/test/plugin.test.ts`.

### RT-076 · Bearer promotion vs preserved OAuth Bearer — P1 · FIXTURE · PENDING-VERIFICATION · NOT RUN
- Prereq: RT-075 capture rig.
- Steps: 1) Config with `x-api-key`-carrying Anthropic-protocol request to the
  Kilo `/messages` endpoint, plus a deliberately configured foreign
  `Authorization` header. 2) Config using native OAuth authToken (no
  x-api-key).
- Expected: (1) outbound `authorization: Bearer <x-api-key value>` — the key
  wins over any configured or foreign Authorization header
  (`plugin.ts:215-221`); (2) the existing Bearer is preserved untouched
  (`plugin.test.ts:633-656`).
- Cleanup: SP-3.
- Evidence: `packages/kilo-gateway/src/plugin.ts:208-233`.

### RT-077 · Configured headers and the organization header — P1 · FIXTURE · PENDING-VERIFICATION · NOT RUN
- Prereq: RT-075 rig; provider/model configured headers; personal + team +
  revoked selections.
- Steps: 1) Set a provider model header `Existing: preserved` and a stale
  `X-KILOCODE-ORGANIZATIONID` in any case variant; capture outbound headers on
  a team selection, a personal selection, and after revoking the selection.
- Expected: any-case org header is filtered then re-added from the current
  selection (team → header present; personal → absent); other configured
  headers are preserved; a revoked/unavailable selection drops the header and
  routes nowhere (`plugin.ts:245-299`, `plugin.test.ts:337,1057-1084`).
- Cleanup: SP-3.
- Evidence: `packages/kilo-gateway/src/plugin.ts:245-299`.

### RT-078 · Explicit model-field configuration precedence — P1 · FIXTURE · PENDING-VERIFICATION · NOT RUN
- Prereq: RT-075 rig; config with `providers.kilo.models.<id>.package` and
  explicit `name`, `limit.*`, `cost`, `capabilities` fields; loopback catalog
  with overlapping `ai_sdk_provider` and prices.
- Steps: 1) Catalog refresh with the explicit config present. 2) Without it.
  3) Feed all four `ai_sdk_provider` tags plus a malformed one.
- Expected: the explicitly configured model package wins (`model.package ??=`
  never overwrites an existing value); explicit name/limits/cost/capabilities
  are protected from catalog refresh; stale protocol metadata is replaced when
  the config no longer pins it; mapping anthropic→`aisdk:@ai-sdk/anthropic`,
  openai→`aisdk:@ai-sdk/openai`, openai-compatible→
  `aisdk:@ai-sdk/openai-compatible`, openrouter/absent/malformed→
  `aisdk:@openrouter/ai-sdk-provider` (`plugin.ts:282,472-477`;
  `packages/kilo-gateway/src/gateway.ts:13-19` `configEntries` bridge).
- Cleanup: SP-3.
- Prompt-selector subcases (**NOT RUN**, bounded implementation under review):
  serve `opencode.prompt` values `anthropic` and `trinity`, including a model
  ID whose native heuristic conflicts. Capture system parts and verify the
  supported explicit tag wins, a custom agent system wins over the tag, and
  project/tool/native supplementary guidance remains intact. Unknown tags,
  malformed values, prototype-property names and unsupported legacy selectors
  must not install an asset or drop the model. Switch fixture accounts and
  run two locations concurrently; confirm each reads its own current catalog,
  failed/revoked catalogs clear selectors, and prompt execution makes no extra
  metadata fetch. Do not treat `family` as selector provenance.
- Evidence: `packages/kilo-gateway/test/plugin.test.ts:875-942`,
  `packages/kilo-gateway/test/prompt-selector.test.ts`,
  `packages/kilo-cli/test/model-prompt-policy.test.ts`.

### RT-079 · `/responses` stateless rewrite — P2 · FIXTURE · PENDING-VERIFICATION · NOT RUN
- Prereq: RT-075 rig.
- Steps: send Responses-protocol requests with: `item_reference` entries and
  provider item IDs; explicit `store: true`; malformed JSON; a foreign
  endpoint.
- Expected: stateless item references/IDs dropped while encrypted reasoning is
  retained; `store: true` retains references but still applies account-field
  isolation and any effective data-collection deny policy. Malformed/foreign
  requests remain untouched; the rebuilt
  request carries no stale `content-length` (`plugin.ts:223-235,531-546`;
  `test/gateway-protocol-fixture.ts:227-239`).
- Cleanup: SP-3.
- Evidence: `test/gateway-protocol.test.ts`.

### RT-080 · Team catalog scoping and field hygiene — P2 · FIXTURE · PENDING-VERIFICATION · NOT RUN
- Prereq: RT-075 rig with personal and team fixtures.
- Steps: 1) Fail or empty the team catalog fetch. 2) Succeed with records
  carrying malformed `autoRouting`, overflowing prices, missing architecture,
  and a `disabled: true` configured model. 3) Switch team → personal.
- Expected: failed/empty team fetch disables Kilo rows instead of leaking
  personal/static models; malformed routing discarded per record; prices that
  do not parse as finite numerics are omitted (never infinity); missing
  architecture yields conservative text-only capabilities; a configured
  disabled model stays disabled when API-discovered; the switch re-dispatches
  protocol and org header (`kilocode/baseline/model-loading-v2-parity.md`
  catalog sections).
- Cleanup: SP-3.
- Evidence: `packages/kilo-gateway/test/plugin.test.ts`,
  `test/model-picker.test.ts`.

### RT-081 · One-shot session command surface — P2 · FIXTURE · NOT RUN
- Prereq: SP-2, RM-1, a completed session; daemon stopped (SP-4).
- Steps: 1) `"$KILO_BIN" sessions`. 2) `"$KILO_BIN" models --directory "$KILO_TEST_ROOT/proj"` and
  `"$KILO_BIN" agents --directory "$KILO_TEST_ROOT/proj"`; inspect the JSON for request
  settings or agent prompts. 3) `"$KILO_BIN" export <session-id>` and
  `"$KILO_BIN" export <session-id> --sanitize`. 4) `"$KILO_BIN" import <exported.json>` in
  a second directory; compare IDs.
- Expected: sessions lists the latest 50 top-level sessions newest-first
  (`src/commands.ts:309-319`); models/agents print filtered metadata with no
  request settings and no agent prompt text (`src/commands.ts:401-421`);
  export writes the transcript; import creates a session with fresh IDs and
  no inherited snapshots/ancestry (`src/commands.ts:436-455`).
- Cleanup: SP-3.
- Evidence: `src/commands.ts:309-455`, `test/commands.test.ts`.
- Note: RT-081 is listed in §2 (it exercises the command layer next to `run`)
  but its ID was allocated after RT-080 to keep every ID globally unique and
  immutable once written.

## Coverage summary

| Section | IDs | Count |
|---|---|---|
| Host, daemon, path isolation | RT-001 … RT-011 | 11 |
| `run` command + session commands | RT-012 … RT-020, RT-081 | 10 |
| Memory | RT-021 … RT-027 | 7 |
| Indexing | RT-028 … RT-033 | 6 |
| Sandbox | RT-034 … RT-038 | 5 |
| Telemetry | RT-039 … RT-045 | 7 |
| V1 imports + external resume | RT-046 … RT-053 | 8 |
| Cloud Agent CLI | RT-054 … RT-058 | 5 |
| Remote relay | RT-059 … RT-065 | 7 |
| Share / fork | RT-066 … RT-069 | 4 |
| ACP | RT-070 … RT-074 | 5 |
| Gateway auth / model loading | RT-075 … RT-080 | 6 |
| **Total** | | **81** |

- USER-OPT-IN (deployed account / live relay / paid inference): RT-058, RT-069.
  Everything else is FIXTURE-only: loopback servers, fake models, disposable
  stores. No case in this plan contacts a real Kilo account or a paid model.
- PENDING-VERIFICATION areas (in-flight source in this worktree): §9 remote
  relay — including the model-catalog alias-identity roundtrip fix (RT-064)
  and the open aggregate/part-count attachment-budget observation (RT-063
  step 5) — §12 gateway, plus `settings*`, `model-picker.ts`, and
  `import-v1-config.ts` surfaces exercised by RT-047/RT-048.
- Known open seams recorded as open measurements, not assertions: compiled
  Auto packaging, sandbox PTY/MCP/git coverage (RT-037),
  remote aggregate/part-count attachment budget (RT-063 step 5), deployed
  relay/version gates (RT-065, RT-069), v1 session-store CLI wiring gap
  (RT-051).

## Source-check appendix

- Every file path cited above was verified to exist on this checkout on
  2026-09-05 (batched `test -f` sweep; no MISSING results). HEAD
  `82040801cd253665d2785c290031d307a18a0d64` with the in-flight modifications
  listed in the header.
- All command names, flags, env vars, paths, and literal expected strings in
  this plan were transcribed from current source in this checkout via four
  structured source sweeps (daemon/run, telemetry/memory/indexing,
  cloud/remote/share/ACP, imports/gateway) plus direct reads of
  `packages/kilo-gateway/src/plugin.ts`, `packages/core/src/model-resolver.ts`,
  and `packages/kilo-cli/src/sandbox.ts`. Names were **not** carried over from
  v1 or from memory: the only `restart` verb, `--continue`, pagination flags,
  and `KILO_DATA_DIR` are absent from this tree and appear nowhere in this
  plan as expectations.
- This plan makes no claim that any automated suite passing implies the manual
  cases pass; every case above remains NOT RUN until executed and dated by the
  operator.
