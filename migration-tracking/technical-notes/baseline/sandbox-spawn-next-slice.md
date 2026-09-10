# Sandbox spawn coverage — next-slice audit and MCP implementation

## Current continuation — 2026-09-07

Following the prepared patch and Johnny's continuation, the host now installs
`Mcp.SpawnHooks.beforeSpawn` through its Location node override when sandboxing
is enabled. The narrow shared edit is `packages/core/src/mcp/index.ts`; policy
stays in `packages/kilo-cli/src/sandbox-mcp.ts`. The hook executes inside the
existing MCP connection scope and failure pipeline. Each local connection
acquires an argv launcher and disposes it when the connection closes; raw
catalog configs remain unchanged. There is no activation-time MCP plugin or
transform to register, dispose or wait for.

Core typecheck and two native MCP lifecycle regressions pass (15 assertions).
Independent implementation review found no blockers. The test delegate verified
13 MCP tests and 7 shell sandbox tests on the native host, including cold-add
confinement, disabled direct-connect, reload and connection cleanup. The parent
sandboxed run reports 7 pass / 13 skip; those skips are not additional native
acceptance. Portable build `build-udBYOF` passes isolated loopback TUI, daemon
reuse and default PTY attach smoke checks; exiting the client preserves the
daemon. CLI typecheck passes after explicit local-config narrowing in the
tests; no casts are used to hide the hook's local/remote return type.
PTY, remote MCP and separate git spawns remain outside this change. The sections below retain the earlier audit and
rejected transform/latch designs as history; their registration and approval
status is superseded by this continuation.

Date: 2026-09-06. Checkout: `kilo-v2` at `61a8707c03` plus the frozen accepted batch.
Scope: sandbox PTY/MCP/git audit; the MCP slice is implemented in Kilo-owned
files only, on root's approval. The accepted Explore shell policy
(`packages/kilo-cli/src/agent-policy.ts`) is untouched and stays intact.

## 1. Two different ceilings — keep the vocabulary exact

- **Shell permission ceiling** (model policy): `createExplorePolicy` and
  `createAgentPolicy` (packages/kilo-cli/src/agent-policy.ts) gate *which
  commands the model may request* at the Permission layer. They evaluate parsed
  command resources through `permission.assert` (packages/core/src/tool/plugin/shell.ts:144-152)
  and `permission.evaluate` (packages/core/src/permission.ts:174). They never
  change process capability.
- **OS sandbox** (enforcement): `createSandboxPlugin` (packages/kilo-cli/src/sandbox.ts:161)
  replaces the selected shell with a short-lived launcher
  (sandbox.ts:208-221) so the spawned process tree runs under
  `sandbox-exec`/`bwrap` — confining writes outside `sandbox.root`, `.git`
  (denyNames), and network regardless of any permission grant.

They compose at different points and neither implies the other: permission
answers "may this run"; the OS sandbox bounds "what a permitted command can
touch once running". A command the policy denies never spawns; an allowed
command still runs confined. The MCP slice below adds OS confinement only; the
permission ceiling is a separate, already-accepted surface.

## 2. Spawn producer inventory — exact hook ordering and call paths

