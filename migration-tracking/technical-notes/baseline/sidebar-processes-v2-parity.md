# Running-process sidebar v2 parity

Bounded slice: the v1 `sidebar-background-processes.tsx` line (order 250,
`packages/opencode/src/kilocode/plugins/sidebar-background-processes.tsx` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`) ported to the v2 TUI as a
Kilo-owned sidebar claim scoped to the viewed session's running background
shells. Source comparison is source-backed and isolated-host-tested; no
model, network, or account surface is used.

## Surface

Local restart acceptance — 2026-09-07: the real-host fixture now covers both
client-only reopen (the same live PID remains visible) and server restart on
the same isolated store (stale durable `running` history renders no PID before
or after explicit resync). The server scenario cleans up its owned orphan
process before relaunch. The delegate reported four UI scenarios and four unit
tests passing with bundled Bun 1.4, plus package typecheck. This is automated
coverage for UI-083's restart step; no manual scenario is marked RUN.

`packages/kilo-cli/src/tui-plugin/sidebar-processes.tsx` appends to the native
`sidebar.content` slot (`packages/plugin/src/tui/context.ts:184`) and renders
one row per **running session shell** of the viewed session: the command plus
a muted `PID <pid>` line when the producer reports a real PID. The section is
hidden when nothing is running and the slot root stays mounted. The section
renders every shell this session owns whose live registry status is running —
the durable `metadata.background` flag is deliberately not a filter, because
background tool shells do not set it
(`packages/core/src/tool/plugin/shell.ts:210-214`) while session-shell mode
sets it even when the submitting client waits (`session/shell.ts:19`); the
wording matches that filter exactly.

## Producer facts (current sources, not audit assumptions)

- **Session-scoped membership is durable**: `session.shell.started/ended`
  events project into durable session message parts — `SessionMessageShell`
  (`type: "shell"`, `shellID`, `command`, `status`, `exit?`,
  `metadata.background`) via `packages/core/src/session/message-updater.ts:167-190`.
  The plugin reads them through the public typed union —
  `ctx.data.session.message.list(sessionID)` returns `SessionMessageInfo[]`
  (`packages/plugin/src/tui/context.ts:84-86`, type at
  `packages/client/src/promise/generated/types.ts:2137`), fed by the public
  `message.list` history API (`packages/client/src/solid/data.ts:1521-1541`),
  so a resumed session re-derives membership from durable truth rather than
  from live events. The helper narrows the union with `type === "shell"`
  directly — no unknown casts and no speculative malformed internal values.
- **Live status**: the plugin store exposes `ctx.data.shell.get(shellID)`
  (`context.ts:115`; the client store keeps only in-flight shells,
  `packages/client/src/solid/data.ts:92-93`). Membership is the intersection:
  a durable part renders only while its live `ShellInfo.status` is
  `"running"`. A shell that finished while the session was away, or a server
  that restarted, reports no live shell and never renders.
- **Session-scoped by durable membership (data scoping, not a security
  guarantee)**: the section renders only shells the viewed session's own
  durable history recorded; other sessions' or locations' shells are not in
  that history, so they are not members. This is a property of the durable
  producer's scoping, not a permission boundary.
- **Real fields only**: command (durable part) and `ShellInfo.pid` — a real
  spawner handle PID (`packages/core/src/shell.ts:307-309`,
  `packages/util/src/cross-spawn-spawner.ts:462`). v1's `description`,
  `PORTS`, and readiness vocabulary have no v2 producer
  (`packages/core/src/shell.ts:262-282` builds `metadata` as a free-form
  record) and are not fabricated. No full v1 supervision claim.

## Producer facts learned while building (audit corrections)

- The `shell.created` event's record predates the spawned process and carries
  **no PID** (`packages/core/src/shell.ts:406` publishes the base `info`; the
  PID lives on the registry's `Active` copy, `:307-309`). The section
  therefore invalidates and re-syncs the shell store on created events.
- `sync.run` without a prior `invalidate` is a no-op for an already-completed
  key (`packages/client/src/solid/data.ts:155-163`), so every reconciliation
  refresh pairs `invalidate` with `sync` — including the session/location
  re-key, which invalidates both the shell store and the session's message
  cache so a revisited session reconciles stale rows instead of replaying
  them.
- Shell entries publish under the server's canonical response location; the
  `exited`/`deleted` events can leave an entry under the canonical key that
  the component's raw-location read misses, so the same invalidate+sync
  refresh runs on those events too.
- `shell.timeout(id, 0)` is the backgrounding idiom — it clears the deadline
  and never kills (`packages/core/src/shell.ts:380-382`); terminating a shell
  through the public API requires a nonzero deadline (the tests use 1ms,
  which finishes the shell as `timeout` and kills the process).

## Subscription ownership

The three `data.on` refresh subscriptions are held for the section's lifetime
and released twice over: `onCleanup` disposes them on every section remount
(tab switches remount the section input), and the install-level abort signal
(disposed through `installProcessSidebar(ctx, { signal })`) disposes them
when the whole plugin tears down. No handler accumulation across remounts.

## Honest boundaries

- No `description`, `PORTS`, or readiness fields exist on v2 and none are
  rendered.
- v2 does not durably distinguish background tool shells: the bash tool's
  background path carries only `metadata.sessionID`
  (`packages/core/src/tool/plugin/shell.ts:210-214`), while the session-shell
  path sets `metadata.background: true` (`packages/core/src/session/shell.ts:19`).
  The section therefore renders **all running session shells** — which are
  exactly the long-lived/background ones while they run — and makes no
  supervision claim beyond live running state. The component's wording states
  this filter, not a background-only one.
- The resume fixture simulates revisiting through session tabs in the same
  client (the ended event is observed live, and the re-key reconciliation
  clears the cache); a true cross-process resume with a restarted server is
  covered by the join semantics — a durable running part without a live
  registry entry never renders — which is unit-tested.
- Rows render in durable history order; no v1 collapse-above-two behavior is
  reproduced.
- A session-scoped `listBySession` exists on the client store
  (`packages/client/src/solid/data.ts:1722-1725`) but is not part of the
  plugin `Data` contract, so the section joins the plugin-typed `get` with
  the session's durable parts instead of widening the plugin API.

## Production wiring

Root owns the install line in `packages/kilo-cli/src/tui-plugin/tui.tsx`
(the fixture registers the same install through a runtime-written test
plugin under an isolated `pluginDirectories` root):

```
import { installProcessSidebar } from "./sidebar-processes"
installProcessSidebar(ctx, { signal: controller.signal })
```

placed beside the other sidebar installs inside the `append: "app"` render.

## Verification

Bundled Bun 1.4.0 (`packages/kilo-cli/dist/interactive/bun`); whole-package
`tsgo` typecheck passes; owned TS files are prettier-formatted:

- `test/sidebar-processes.test.tsx` — 4 pass over the typed public producer:
  `runningShells` narrows the real `SessionMessageInfo` union (`type ===
  "shell"`, no unknown casts), joins the durable messages with the live
  `ShellInfo` registry, hides messages whose live entry is not running or is
  gone, and renders the command without a PID line when the producer reports
  none.
- `test/sidebar-processes-ui.test.tsx` — 2 real renderer scenarios
  (`test/sidebar-processes-ui-fixture.tsx` boots the real isolated host, real
  OpenCode client, real `run()` TUI with the production component installed
  through a runtime-written test plugin; the shell is a real `sleep` process
  started through the public `session.shell` API — no model, network, or
  account):
  - lifecycle: the running row renders with the real command and a real
    `PID <digits>`; re-fetching durable history keeps the row (membership is
    history-derived, not event-seeded); switching tabs to a second session
    hides the row (no cross-session leak); switching back restores it; the
    public `shell.timeout` API terminates the shell and the row and PID row
    disappear; narrow/wide resizes and `/exit` cleanup behave.
  - resume: the same durable-truth resync keeps the running row; the shell
    then completes naturally while a second session is focused, and
    revisiting the session reconciles the stale location cache — the ended
    shell stays hidden through both the live store and a fresh durable
    history fetch.
  Both fixtures assert the TUI exits 0 and print
  `TUI_PROCESSES_<SCENARIO>_OK`.

## Manual scenario recommendations for root

1. Open a session, press the shell-mode binding, run a long command (for
   example `sleep 60`), and check the sidebar row appears with the command
   and PID, then disappears when the command ends.
2. Start a long shell, switch to another session tab in a different
   repository, and confirm the row does not leak into that session's sidebar;
   switch back and confirm it returns while still running.
3. Leave a session with a running shell, quit the TUI, reopen the session:
   the row returns only while the shell is still live on the server.
4. Run a tool-spawned background command (`background: true` bash) in a
   session: the row stays visible while the command runs.
5. Narrow the terminal to the auto-hide width and back: the section hides and
   restores without extra shell API traffic.
