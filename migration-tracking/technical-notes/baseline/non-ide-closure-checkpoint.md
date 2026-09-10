# Non-IDE closure checkpoint — 2026-09-06

## Goal 70% accepted checkpoint — 2026-09-07

The canonical plan accepts **31/43 (72.1%)** after completing safe config import,
Gateway prompt/catalog/routing, sandbox spawn policy and CLI/TUI acceptance.
Source-backed refusals do not count as implemented legacy features. Gateway
acceptance is local (72 tests / 764 assertions); terminal creation is refused
through both public paths (5 native PTY tests plus 20 shell/MCP regressions).
CLI/TUI uses the documented automated equivalents and v2 layout decisions;
manual scenario statuses remain NOT RUN. See
[CLI/TUI evidence](cli-tui-closure-verification.md) and the canonical plan for
final build `build-AbricZ`, loopback smoke and exact remaining boundaries.
The older checkpoints below remain historical; their stale open-slice counts
must not override this current acceptance. External-gated sharing, remote and
production distribution remain open.

## Goal 62% superseding checkpoint — 2026-09-07

The canonical plan now accepts **27/43 (62.8%)**, closing the Settings scopes
row after its consumer/control comparison, real enabled-project TUI
edit/reset/restart acceptance, focused contracts and independent review. See
[settings parity](settings-v2-parity.md). The config-import row remains open;
refusals and non-identical presentation mappings receive no import credit.
The earlier “no whole row meets acceptance” conclusion below is historical.
The MCP connection-scoped hook is also implemented and accepted as a slice,
with its narrow shared exception approved; the aggregate sandbox row remains
started because PTY/git coverage is not complete.

## Superseding implementation checkpoint — 2026-09-07

This audit's per-row descriptions below are historical, not a fresh list of
missing code. Since it was written, R3 status/authoritative queue translation
and root-ID cancellation have been accepted (root: 23 tests / 317 assertions,
clean typecheck/formatting). Both portable PTY paths and real launcher startup
are accepted on macOS arm64, and the Gateway local real-scopes criterion is
accepted. None alone closes a whole capability row. The canonical plan owns
the current acceptance record and pending deployment/product requirements.
CLI/TUI closure verification is the next bounded task; existing manual
scenarios remain NOT RUN unless separately exercised and recorded as such.

Read-only checkpoint audit. Provenance: this checkout at `61a8707c03` plus the
frozen accepted batch (portable launcher, persistent-PTY daemon, remote R1/R2,
R4, request policy, prompt selectors, Explore policy, PR/process sidebars,
authored policy import); Kilo v1 source `origin/main`
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`; canonical plan
`plans/kilo-opencode-v2-issue-13750.md` (local working copy). Evidence classes
are separated: accepted focused slices, the pre-final-R4 full-suite snapshot
(**501 tests / 2 skipped / 0 failures / 3,130 assertions / 86 files**), and
NOT-RUN manual scenarios. Accepted coverage stays **26/43**; nothing here
changes the count, marks a refusal as capability, or proposes a new upstream
exception. The approved shared-patch count is 7 (root-owned record); the
narrow Core MCP hook exception is **requested, not approved**.

## Does any whole row already meet canonical acceptance?

**No.** All eight rows below were re-checked against their canonical
acceptance text and current ledgers; each retains at least one still-required
capability or gate. The two closest rows are `kilo.jsonc` key mapping (every
Kilo-only key now has a source-backed disposition plus tests — closure is
root's acceptance of that disposition set) and Settings scopes (scope model
and field surface done; remaining work is the recorded field comparison plus
any still-required implementation). No row is claimed closed.

## Row 3 — Sandbox PTY / MCP / git spawn policy (`not-started`)

Accepted evidence: shell-hook OS confinement (macOS + Linux Bubblewrap,
[kilocode/baseline/sandbox-linux-validation.md](sandbox-linux-validation.md));
the MCP argv launcher and rewrite exist in Kilo-owned
`packages/kilo-cli/src/sandbox-mcp.ts` with 15 passing tests and two
deliberately skipped gated scenarios
([sandbox-spawn-next-slice](sandbox-spawn-next-slice.md) §5); production
registration is **withdrawn**.

Smallest still-required: (a) a fail-closed MCP activation gate, then
re-registration and the two gated host scenarios re-enabled and passing;
(b) an explicit PTY disposition — v1 refused to enable the sandbox while
interactive terminals were live (`ecccd1f`
`packages/opencode/src/kilocode/sandbox/activation.ts:66-118`); v2 has no PTY
seam at all (`packages/core/src/pty.ts:164-182` spawns through `#pty`
directly); (c) root acceptance of the git disposition (v1's per-command git
classification is superseded by v2's whole-shell confinement for
model-initiated git — ledger §6).