| Surface | Producer chain (exact references) | Public seam today | Covered by `--sandbox`? |
|---|---|---|---|
| Shell tool (model) | `ShellTool` execute → `shell.create(input, prepare)` (core/src/tool/plugin/shell.ts:210) → invocation built (core/src/shell.ts:257-267) → `hooks.trigger("shell","create.before")` (shell.ts:268) → tool `before` = permission prepare (shell.ts:269, tool/plugin/shell.ts:114-162) → `environment.spawner.spawn(ChildProcess.make(invocation.shell, args))` (shell.ts:293-302) | `shell.hook("create.before")` (packages/plugin/src/effect/shell.ts:11-17) | Yes — hook rewrites shell→launcher before spawn (kilo-cli/src/sandbox.ts:208-221); launcher set before permissions run (command string unchanged) |
| MCP stdio servers (user-configured, model-invoked tools) | `ConfigMcpPlugin` sets configs via `mcp.transform` (core/src/config/plugin/mcp.ts:39-56, internal `pre` phase, core/src/plugin/internal.ts:190-191) → `Mcp.Service.startServer` (core/src/mcp/index.ts:512-537) → `McpClient.connect` destructures `config.command` (core/src/mcp/client.ts:218-229) → `McpStdio.make` → `environment.spawner.spawn` (core/src/mcp/stdio.ts:82-92), Environment provided at index.ts:534 | `ctx.mcp.transform` editor (packages/plugin/src/effect/mcp.ts:6-12) | No — rewrite implemented but unregistered pending the activation gate (§4) |
| PTY (user-initiated TUI terminal) | `Pty.Service.create` (core/src/pty.ts:164-182) → direct `spawn(command, args)` from `#pty` — Bun.spawn (core/src/pty/pty.bun.ts:7) or node-pty (core/src/pty/pty.node.ts:13). Bypasses every spawner service and hook; command is the user's login shell (pty.ts:166) | None — plugin context exposes only `experimental.terminal.read` (packages/plugin/src/effect/plugin.ts:33-35) | No — open, see §6 |
| Git / VCS machinery (host-internal) | Global `AppProcess.Service` (core/src/git.ts:167; spawns at git.ts:315, 444, 622, 718), VCS git plugin (core/src/plugin/vcs/git.ts:27,170-177), worktree.ts:154, project.ts:99, integration.ts:265/611, formatter.ts:31 | `AppProcess.node = makeGlobalNode({ deps: [CrossSpawnSpawner.node] })` (packages/util/src/process.ts:268); replaceable only at the host composition root via `profile().overrides` (kilo-cli/src/host.ts:20-28, server/src/routes.ts:140-157) — process-global | No — provisional, see §6 |
| Files exec defaults (stat/read/write/list/remove/move/mkdir via `sh -c`) | `execDefaults(driver.spawner)` (core/src/environment/exec-defaults.ts:73-148) wired by `makeFiles` (core/src/environment/index.ts:24-27) | None (inside Environment layer) | No — host-trusted |
| Ripgrep, workspace connect, integration, persistent-pty daemon | core/src/ripgrep.ts:120, ripgrep/binary.ts:41, workspace.ts:286, integration.ts:611, persistent-pty/daemon.ts:230 | None relevant | No — host-trusted |

Shared plumbing: `Environment.node` deps `[CrossSpawnSpawner.node, Location.node, Workspace.node]`
(core/src/environment/environment.ts:37-41). Shell and MCP stdio share the same
per-Location spawner; git uses the global `AppProcess` node on the same
underlying `CrossSpawnSpawner` implementation but through a different,
process-global service.

## 3. Refutation: "MCP confinement needs an upstream seam"

The next-batch row (plans/kilo-opencode-v2-next-batch.md:49) claims Core owning
the MCP spawn (`core/src/mcp/index.ts:533` execution plane) means MCP
confinement needs an upstream seam or a shared patch. The spawn *call* is
upstream, but the spawned *command* is mutable config state behind a public
plugin seam:

- `MCPDomain.transform` (packages/plugin/src/effect/mcp.ts:6-12) exposes
  list/get/set/update/remove over in-memory `Mcp.ServerConfig`s
  (core/src/mcp/index.ts:681-707). Nothing persists to user config; `reconcile`
  (index.ts:619-657) diffs state vs applied entries and restarts replaced
  servers, and `startServer` spawns from the rewritten `entry.config`.
- Ordering is safe: core's `ConfigMcpPlugin` registers in the internal `pre`
  list (core/src/plugin/internal.ts:190-191); a Kilo plugin registered with
  `phase: "post"` folds after it on every rebuild — `State.get()` replays
  transforms in registration order over a fresh editor (core/src/state.ts:119-128),
  and `config.updated` → `mcp.reload()` re-runs the same order
  (core/src/config/plugin/mcp.ts:24-35). `MCP.add` overrides survive reloads
  through `initial()` (index.ts:683-690) and are rewritten by the same replay.
