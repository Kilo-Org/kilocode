# CLI TUI remainder — next gaps audit

Bounded read-only acceptance audit of the CLI/TUI remainder after the completed
ports. Source comparison: Kilo v1 `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7` versus this checkout
(`kilo-v2` at `61a8707c03` plus the dirty accepted request-policy slice, which
this audit leaves untouched). No implementation, no live accounts, no paid
inference, no engine replacement, no new upstream hooks.

## Already ported — do not redo

| Surface | Status | Record |
|---|---|---|
| Code label on native `build`, Ask read-only denies, Debug evidence-led agent, `run --agent code` | Ported and tested | [agent-policy](agent-policy-v2-parity.md) |
| Plan save permission, `plan_exit` completion, save-consent prompt | Fixed and tested | [plan](plan-v2-parity.md) |
| Memory engine, capture, commands, dialog, compact sidebar row | Ported and tested | [memory](memory-v2-parity.md), [memory-ui](memory-ui-v2-parity.md), [memory-sidebar](memory-sidebar-v2-parity.md) |
| Credits/Pass footer, model picker groups/favorites, duplicate `/memory` | Ported and tested | [model-sidebar batch](model-sidebar-v2-parity.md) |
| Indexing sidebar, session-family usage sidebar | Ported and tested | [sidebar-indexing](sidebar-indexing-v2-parity.md), [sidebar-usage](sidebar-usage-v2-parity.md) |

## V1 sidebar sections still missing in v2

V1 registers six sidebar plugins at `ecccd1f`
(`packages/opencode/src/kilocode/plugins/`): `sidebar-pr` (order 50),
`sidebar-footer` (99, credits), `sidebar-usage` (150), `sidebar-indexing` (225),
`sidebar-background-processes` (250), `memory-status` (1000). V2 has the same
`sidebar.content` slot (`packages/plugin/src/tui/context.ts:184`) with footer,
usage, indexing, memory and routed-model claims installed from
`packages/kilo-cli/src/tui-plugin/tui.tsx:69-90`. PR and background processes
have no v2 claim.

### Gap 1 — Explore read-only shell ceiling (implemented)

V1 Explore is not merely "no bash". The actual v1 ceiling at `ecccd1f`
(`packages/opencode/src/kilocode/agent/index.ts`, `patchAgents` explore branch):

```
Permission.merge(
  defaults,
  fromConfig({ "*": "deny", grep, glob, list, skill, webfetch, websearch,
               semantic_search, read, board?, external_directory ask+whitelist }),
  user,
  fromConfig({ bash: exploreBash }),  // ceiling: user allows cannot widen shell
  denies(user),                       // stricter user denies survive
)
```