Proven existing equivalents: the argv launcher primitive
(`createSandboxArgvLauncher`), the registered bypass repro, the
direct-connect regression, and the empirically proven batch-deferred first
boot. v1's `executeMcp` never OS-confined the server process, so the
implemented confinement is stricter than v1 — the parity requirement itself is
a disposition question, not an implementation gap.

External/product gate, exact quotes: "A narrow Core MCP hook exception has
been requested, not approved." (plan); root's recorded constraint
"**fail-open is not an acceptable sandbox boundary**"; PTY: "The narrow
upstream hook candidate remains a `pty.create.before` trigger in `Pty.create`
mirroring `shell.create.before` — root decision." No local implementation can
close (a) or (b) without that decision; everything else is ready.

Specific local next implementation: none available until root rules on the
Core `beforeSpawn` callback; the prepared follow-ups are re-registering
`createSandboxMcpPlugin` in `packages/kilo-cli/src/interactive-server.ts`,
re-enabling the two skipped scenarios in `test/sandbox-mcp.test.ts`, and the
Linux argv-launcher case in `script/sandbox-linux-smoke.ts`.

## Row 2 — Session share / unshare / fork-from-share (`in-progress`)

Accepted evidence: local RPC/TUI fail-closed slice; team upload refused before
bootstrap ([remote-share-next-contracts](remote-share-next-contracts.md) §4).

Smallest still-required local capability: emit the org `kilo_meta` item from
the host's actual validated organization selection in the upload batch
(`packages/kilo-gateway/src/session.ts:195-220` emits only `session` +
`message` items today), tested against loopback ingest fixtures. The backend
half of team ownership already exists at cloud `origin/main`
(`extractNormalizedOrgIdFromItem` + `hasOrganizationAccess` refuse,
`services/session-ingest/src/ingest/metadata.ts:177-211`).

External/product gates, exact quotes from
`plans/kilo-opencode-v2-issue-13750.md` §"Session sharing — remaining
acceptance gates": gate 1 "**Cloud contract and deployment.**"; gate 2
"**Public viewer compatibility (Kilo cloud/web).**" (cloud-repo
implementation, not this worktree); gate 5 "Use an intentionally shareable
fixture against the target deployment". Interpretation note: gate 3's
remaining half is the local slice above, but "Gate 3 still closes only with
the deployed backend (gates 1/5)" — quoted from the same ledger. No
interpretation can make gates 1/2/4/5 local.

Specific local next implementation: the kilo_meta emission slice (S1) with
loopback fixtures; refuse-to-upload stays in place until deployment is proven.

## Row 6 — `/remote` (`started`)

Accepted evidence: R1 permission and R2 question translation (root
reproduced 9 tests / 211 assertions), R4 transcript translation (11 tests /
257 assertions across four remote suites, held-stream proof of early
assistant info and partial text), control adapter, RPC and TUI surfaces. The
full-suite snapshot above predates the final R4 streaming correction; a
coordinated post-R4 full run remains outstanding evidence hygiene, not a new
gate.

Smallest still-required local capability: **R3 — status, idle, queue, rename
and error events**. Every mapping is already source-proven in
[remote-share-next-contracts](remote-share-next-contracts.md) §R3:
`session.execution.*` → `session.status`/`session.idle`;
`session.inbox.*` → `session.queue.changed` via `client.session.inbox.list`;
`session.renamed` → `session.updated`; `session.execution.failed.error` →
`session.error`. Owned paths: `packages/kilo-cli/src/remote-protocol.ts`,
`src/remote-session.ts`, `test/remote-session.test.ts`. One open detail is
recorded in the ledger (whether `queued` maps to inbox item IDs or admitted
message IDs — verify `SessionInbox.Item` at implementation).