- Precedent: `McpCodeModeExclusionPlugin` already rewrites MCP configs from a
  plugin (core/src/plugin/mcp-codemode-exclusion.ts:12).

The launch mechanism is the already-validated persistent launcher
(macosPersistentLauncher/linuxPersistentLauncher, kilo-cli/src/sandbox.ts:391-425),
applied at the argv level instead of the shell-hook level. No upstream edit, no
monkeypatching, no process-global interception.

Residual honesty, now empirical: config-defined servers spawn only after the
whole activation batch completes, because every plugin load folds inside one
`State.batch` (core/src/plugin.ts:102-144) whose notifications run after the
batch (core/src/state.ts:137-152) — so the first reconcile already sees the
sandbox rewrite. Proven empirically: the enabled-from-initial-config host test
uses an exclusive first-boot sentinel that records that boot's own
outside-root write attempt, and it reads denied. Hosts that register plugins
late would see a brief unconfined first connect — same class as the shell hook
(post-registration spawns only).

## 4. MCP slice — implemented in Kilo-owned files, NOT accepted

Root approved the MCP implementation within bounded Kilo-owned scope. The
independent reviewer (Luna) rejected it with two P1 findings; root withdrew the
production registration. The code and tests stay; the feature is unregistered
and must not be re-registered until the activation gate below ships. No row
credit is claimed.

- **P1 — activation race (Luna, reproduced).** `client.mcp.add` reaching a
  cold location spawns the server while plugin activation is still in flight:
  the server handlers resolve `Mcp.Service` directly and `service.add`
  reloads/reconciles immediately (packages/server/src/handlers/mcp.ts:22-35),
  while the supervisor activates plugins asynchronously. A first boot before
  the sandbox transform registers runs unconfined (sentinel `wrote`); the
  post-activation control is denied. The earlier enabled-from-initial sentinel
  test passed only because it awaited activation first.
- **P1 — Linux separator (Luna).** `linuxArguments` already terminates with
  `--` (sandbox.ts:534), so the argv launcher appended a second separator and
  produced `bwrap ... -- -- <command>`, which execs the separator. Fixed in
  this round; regression covers both backends.

- **New `packages/kilo-cli/src/sandbox-mcp.ts`:**
  - `sandboxServerCommand(server: Mcp.ServerConfig, launcherPath: string):
    SandboxServerCommand | undefined` — pure decision boundary; returns
    undefined for remote servers, disabled servers, and empty argv.
  - `registerSandboxMcpTransform({ transform, directory }, config)` — creates
    one launcher, registers an `Effect.addFinalizer` cleanup in the owning
    scope, and registers the `mcp.transform` rewrite.
  - `createSandboxMcpPlugin(config): Plugin` — id `kilo2.sandbox-mcp`, phase
    `post`; inert unless enabled, fail-fast when the backend is unavailable.
- **One exported helper in `packages/kilo-cli/src/sandbox.ts`, with no change
  to any existing line:** `createSandboxArgvLauncher(config, root)` returning
  `{ path, dispose }`. It reuses the existing OS policy builders
  (`macosProfile`, `linuxArguments`) through two new private argv script
  builders. The confined executable arrives as the launcher's first argument,
  so argv is fully preserved and zero-argument MCP commands work; the existing
  shell launchers and their two-argument guard are untouched.
- **Rewrite semantics:** `command` becomes `[launcherPath, ...originalCommand]`
  via `editor.update`. When the original `command[0] === "opencode"`,
  `BUN_BE_BUN: "1"` is baked into the server environment (user values keep
  precedence). Verified against `core/src/mcp/client.ts:226`: after wrapping,
  the destructured `command` is the launcher path, so the native special case
  no longer fires and the baked marker is the only source.