`exploreBash` = `readOnlyBash` plus `"gh *": "deny"` and `"find *": "deny"`
(index.ts:127-133). `readOnlyBash` (index.ts:48-125) = `"*": "deny"`, the 28
readable allows (`cat head tail less ls tree pwd echo wc which type file diff du
df date uname whoami printenv man grep rg ag sort uniq cut tr jq`), the 20
read-only git allows (`log show diff status blame rev-parse rev-list ls-files
ls-tree ls-remote shortlog describe cat-file name-rev stash-list tag -l branch
--list/-a/-r remote -v`), then defense-in-depth denies: chain and redirection
operators (`*\n*`, `*<(*`, `*|*`, `*;*`, `*&*`, `*$(*`, `` *`* ``, `*>*`), `sort`
output/compress/files0-from flags, `rg --pre`, `rg --hostname-bin`, `ag --pager`,
`man -P/--pager/-H`. (Counts verified against the pinned source; this audit
earlier wrote "27 / 11", which was inaccurate.) V1 also appends a description
suffix: "Bash is limited to an allowlist of read-only commands…" and keeps the
same upstream explore prompt the native agent already uses, so no prompt delta
exists.

V2's actual native ceiling (`packages/core/src/plugin/agent.ts:105-137`) denies
everything except grep, glob, webfetch, websearch, read (with .env asks),
subagent-deny and `external_directory` ask. **There is no `bash`/`shell` allow at
all** — every shell command is denied through the `*` deny. The prior
agent-policy decision ("existing v2 agents are not removed or rewritten") kept
this narrower agent; the user-visible delta is real: v1 Explore could run
read-only shell commands, v2 Explore cannot run any.

Producer evidence for a faithful v2 port, rule by rule:

- V2 evaluates permissions with `findLast` + `Wildcard.match`
  (`packages/core/src/permission.ts:87-91`), so append order in a post policy
  reproduces v1's merge order exactly.
- The v2 shell tool is `name = "shell"`
  (`packages/core/src/tool/plugin/shell.ts:21`) and asserts
  `action: name` with per-parsed-command `resources`
  (`shell.ts:145-147`), so v1's command patterns map to
  `{ action: "shell", resource: "<pattern>", effect }` rules unchanged.
- The `skill` action exists (`packages/core/src/skill.ts` evaluates
  `"skill"` against skill IDs); v1's `skill: allow` maps directly.
- `semantic_search` is a real v2 Kilo tool when indexing is configured
  (`packages/kilo-cli/src/indexing.ts:166-173`); v1 allowed it for Explore.
- V2 has **no `list` tool** (tool set:
  `packages/core/src/tool/plugin/`: edit, file-diff, glob, grep, opencode,
  patch, question, read, shell, skill, subagent, webfetch, websearch, write) —
  v1's `list: allow` is not-applicable. No board tools exist; v1's
  `board_read/board_post` was flag-gated and is not-applicable.

**Implemented** as a post/pre split inside `packages/kilo-cli/src/agent-policy.ts`
— no new engine, no shared Core patch, no separate command-filter module. The
audit's original step (c) ("re-append every present deny last") was rejected: it
would reinstate the native `*`/`subagent` catch-all after the allowlist and seal
all shell again, and any provenance filter is unsafe. The accepted design:

1. `createExplorePolicy()` — registered in the **default** phase, so its
   `ctx.agent.transform` folds after the native AgentPlugin and before
   ConfigAgentPlugin (supervisor pre = `[internal.pre, sdk.all(), instance.all()]`,
   post = `[internal.post, sdk.allPost()]`). It appends the verbatim `exploreBash`
   table as `action: "shell"` rules (28 readable allows, 20 git allows, `gh *` and
   `find *` denies, chain/redirection denies, exec-flag denies) plus `skill` and
   `semantic_search` allows, so the allowlist wins over the native wildcard deny.
   Because config is appended afterward, an explicit user deny (including a
   wildcard identical to the native one) wins by last-match with no re-append.
2. `createAgentPolicy()` — registered in the **post** phase, owns the
   `permission.evaluate` ceiling hook: scoped to `agent = "explore"` and
   `action = "shell"`, it forces `deny` for any resource the v1 table alone
   denies. It runs after the configured-deny short-circuit in
   `Permission.evaluateInput`, so user denies are never reordered, while a broad
   config `shell` allow cannot reopen table-denied commands (v1: user allows
   cannot make Explore's shell writable). The post plugin is host-enforced, so a
   config `plugins: ["-kilocode.agent-policy"]` remove does not disable it.
3. The description suffix is appended to the native Explore description, leaving
   a custom description unchanged (same guard as the Code rename). A configured
   Explore keeps its presentation and still receives the ceiling.
4. The v2 external_directory posture (`ask` default plus preserved allows) is
   untouched: v1's whitelisted-dirs re-application enumerates v1 global paths
   that do not exist in v2's Location model. Recorded as a deliberate v2 delta,
   not a silent drop.

Test evidence in `packages/kilo-cli/test/agent-policy.test.ts` (isolated loopback
host, bundled Bun 1.4.0, production `launch()` registering the policy itself,
loopback fake model, no live inference): the native ruleset allows `rg`/`git
log`/`git status`/`cat` and denies `git push`/`gh`/`find`/`sort
-o/--compress-program`/`rg --pre`/chain/pipe/substitution/backtick/redirect via
last-match; real host runs execute the allowed commands and deny the rest before
execution; an explicit configured `git status` deny still wins; a broad global
plus agent `shell` allow does not reopen table-denied commands; disabling the
default-phase policy via `plugins: ["-kilocode.explore-policy"]` plus a broad
allow still denies the unsafe commands through the enforced post ceiling and the
redirect writes no file, and an attempted `plugins: ["-kilocode.agent-policy"]`
disable does not remove the ceiling; a configured Explore keeps its own
description/system. Focused run: 5 tests, 0 failures, 78 assertions, clean
`tsgo --noEmit`. See [explore-policy](explore-policy-v2-parity.md).

### Gap 2 — PR sidebar section

V1 `sidebar-pr.tsx` (order 50) renders one line `PR #N - title` from
`api.state.vcs?.branch` plus `api.state.path.directory`, probing local `gh`
(5-minute `Bun.which` TTL) and matching the PR only when `headRefOid` equals the
local HEAD, with 1-second command timeouts inside a 20-second deadline. It shows
nothing without a branch, directory, `gh` binary, or matching PR, and mounts a
stable unconditional root box.

V2 producer seams, all public and verified:

- `ctx.location.vcs.info(location)` → `VcsInfo { branch: { current?, default? } }`
  (`packages/plugin/src/tui/context.ts:123-127`;
  `packages/client/src/promise/generated/types.ts:1636,427`), synced from the
  public `vcs.get` API (`packages/client/src/solid/data.ts:1238`) with a
  `vcs.branch.updated` event (`data.ts:1148`).
- `ctx.location` provides the directory; the TUI plugin process may spawn
  local `gh`/`git` exactly as v1 did (client-side plugin, no server RPC).
- The native sidebar footer already shows `directory:branch`
  (`packages/tui/src/feature-plugins/sidebar/footer.tsx:19-20`) but nothing
  renders PR info anywhere — the line is genuinely missing.

Bounded slice: new Kilo-owned `packages/kilo-cli/src/tui-plugin/sidebar-pr.tsx`
plus one install line in `tui.tsx`. Keep v1's semantics: resource key on
directory+branch, SHA-exact match, silent absence, stable root. No purchase,
network credential, or account surface involved.

Test acceptance following `packages/kilo-cli/test/sidebar-indexing-ui.test.tsx`:
real isolated host and child TUI; a fixture repository with a real commit; a
PATH-shimmed `gh` executable script (a real process, not a mock object)
returning `{"number":2,"title":"…"}` for the fixture branch — assert the
rendered `PR #2 - …` line at 160 columns; a second run without the shim on PATH
asserts a stable empty root and clean exit; assert no session message, inbox
item, or model request is created; exercise the 100→140 column auto-sidebar
restore like the indexing fixture.

### Gap 3 — Background Processes sidebar section (next in line)

V1 `sidebar-background-processes.tsx` (order 250) lists only active processes
(`starting|running|ready|stopping`) from the v1 BackgroundProcess subsystem
(`packages/opencode/src/kilocode/background-process/index.ts`), each with tone
dot, description-or-command label, command line, PID, and PORTS, collapsing
above two entries.

V2's real producer is different and thinner, and the audit refuses to fabricate
the missing fields: `ShellInfo` is `{ id, status: running|exited|timeout|killed,
command, cwd, shell, file, pid?, exit?, metadata, time }`
(`packages/client/src/promise/generated/types.ts:166`); there is **no
`description` and no `ports` field anywhere in the v2 producer**
(`packages/core/src/shell.ts:262-282` builds `metadata` as a free-form record).
Public seams: plugin `ctx.data.shell.list(location)`
(`context.ts:113-118`, synced from `api().shell.list`
in `data.ts:1240`), typed `session.shell.started`/`ended` events carrying
`sessionID` (published by the public `session.shell` path,
`packages/core/src/session/session.ts:195-224`; projected at
`packages/core/src/session/message-updater.ts:167-190`), the
`metadata.background === true` convention the client store already reads
(`data.ts:773`), and the public `shell`/`session.shell` APIs for tests. The
native composer shell-tab lists running shells
(`packages/tui/src/routes/session/composer/shell-tab.tsx:18`), so the sidebar
section is a distinct surface, not a duplicate.

Bounded slice: new Kilo-owned `packages/kilo-cli/src/tui-plugin/sidebar-processes.tsx`
rendering running session shells only (status `running`, tone success, command
truncated v1-style, PID when present), hidden when empty, session-scoped via the
typed events with a `shell.list` seed. Explicit reductions to record: no
description or PORTS lines (no producer), running-only tone mapping, session
scoping via events instead of v1's state accessor.

Test acceptance: real host and child TUI; start a real long-running shell
through the public `session.shell` API (no model work), assert the section
appears with command and PID, then after termination assert it disappears;
assert no session message or inbox work beyond the shell's own synthetic
notification path.

### Deferred — memory Enabled active tone

The compact Memory row honestly keeps `Enabled` muted because v2 has no
per-session save evidence reaching the TUI: injection is request-scoped
ephemeral context and no engine event reaches the TUI bus
([memory-sidebar](memory-sidebar-v2-parity.md) honest gaps). The smaller honest
variant would persist a `lastSave: { at, sessionID }` fact in the Kilo-owned
engine state, expose it on `MemoryRpc.status`, and pulse the existing 5-second
poll into a success tone for five seconds — Kilo-owned files only
(`packages/kilo-memory`, `packages/kilo-cli/src/memory-plugin.ts`,
`memory-rpc.ts`, `tui-plugin/sidebar-memory.tsx`), but it is a larger slice than
either gap above and touches the engine state schema, so it stays deferred
behind root's acceptance of the v1-pulse-only semantic (v1's durable
message-marker half has no v2 seam without Core changes).

## Rejected approaches

- No replacement of native sidebar/agent/permission engines; every slice
  consumes the existing public plugin transform, slot, data-store, and RPC
  seams.
- No new upstream hook and no speculative framework; each slice is one
  Kilo-owned file plus at most one registration line in an already-Kilo file.
- No shell-policy shortcut for Explore: the v1 `readOnlyBash`/`exploreBash`
  rule list is ported verbatim as permission rules; no separate command-filter
  module and no narrowed subset is invented.
- No claim that `description`, `ports`, `list`, or board tools exist on v2 —
  each was checked against the producer and is absent or not-applicable.