Remaining non-local or decision items, with exact quotes: deployment —
"Whether the deployed relay/ingest matches cloud `origin/main`'s
UserConnectionDO and SDK schemas — deployment verification, same class as
sharing gate 1"; suggestions — "`suggestion.shown`: no v2 producer exists
anywhere in this tree … Not implementable without inventing one" (needs root
disposition or a v1 Suggestion subsystem port decision); `exit_cli`,
hierarchical attach/detach, cloud clone ("distinct cloud authority");
aggregate inline-part bound — "still the recorded product decision".

## Row 5 evidence refresh — Gateway Auto real-scopes acceptance (2026-09-06)

Root's interpretation (recorded, not re-argued): the canonical Auto sentence —
"verify eligible catalogs and unavailable selections across real scopes, and
show a routed model only when response metadata actually supplies it" — does
not require deployment; isolated real launch hosts with personal/team
credentials against a loopback Gateway qualify as **local** scope-behavior
evidence and are never a deployed claim.

Prior evidence cited, not duplicated: picker-level personal→team catalog
replacement with fresh scoped metadata (`test/model-picker-ui-fixture.tsx`,
team header asserted on `/api/organizations/team/models`); scope-dependent
protocol transport and team→personal header drop
(`test/gateway-protocol-fixture.ts`); routedModelID recorded only from actual
response metadata for both native Auto routes, ordinary models carrying no
provider state, and no wire request under a routed response model
(`test/routed-model-integration-fixture.ts`); sidebar display gated on
`providerState` metadata (`test/routed-model.test.ts` "sidebar evaluates the
latest settled assistant").

New local evidence — Kilo-owned `packages/kilo-cli/test/gateway-scope-acceptance.test.ts`

- `test/gateway-scope-acceptance-fixture.ts` (loopback only; no shared,
  gateway, or source changes): a real launched interactive host with a fixture
  credential exercises **personal → team → personal → team(outage) → personal
  → team** with two Locations, a scope-unique Auto model per scope, and the
  picker metadata RPC. Empirically proven behaviors:

* Eligible catalogs follow the account scope in **both** locations; the
  scope-unique model of the _other_ scope is never advertised (no
  cross-Location cache bleed), and team metadata requests carry
  `x-kilocode-organizationid: team` while personal requests carry none.
* The picker metadata RPC serves only the current scope's eligible entries.
* A scope-unique Auto model executes inside its own scope with
  `routedModelID` from the actual response only (`provider/team-actual`), and
  completions carry the selected organization header.
* **Unavailable selection across scopes:** after switching away, prompting the
  durable session whose model left the catalog fails explicitly
  (`SessionRunnerModel.ModelUnavailableError`) and emits **no** Gateway
  request for the stale model — no silent stale-catalog execution.
* A switch whose target catalog cannot be served still switches the selection
  (catalog availability is not a selection authority), drains the whole
  Gateway catalog surface in both locations (no stale models advertised,
  nothing invents availability), and makes the picker metadata RPC fail
  explicitly; the eligible set returns on the next served account refresh
  while the other scope's model stays unavailable in the new scope.

Verification: bundled Bun 1.4.0 wrapper `bun test test/gateway-scope-acceptance.test.ts`
passed twice (1 pass / 0 fail); package typecheck clean for the new files
(the single diagnostic, `src/remote-session.ts:1287` TS7029 fallthrough case,
belongs to the active concurrent R3 writer's in-flight remote work — not to
this change and not to the frozen accepted batch); prettier-clean. **Boundary:** loopback fixtures only —
this is local scope-behavior evidence under root's recorded interpretation,
not deployed-catalog verification, and it does not close the Gateway row by
itself.

## Row 5 — Gateway catalog, BYOK, org routing (`in-progress`)

Accepted evidence: protocol transport + BYOK/routing
([model-loading-v2-parity](model-loading-v2-parity.md)), presentation/recommended
groups/favorites ([model-sidebar-v2-parity.md](model-sidebar-v2-parity.md)),
request policy, and the bounded prompt-selector slice for `anthropic`/`trinity`
([model-prompt-policy-v2-parity.md](model-prompt-policy-v2-parity.md), root
reproduced 2 CLI tests / 21 assertions + full Gateway 52 / 460).

Smallest still-required local capabilities: (a) recorded dispositions for the
six unported selectors — the audit already establishes
`anthropic_without_todo` → native baseline reuse, `codex` → "Port only with
explicit tool-name corrections", `gpt55`/`gemini`/`ling` → "requires a
separately reviewed v2 adaptation", `beast` → "Do not install unchanged"
([model-prompt-v2-audit.md](model-prompt-v2-audit.md) table); (b) the Auto
acceptance item: "verify eligible catalogs and unavailable selections across
real scopes, and show a routed model only when response metadata actually
supplies it" (canonical checkbox text).

External/product gate quote vs interpretation: the Auto text does **not**
explicitly require deployment; **interpretation unresolved** — isolated
real-host personal/team catalogs (loopback Gateway fixtures exercising both
scopes and an unavailable-selection path) are implementable evidence if root
accepts that reading; a deployed-catalog reading makes it a deployment gate.
The compiled-Auto packaging gate is listed separately in the plan
("Compiled Auto package loading is a separate open gate") and is not part of
this row's minimum.

Specific local next implementation: the Auto real-scopes behavior evidence
landed and was accepted (see "Row 5 evidence refresh" above), and the
root-approved Terminal Bench delta is implemented
([sidebar-bench-v2-parity.md](sidebar-bench-v2-parity.md)). What remains for
the row is the selector-disposition records in
`kilocode/baseline/model-prompt-policy-v2-parity.md` — the six unported
selectors stay real gaps (quoted above), not retirable by disposition — and
root's whole-row acceptance on the recorded evidence.

## Row 22 — CLI TUI remainder (`in-progress`)

Accepted evidence: all six v1 sidebar sections now have v2 claims — PR
([sidebar-pr-v2-parity.md](sidebar-pr-v2-parity.md), 19 tests / 46
assertions + 12 unit), running-shell processes
([sidebar-processes-v2-parity.md](sidebar-processes-v2-parity.md), 6 tests /
8 assertions), credits/Pass, session-family usage, indexing, memory; built-in
agents complete including the recorded Orchestrator decision
([agent-policy-v2-parity.md](agent-policy-v2-parity.md): "Intentionally not
resurrected") and the Explore shell ceiling ([explore-policy-v2-parity.md](explore-policy-v2-parity.md),
5 tests / 78 assertions); custom Plan workflow and Code rename are closed.

Smallest still-required local capabilities: (a) the three manual runtime
scenarios `UI-081`/`UI-082`/`UI-083` are **NOT RUN** (canonical plan
references; the runtime test plan is the vehicle); (b) recorded dispositions
for the sections v2 does not reproduce: throughput and model-benchmark
metadata — the usage ledger already records "No throughput, benchmark, or
inferred estimate is displayed because the durable RPC does not provide one",
and native `session.tps` (`packages/tui/src/config/index.tsx:162`) covers the
throughput display — (c) root acceptance of the recorded reductions (no
`description`/`ports` producer, running-only tone mapping, same-location
branch-refresh miss shared with the native footer, deferred memory Enabled
active tone behind the v1-pulse-only semantic).

Gate quote: the memory tone deferral is explicit in
[cli-remainder-next-gaps.md](cli-remainder-next-gaps.md): "it stays deferred
behind root's acceptance of the v1-pulse-only semantic". Everything else here
is local and unblocked.

Specific local next implementation: run/verify UI-081–083 from
`plans/kilo-opencode-v2-test-plan-runtime.md` with the bundled wrapper;
record the throughput/benchmark dispositions in
[kilocode/baseline/sidebar-usage-v2-parity.md](sidebar-usage-v2-parity.md).

## Row 19 — Settings scopes and remaining Kilo-only fields (`started`)

Accepted evidence: profile/project scopes with optimistic revisions, opt-in
refusal, `/kilo-settings` RPC edits, Kilo-only raw fold with null-as-invalid
([settings-v2-parity.md](settings-v2-parity.md)); request-policy bridge.

Smallest still-required capability: finish the field comparison the canonical
row text demands — "compare open settings PR before implementing" and
"additional Kilo fields remain to be compared and implemented where required"
(canonical §Settings-specific acceptance). The per-key source comparison now
exists ([config-mapping-v2-gap.md](config-mapping-v2-gap.md)); what remains is
the dialog-surface disposition per field and any still-required
implementation. Proven existing equivalents: `auto_collapse_reasoning` →
native `session.thinking` show/hide (`packages/tui/src/config/index.tsx:153`,
edited by the native `/settings` dialog); `privacy_mode` → the isolated
PrivacyStore `/privacy` surface; `indexing` → opt-in `--indexing-config`
adapter; provider lists → `experimental.policies` (imported, consumer-verified).

External/product gate, exact quote vs interpretation: the canonical
acceptance says "implemented where required" — an unsupported/obsolete
disposition is valid only for a field with no v2 consumer and no required
capability; whether any specific field (e.g. surfacing `auto_collapse_reasoning`
in the Kilo dialog beyond the native control) is "required" is root's
acceptance call, and this audit does not presume it.

Specific local next implementation: a disposition table in
[kilocode/baseline/settings-v2-parity.md](settings-v2-parity.md) covering each
remaining v1-only field with its verified consumer or gap reason (the
config-mapping audit supplies the source evidence), plus dialog/RPC notes in
`packages/kilo-cli/src/settings-rpc.ts` only where a statement is proven;
tests in `test/settings.test.ts` / `test/settings-ui.test.tsx`.

## Row 33 — `kilo.jsonc` key mapping (`started`)

Accepted evidence: authored `experimental.policies` import with
plan/readback/precedence/refusal/native-consumer tests (45 tests / 201
assertions), `privacy_mode` / `hide_prompt_training_models` carried, native
migration carries the recognized keys
([config-mapping-v2-gap.md](config-mapping-v2-gap.md)).

Smallest still-required capability: root's acceptance decision on the gap
dispositions, plus — only if root requires capability over refusal — the
implementable mappings. The gap audit's refusal table is source-backed per
key (`web_search` and the subagent-model keys have no equivalent direction;
`indexing` is documented "Not mapped per instruction"; `auto_collapse_reasoning`
has no profile-config target but a proven TUI-presentation equivalent, which
is at most a cross-surface import decision, not a config mapping).

External/product gate quote: the Phase 6 gate text "opt-in import works
including credentials and Kilo config keys" — interpretation unresolved as to
whether loud refusals with source-backed reasons satisfy "Kilo config keys"
for keys that have no v2 consumer; that reading is root's.

Specific local next implementation: none is proposed as required; if root
wants capability over refusal, the two candidate mappings are `indexing` →
the indexing adapter input schema (`packages/kilo-cli/src/indexing-input.ts`)
and `auto_collapse_reasoning` → the TUI presentation store
(`packages/kilo-cli/src/tui-config.ts`), each needing a root decision because
the current audit explicitly recorded not-mapping them. Tests:
`test/import-v1-config.test.ts` table cases per decision.

## Row 7 — Updater / update channel / packaging (`not-started`)

Accepted evidence: the bounded portable internal artifact (corrected
no-install dependency copy, relocation, safe output creation; relocated
`kilo2 serve` readiness/stop and persistent-PTY websocket round-trip
accepted; macOS arm64 only; default regression test enabled) — canonical plan
"Active continuation target" section.

Smallest still-required capability: the updater itself — v1's mechanics at
`ecccd1f packages/opencode/src/cli/upgrade.ts` (update check against a
channel, download, atomic apply) ported onto the packaged artifact identity.

External/product gates, exact quotes from the canonical plan: "publishing
releases, replacing an installed CLI, live-account writes, and new upstream
patch exceptions require their specific decisions"; the portable acceptance
is explicitly "not the separate session-terminal PTY, other-platform,
updater, release-channel or deployment acceptance". Interpretation: the
updater's mechanics (check/apply) are local-implementable, but the channel
definition and release identity are root decisions, and deployed acceptance
cannot be tested without publishing — which is excluded here.

Specific local next implementation (only if root chooses the channel model):
a Kilo-owned `packages/kilo-cli/src/update*` module checking the selected
channel and verifying signatures, with tests on loopback fixtures; no
installed-CLI replacement, no publishing.

## Provenance and discipline

- The approved shared-patch count is now **7** (root-owned record: the
  two-asset `system-prompt.ts` export). This audit proposes **no new upstream
  exception**; the requested Core MCP hook and the PTY seam remain root/user
  decisions recorded above.
- No refusal recorded in [config-mapping-v2-gap.md](config-mapping-v2-gap.md)
  is treated as capability completion; the 26/43 accepted count is unchanged
  and the 34/43 target is root's, not a claim made here.
- Evidence classes: focused accepted runs are cited with their counts; the
  501-test full-suite snapshot predates the final R4 correction; manual
  scenarios UI-081/082/083 and the runtime plan remain NOT RUN. Nothing here
  is deployed verification.