- **No path-based skip.** A user-controlled command path that references a
  `kilo2-sandbox-` directory is still wrapped; a path is not provenance.
- **Idempotence through real state rebuild:** production folds transforms in
  registration order over fresh state (core/src/state.ts:119-128), so the
  rewrite is unconditional and always applies the same launcher path. The test
  replays the config-set and sandbox transforms against core's real
  `State.create` across a full `reload()` and asserts one stable launcher with
  no nesting.
- **Scope lifecycle (empirically verified parts only):** plugin effects run in
  a per-plugin child scope (core/src/plugin.ts:44); the transform disposal
  (core/src/state.ts:171) and the launcher finalizer bind to that same scope,
  so launcher files exist exactly while the transform is registered.
  Proven in the real host: a config reload (`client.mcp.add`) restarts the
  server via reconcile and the restart reuses the same launcher and stays
  confined; host shutdown with the server child still live stops the child and
  removes every launcher directory the host created (temp baseline captured
  before the host launch); and an enabled-from-initial-config scenario shows
  the first boot — whenever it ran relative to activation — was already
  confined, via the exclusive first-boot sentinel. What is NOT asserted: the behavior of a
  plugin-only transform removal while a Location stays alive (not reachable
  from any public host API in this host) — the earlier claim that reconcile
  would then safely restart servers unconfined is retracted until proven.
- **Registration withdrawn:** root removed the `createSandboxMcpPlugin`
  registration from `interactive-server.ts` after the P1 rejection; the
  `--sandbox` help text stays unchanged. The plugin must not be re-registered
  until the activation gate below is in place and the gated host scenarios
  pass.
- **Honest limits:** env is still host-extended (`extendEnv`, stdio.ts:86); cwd
  outside `sandbox.root` stays readable (read confinement is out of scope, as
  already documented); the server command changes to the launcher path in the
  plugin editor view (public `servers()` exposes name/status/integrationID,
  index.ts:719-723).

MCP OS confinement is stricter than v1: v1's `executeMcp` (origin/main
packages/opencode/src/kilocode/sandbox/policy.ts:638-639) asserted delegated
network authority around MCP tool calls (origin/main .../sandbox/network.ts:95-99)
and never OS-confined the server process.

### Activation blocker — analysis frozen; gate design on hold for review

Independent proposal review — 2026-09-07: the consultation's monotonic-latch
patch is rejected as written. `Latch.open` is an Effect action rather than a
boolean state read; uncontained hook failures would leave `pending` status;
and a latch left open across transform disposal permits an unwrapped restart.
The activation-await deadlock is confirmed. A revised spawn-time verification
of the current folded configuration needs contained failure status and an
activation/disposal regression. PTY refusal also needs a typed error decision;
the proposed hook alone does not yield a clean public refusal. No MCP/PTY Core
edits or production registration were made. The shared-hook decision remains
pending; the original proposal must not be implemented verbatim.

Gate implementation is ON HOLD. Two prior proposals are rejected and recorded
only as constraints: the cyclic `Plugin.node` dependency, and the
`Effect.serviceOption` absent→proceed seam (root: **fail-open is not an
acceptable sandbox boundary**; watchers-off is not proof that
`config.updated` cannot fire mid-activation).

**Reviewer direction (Luna), recorded not endorsed:** a narrow Core
`beforeSpawn` callback at the single `startServer` producer plus refreshed
config after the gate. `startServer` is the single producer for every spawn —
automatic reconcile (core/src/mcp/index.ts:512-537), `add`/`reload`
reconcile, and the public `connect` (index.ts, `connect` → `startServer`) —
so one callback covers all spawn paths including plugin-fiber reloads. Root
requested USER approval for the shared-file (Core) exception under the fork
conventions; **no Core edits until the user replies**, and this document does
not assert the proposal deadlock-free — the deadlock analysis (initial
batch-deferred reconcile vs. gate ordering) is the reviewer's to prove.

**Additional confirmed bypass, fixed in this round:** a disabled local server
is startable via public `mcp.connect` — `connect` calls `startServer`
unconditionally, while the `disabled` flag only gates the automatic reconcile
spawn (core/src/mcp/index.ts:595, 634, 670). The rewrite now covers all local
configs including disabled ones (`sandboxServerCommand` no longer skips
`disabled`): the rewrite keeps the disabled flag intact so nothing spawns
automatically, but a direct connect lands on the launcher. Regression: with
the policy registered through the fixture-owned option, a direct
`client.mcp.connect` after activation starts the server confined (startup
probe denied). Production registration stays off.

The first proposal (a Kilo-owned node depending on `Plugin.node`) was
correctly rejected by root as cyclic, and its "remove cannot spawn" claim was
unsupported. Verified against source:

- **Cycle confirmed.** `Plugin.node` is a location node whose only dep is
  `PluginHost.requirements` (core/src/plugin.ts:188-192), and that group
  includes `Mcp.node` (core/src/plugin/host.ts:496-503). A gated Mcp node
  depending on `Plugin.node` therefore requires itself. Dead.
- **`remove()` reloads state.** `MCP.remove` runs `overrides.set(name, false)`
  then `state.reload()` (core/src/mcp/index.ts:744-750) — the same
  reload/reconcile machinery as `add`, so the gate scope is add, connect,
  remove, and reload.

Still-valid facts for the reviewer (source-backed, design-neutral):

- **Cycle constraint.** `Plugin.node` is a location node whose only dep is
  `PluginHost.requirements` (core/src/plugin.ts:188-192), and that group
  includes `Mcp.node` (core/src/plugin/host.ts:496-503). Any gated Mcp
  composition that requires `Plugin.Service` as a layer dependency requires
  itself; the dependency must not be a composition edge.
- **Gate scope.** `MCP.remove` also runs `overrides.set(name, false)` then
  `state.reload()` (core/src/mcp/index.ts:744-750) — the same
  reload/reconcile machinery as `add`. The gate must cover add, connect,
  remove, and reload; the handlers resolve `Mcp.Service` directly with no
  activation wait (packages/server/src/handlers/mcp.ts:22-59). A disabled
  server is additionally reachable through `connect` (startServer
  unconditional), so config rewriting must include disabled servers — it does
  (sandbox-mcp.ts `sandboxServerCommand`).
- **Non-cyclic decoration exists if needed.** `ProviderNode.mapLayer`
  preserves a node's dependency wiring and service contract
  (packages/util/src/effect/layer-node.ts:94-103), so a decorator can wrap the
  service without new composition edges. Whether decoration can be made
  fail-closed without the rejected absent→proceed fallback is exactly what the
  review is deciding; any variant that resolves the activation service
  optionally and proceeds when absent is rejected and must not return.
- **Batch-deferred reconcile stays safe.** The initial config-server set
  mutates state through `transform`; its reconcile is deferred past the
  activation batch (core/src/plugin.ts:102-144, core/src/state.ts:137-152),
  which the enabled-from-initial sentinel scenario proved confines the first
  boot. The bypass is specifically the out-of-batch public paths
  (add/connect/remove/reload) racing activation, reproduced by the registered
  bypass repro below.

## 5. Test evidence (package-local; bundled `packages/kilo-cli/dist/interactive/bun` 1.4.0)

`bun run typecheck` passes; `dist/interactive/bun test test/sandbox-mcp.test.ts
test/sandbox.test.ts` passes 15 tests / 0 fail with 2 intentionally skipped
gated scenarios. (3 of the passing tests are the separator regression and the
registered bypass repro; the bypass repro is stable across repeated runs — the
supervisor's 100 ms activation debounce makes the cold-add window
deterministic, core/src/plugin/supervisor.ts:229). The earlier duplicate `State.create` + replica-editor test was
removed once the real host superseded it; the useful primitive tests stay:

1. `sandboxServerCommand` rewrites local servers, preserves argv, and leaves
   remote/disabled/empty servers unchanged.
2. Pure rewrite invariants without state machinery: the `opencode` marker is
   baked (`BUN_BE_BUN: "1"`; user values keep precedence through the transform
   spread), a command path that already references a `kilo2-sandbox-`
   directory is still wrapped — a path is not provenance — and disabled local
   servers are rewritten because a direct `mcp.connect` starts them
   unconditionally.
3. `createSandboxMcpPlugin({ enabled: false })` is inert; transform
   registration with a disabled config fails closed.
4. Primitive live test (skipIf backend unavailable): a real newline-delimited
   JSON-RPC MCP server under the launcher — `initialize` handshake,
   `tools/list` with a real input schema, `tools/call` inside-root write
   succeeds, outside-root write denied, loopback fetch denied with zero
   listener hits, startup outside-write already denied; child shutdown then
   launcher cleanup, idempotent second `dispose`.
 5. **Registered bypass repro (runs now; the P1 failure, not acceptance):**
    through the fixture-owned launch option the host registers
    `createSandboxMcpPlugin`; an immediate `client.mcp.add` on the cold
    location — before `awaitActivation` — connects the server, the exclusive
    first-boot sentinel reads `wrote` (the registered rewrite was bypassed),
    and the reviewer's control holds: the post-activation restart of the same
    path is denied (fresh pid, startup probe denied). When the activation gate
    ships, the first-boot assertion on this exact path must flip to `denied`.
 6. **Direct-connect regression (runs now):** with the policy registered
    through the fixture-owned option and the server configured `disabled`,
    a public `client.mcp.connect` after activation starts the server and the
    startup probe reads denied — the disabled rewrite holds on the
    connect-overrides-disabled path.
 7. **Skipped — blocked on the activation gate (re-enable after the gate ships
    and production registers).** Real-host scenarios through
    `launch({ sandbox })` and the public client with the production MCP client:
    - **Enabled from initial config, sentinel proof:** the fixture host config
      enables the local MCP server from the start; after activation the
      exclusive first-boot sentinel (written once by whichever boot ran first,
      recording that boot's own outside-root write attempt) reads denied, and
      the model-driven probe writes inside root — no unconfined process ran
      before or during plugin activation. Registration then went through
      `launch` and these scenarios passed; they are re-run as the gate's
      acceptance criteria.
    - **Disabled → enabled → reload:** the host configures the server
      `disabled`; `client.mcp.add` runs the production reload/reconcile
      pipeline and the server connects through the native MCP client; the
      server's startup probe proves the FIRST spawn was already confined
      (outside-root write denied before any model call); the fake model calls
      `probe_probe` (registered from the real tool registry, permission allowed
      via config) — inside-root write succeeds, outside-root write denied,
      loopback fetch denied with zero listener hits; a second `client.mcp.add`
      restarts the server (new pid, new marker) and the fresh startup probe is
      denied again. The launcher temp baseline is captured before the host
      child launches, so every launcher the host created is owned by the test:
      host shutdown with the child live stops the child (pid poll) and leaves
      zero new `kilo2-sandbox-*` directories.

Linux follow-up: extend `script/sandbox-linux-smoke.ts` with one argv-launcher
case; the Linux adapter evidence
(kilocode/baseline/sandbox-linux-validation.md) already proves the OS primitive.

## 6. Acceptance status, PTY and git — still open

- **MCP slice — rejected by review, unregistered.** Three P1-class findings
  are recorded in §4: the activation race (reproduced with the registered
  policy; fix pending the fail-closed gate), the Linux separator (fixed with a
  regression), and the disabled-server connect bypass (fixed; rewrite covers
  disabled configs with a direct-connect regression). No acceptance, no row
  credit; production registration stays off until the user-approved gate
  lands.

- **PTY — implemented, fail-closed refusal.** The seam is public, no Core or
  Protocol edit: `ProviderNode.mapLayer` (packages/util/src/effect/layer-node.ts:94-103)
  decorates `Pty.node`'s implementation while preserving its dependency wiring
  and service contract (replace precedent: workerd.ts:84; graph entry:
  core/src/instance.ts:78). `sandboxPtyRefusalReplacement(config)`
  (packages/kilo-cli/src/sandbox-pty.ts) wraps `Pty.Service.create` to fail
  before any process spawns when the sandbox is enabled, installed through
  `profile().overrides` only for `sandbox?.enabled` — a non-sandbox host keeps
  the stock service. The refusal is a defect, matching the accepted public
  contract: `Pty.Interface.create` has an empty error channel (core/src/pty.ts)
  and the `pty.create` endpoint declares no error
  (packages/protocol/src/groups/pty.ts), so the refusal surfaces as an untyped
  HTTP failure; `--sandbox` help (packages/kilo-cli/src/commands.ts) now states
  session terminals are refused while the sandbox is active. Existing sessions
  keep working (`attach`/`write`/`remove` pass through). The TUI's
  new-terminal path is user-facing and runs through the experimental persistent
  surface (packages/tui/src/context/session-terminals.tsx calls
  `experimental.persistentPty.create`), so the same seam also decorates
  `PersistentPty.node` (`sandboxPersistentPtyRefusalReplacement`,
  packages/kilo-cli/src/sandbox-pty.ts): only user-facing `create` is denied,
  through the service's declared `UnavailableError` channel, which the HTTP
  handler maps to the already-declared ServiceUnavailableError — no Protocol
  edit. Actual daemon infrastructure (bootstrap, reads, attach, input, remove,
  shutdown) stays with the inner service and is not refused; the daemon itself
  remains host-trusted, and only its user-facing terminal-create path is
  gated. v1 parity: v1's sandbox
  refused to enable while interactive terminals were live (origin/main
  packages/opencode/src/kilocode/sandbox/activation.ts:66-118); v2 decides the
  sandbox at launch before terminals exist, so the parity point is creation
  time. Evidence: `test/sandbox-pty.test.ts` (5 pass, bundled bun 1.4.0) —
  refusal guards, both decorators' create refusal (typed defect for Pty /
  declared `UnavailableError` for PersistentPty) with passthrough against mock
  services, and real isolated hosts: a stock host spawns through BOTH surfaces
  (location PTY and the persistent daemon terminal) with sentinel plus remove
  teardown, and the sandbox host refuses the location surface (untyped failure)
  and the persistent surface (declared 503) with the sentinel file absent.

- **Git — disposition recorded with source evidence.** v1's classification
  engine re-verified on `origin/main`
  (`packages/opencode/src/kilocode/sandbox/git.ts`): READONLY and MUTATING
  command sets classified **model-requested** git commands inside v1's bash
  tool; host-internal git machinery was never OS-confined in v1. v2 mapping:
  model-initiated git reaches execution only through the shell tool, which the
  accepted `shell.create.before` confinement already confines whole-command —
  stricter than v1's per-command classification and covering the same surface.
  Host-internal git spawns are `AppProcess.Service` operations (core/src/git.ts
  node :703, callers plugin/vcs/git.ts, worktree, project, formatter,
  integration) performing snapshot and worktree writes into `.git`, which the
  sandbox profile denies by design — confining them would break host
  integrity, and there is no v1 coverage to match. Disposition: out of sandbox
  scope by design, not a parity gap; provisional until root accepts it, no
  further work proposed.

## 7. Constraints honored

No Core or upstream edits, no monkeypatching or build rewrites, no
process-global interception (the Environment/`AppProcess` node-replacement
route was considered and rejected for blast radius — it would wrap daemon,
formatter, and provider spawns). The Explore shell policy and the frozen
accepted batch are untouched. Tests ran focused, package-local, on the bundled
bun; no task transitions and no commits.
