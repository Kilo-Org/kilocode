# Kilo v1 → v2 migration plan

Finalized 2026-09-30. Base: opus-55. Merged in: upstream-resync rigor, capability handshake and validation rules from deepseek; VS Code blockers, sharing/remote steps, standing rules and metrics from kimi-k3. Status: not started. First actions:
- Team sign-off on Decisions 3, 4 and 5.
- Owners assigned for the upstream-sync lane (N1/N3) and the delta sweep (N4).
- N7 aligns the progress plan and issue bodies.

Strategy: a target-shaped port on `kilo-v2`, following #13750's architecture:
- Kilo behavior lives in `kilo-*` packages and `src/kilocode/` seams.
- No `packages/opencode` and no `packages/llm`.
- `main` is never merged wholesale into `kilo-v2`.

#12887 (strangler) is not the strategy; only its ratchet idea is reused.

## Current state (verified 2026-09-29/30)

| Item | Fact |
|---|---|
| Upstream branches | `dev` (`2fa3363c`, default branch) and `v2` (`74dbc509`) are **separate lines**. They diverged at `0e2dd4ad` (2026-06-26); `v2` is 3,956 commits ahead of `dev` and 1,326 behind. |
| Upstream releases | v2 is published on npm as **`@opencode/cli`**: 2.0.0 on 2026-09-11 (23:44 UTC), `latest` = 2.0.20 (2026-09-29). v2.0.x are git tags on `v2`; **there is no GitHub Release for v2**. v1 remains upstream's default line: GitHub "Latest" and npm `opencode-ai@latest` are v1.18.33, released weekly. |
| Upstream npm scope rename | On 2026-09-07 (#47852, `a5312e16`) upstream renamed its workspace packages from **`@opencode-ai/*` to `@opencode/*`**, e.g. `@opencode/cli`, `@opencode/core`, `@opencode/client`. Some packages kept the old scope (e.g. `@opencode-ai/pty`). `kilo-v2`'s base predates the rename. |
| `main` (Kilo v1) | `.opencode-version` v1.18.26. 2,645 non-merge commits since `f7115470` (2026-08-12), where the 816-file source assessment stops. No ratchet or manifest exists. |
| `kilo-v2` | Base `59b29de4` (2026-09-03, sole parent of the first Kilo commit `047ffd045f`). At least 1,013 commits behind upstream `v2` (measured 09-28). 14 non-merge Kilo commits: 7 squashed checkpoints plus green-gate fixes (#14310); #14594 is open. **Upstream has never been merged into `kilo-v2`.** The branch was created directly on an upstream commit, and the earlier `76dbaf20`-based branch was replaced, not merged. Docs still cite pin `76dbaf20`. |
| Parity | 31/43 broad capabilities. Files: 65 ported, 137 native, 233 partial, 163 needs-port, 68 deferred, 150 not needed (of 816). No row has E2E acceptance. |
| Known reds | `kilo-vscode` `typecheck` is a skip shim (`bun script/typecheck.ts`); the real gate `typecheck:port` (`tsgo --noEmit`) fails. The VS Code preview needs Restricted Mode (key conflict). Pristine upstream is red (see `pinned-v2-baseline.md`). |
| Shared footprint | 24 marked shared source files (5 Core, 4 theme, 1 plugin, 14 TUI), plus 4 tests and 2 metadata exceptions, measured against the old base. |
| Missing on `kilo-v2` | `kilo-jetbrains`, `kilo-docs`, `kilo-web-ui`. `kilo-console` is obsolete. |
| Tracking | #13750 → 9 subissues (#14016–#14024) → 62 children (#14371–#14432). All open and unassigned. The 09-21 P-labels are P0 #14017/#14020, P1 #14016/#14021, P2 #14018/#14019/#14022, P3 #14023/#14024. |
| Progress plan | `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` on `kilo-v2`, updated 09-09 with status "Implementation paused". It conflicts with this plan; N7 aligns it. |
| Stale docs | `AGENTS.md` says the default branch is `v2`. The fork conventions name `johnnyeric/kilo-opencode-v2` and pin `76dbaf20`. |

Root problem: the port loses ground at both ends. Upstream `v2` moves by about a thousand commits every few weeks and has never been merged in. Meanwhile, `main` adds v1-only behavior that nobody has assessed since 08-12.

## Feature target and v1 assessment cutoff

The v2 product must provide:
1. upstream v2 capabilities, plus
2. all Kilo v1 behavior and patches on `main`, minus items explicitly marked post-cutover or not needed.

This is **feature** parity. Code parity is impossible because the v1 and v2 foundations are incompatible.

`main` is a moving target, so the plan tracks a **v1 assessment cutoff**: the `main` commit up to which every Kilo change has a recorded disposition (ported, native, partial, needs port, deferred, not needed). The cutoff is currently `f7115470`. Each delta sweep (N4) assesses `cutoff..origin/main` and then moves the cutoff forward. The cutoff is a bookmark for assessment, not a code target.

## Decisions

1. **v1 soft freeze is an external dependency.** The v1 team owns it on a best-effort basis; security and critical patches continue on `main`. This plan does not implement any `main`-side enforcement. It depends on `main` only through the v1 assessment cutoff and the recurring v2-owned delta sweep (N4).
2. **Upstream intake by merge.** "Merge-forward" means merging upstream `v2` release tags **into** `kilo-v2` (a merge commit on our branch). Nothing is ever pushed to or merged into `anomalyco/opencode`. `kilo-v2` is never recreated or rebased, because it is shared history.
   - One consolidation merge (N1) goes to the **latest upstream v2 release tag at execution start** (v2.0.20 as of 09-29).
   - After that, merge every upstream v2 release tag, at least weekly.
   - Pins are always release tags.
3. **Staged cutover:** G1 CLI/TUI → G2 VS Code (sidebar, tabs, Agent Manager, settings) → G3 JetBrains. Each surface has its own go/no-go. The IDEs keep bundling or pinning a v1 binary until their gate passes.
4. **Storage:**
   - Customer v2 `kilo` uses a distinct v2 data/config location: not preview `kilo2`, not the v1 `kilo` paths.
   - v1 files are never moved or rewritten while any v1 surface ships.
   - Import is opt-in, copies then migrates the copy, and is **re-runnable/idempotent**. Between G1 and G3, history is split between the v2 CLI and the v1 IDEs.
   - Paths are consolidated only after G3.
5. **Post-cutover (non-gating):** voice/STT; image generation and Claw; team sharing and incremental share sync; legacy TUI theme/binding extras. **Individual snapshot share/unshare/fork-from-share and the public viewer for v2 messages are G1 gates**, because they are v1 CLI features. Team upload stays refused until team sharing ships.
6. **Hard gates:** everything else, including FIM/next-edit (G2, G3). Cloud agents (#14023) and Anaconda Desktop (#14024) gate whichever surface they consume, so their discovery runs first.
7. **Clients:** never mix v1 and v2 routes within one session. Clients detect the backend through an explicit version/capability handshake.
8. **Gates override P-labels for surface readiness.** P-labels set the global work order; gates define what a surface needs before it ships. The G1-gating parts of #14018/#14019 are scheduled with G1 despite their P2 labels. Relabel them rather than defer them.

## Relation to prior proposals

| Topic | #12887 (strangler) | #13750 (target-shaped port) | This plan |
|---|---|---|---|
| Where v2 work happens | Extract on `main` behind V1 adapters | Port on `kilo-v2` | Same as #13750 |
| `packages/opencode` on v2 | Kept as a temporary legacy host | Not reconstructed | Same as #13750 |
| Control of `main` | Ratchets and an ownership manifest (never built) | None | External best-effort soft freeze, plus a v2-owned recurring delta sweep |
| Upstream v2 intake | Merge regularly | Pinned SHA (in practice, recreated on new tips) | Merge every release tag into `kilo-v2` |
| Cutover | Single | Single (phase 6) | Staged: G1 → G2 → G3 |
| Storage | In-place migration; rollback TBD | `kilo2` preview, later take the `kilo` paths | Separate customer v2 store until v1 retires; re-runnable copy-import |
| Scope | No cuts | JetBrains/voice deferred | Explicit post-cutover list (Decision 5) |

What changed since those proposals:
- Upstream now publishes v2 (`@opencode/cli`, 2.0.0–2.0.20) in parallel with v1.
- Upstream renamed its npm scope.
- `kilo-v2` has consumed no upstream change since 09-03.

## Execution model

- **The unit of execution is a GitHub issue.** This plan is the index: decisions, sequencing and the issue register. It changes only when a decision changes.
- **The progress plan holds live status per capability row.** After N7 aligns it, it receives only status and evidence updates. Every row links to its issue.
- **The working log records milestones only.** These are: each upstream tag merge, each N4 delta sweep, each gate go/no-go, each decision change, and notable incidents or reversals. Only the coordinator writes to it; individual agents do not. Per-change evidence goes in the PR, the issue, and that issue's progress-plan row. This keeps parallel PRs from conflicting on the single append-only log file.
- **Every issue body has these fields.** N7 adds any that are missing; the existing Outcome / Scope / Current position / Acceptance / Tracking sections stay.
  - Gate: G1, G2, G3, post-cutover, or discovery.
  - Blocked by: real GitHub issue links, not prose or draft numbers.
  - Base: whether the issue must start after N1.
  - Touches: packages and paths, so parallel agents don't edit the same files.
  - Verification commands.
  - Owner.
- **Parallel agents:**
  - Take issues whose "Blocked by" items are all closed.
  - Avoid overlapping "Touches". The TUI issues (#14375–#14379) all touch `packages/tui` and `packages/kilo-cli/src/tui-plugin`, so run them in series or split their files.

## Standing rules (every change)

- **Kilo behavior location.** Kilo behavior lives in `kilo-*` packages or `packages/<pkg>/src/kilocode/`. A shared-file patch is a last resort: marked `kilocode_change`, counted by the N2 ratchet, and justified by a stated missing seam.
- **Failures.** Compare every failing check against the baseline in `pinned-v2-baseline.md` before attributing it to a change.
- **`main` changes.** They reach v2 only through N4 dispositions (`not-applicable | already-fixed | port | defer`). Re-implement by default; cherry-pick only commits that are isolated and understood.
- **Native equivalence is verified, not inferred.** Before treating a native v2 service as covering Kilo behavior, check scope, errors, cancellation, persistence and presentation. A relocation is complete only when the consuming workflow preserves the required behavior.
- **Commit size.** Use normal PR-sized commits. No more squashed checkpoints.
- **Branches and commits.** Branch from `kilo-v2`, target `kilo-v2`, keep branch names short with no slashes, and use `type(scope): summary` commits.

## Plan

### Phase 0 — Prerequisite: create the execution issues

This must finish before any N-unit starts. Existing issues with no blockers (discovery #14425/#14426/#14429/#14430, #14415) may start in parallel.

P0. **Lift the implementation pause, after sign-off and before any implementation agent starts.** Both documents currently tell agents to stop: the working log's 2026-09-08 checkpoint says "Do not resume implementation or restart delegates without a new instruction", and the progress plan's status line says "Implementation paused". In one small docs PR to `kilo-v2`:
- add a dated milestone entry to `migration-tracking/plans/kilo-opencode-v2-working-log.md`: "Execution plan adopted (link); implementation resumes under it; supersedes the 2026-09-08 pause";
- replace the working-log header, which calls the file a "local working copy" of #13750, with a statement that it is the tracked milestone history of the migration;
- set the status line of `kilo-opencode-v2-plan-progress.md` to "Active — see execution plan". The full realignment stays in N7.

P1. **Create one GitHub issue for each of N1–N14** (see "New issues to create").
- Parent each one as a native sub-issue of #13750, or of the epic named in the table.
- Use the existing body template (Outcome / Scope / Current position / Acceptance / Dependencies / Tracking) plus the required Execution-model fields: Gate, Blocked by, Base, Touches, Verification commands, Owner.
- Copy Scope and Acceptance from this plan's step for that unit.

P2. **Link dependencies.** Record every "Blocked by" from the new-issues table and the dependency order as real GitHub issue links, both between new issues and to existing ones (e.g. N9 is blocked by N8 and #14387).

P3. **Record the numbers.** Write each created issue number into the "Issue #" column of the new-issues table, and add it to #13750's issue list. From then on, cite the GitHub number; the N-ID is an alias only.

P4. **Check completeness.** Every N-unit has an issue, a parent, a gate, and blocked-by links. No step in Phases A–G refers to work without an issue.

### Phase A — External dependency: v1 soft freeze

Owned by the v1 team, best effort, and not executed by this plan. The recommendations passed to that team:
- a policy note on `main`;
- `v2:*` disposition labels on `main` PRs;
- a growth ratchet on `packages/opencode/src/kilocode/**`;
- continued upstream v1.18.x merges.

The v2 side stays correct without them, because N4 classifies every Kilo change on `main`, labelled or not.

### Phase B — Consolidate `kilo-v2` onto upstream (first code work)

1. **N1 — Consolidation merge.** This is the first upstream merge ever into `kilo-v2`.
   1. Add the fetch-only remote `upstream` = `https://github.com/anomalyco/opencode.git` and fetch the `v2` branch and its tags. This is the same remote and fetch as the original setup (`pinned-v2-baseline.md`); only the integration method changes, from recreate to merge.
   2. Select the latest v2 release tag and record its SHA. Confirm `59b29de4` is its ancestor; if not, stop and re-plan.
   3. In a dedicated worktree, on branch `v2-upstream-sync` from `kilo-v2`, `git merge <tag>` as **one slice**. The topology changes are cross-cutting, and a partial merge leaves the tree broken.
   4. Resolve conflicts toward the v2 architecture, then re-apply Kilo invariants through owned seams. Preserve markers. Expect topology changes (e.g. `plugin-browser` arrives).
   5. **Scope-rename codemod `@opencode-ai/*` → `@opencode/*`.** Rewrite:
      - import specifiers in all Kilo-owned code (`packages/kilo-*`, `packages/*/src/kilocode/**`, `packages/schema/src/kilocode/**`);
      - `package.json` dependency names (`workspace:*`);
      - tsconfig paths;
      - scripts and docs that name packages (e.g. `@opencode-ai/core` in `AGENTS.md` and the migration-tracking notes).

      Rewrite only names that exist under `@opencode/*` at the tag; keep the packages upstream left on the old scope (e.g. `@opencode-ai/pty`). Kilo's own `@kilocode/*` names are unchanged.
   6. Run `bun run generate` in `packages/client`. Report generated and handwritten diffs separately.
   7. Run `bun migration-tracking/technical-notes/script/v2-baseline.ts --checks` on the pristine tag and on the merge result. Classify each new failure `not-applicable | already-fixed | port | defer`. Also validate the `kilo-*` packages and `bun run extension`.
   8. Re-verify every "Implemented" row in the progress plan with its focused tests, and downgrade any that regressed.
   9. Fix the docs:
      - `pinned-v2-baseline.md`, `v2-fork-conventions.md` and `PINNED_V2` in `v2-baseline.ts` record the new tag and base;
      - the pin policy becomes "release tags, merged into `kilo-v2`";
      - branch names follow `AGENTS.md`;
      - `AGENTS.md` says the default branch is `kilo-v2` for v2 work and `main` for v1.
2. **N2 — `kilo-v2` ratchet.** A Kilo-owned script (under `migration-tracking/technical-notes/script/` or `packages/kilo-cli/script/`) with exact counts of:
   - marked shared files;
   - client→Core/Server imports;
   - Kilo-package imports of upstream internals.

   The baseline is the post-N1 measurement, recorded in a new dated `marker-audit/` footprint file. Increases fail unless they state the missing seam. Then run #14381 (marker-disposition sweep) against the new base.
3. **N3 — Sync automation.** A Kilo-owned workflow that dry-run-merges each new upstream `v2.*` tag into `kilo-v2` and reports conflicts by owner, plus a real `e2e` lane for `kilo-v2`. Do not edit upstream's `test.yml`.
4. Start signing/notarization (#14411) now, because of its external lead time.

### Phase C — Re-baseline (read-only; starts now, parallel with B)

5. **N4 — `main` delta sweep (recurring).** Assess `cutoff..origin/main` over Kilo-owned and marked v1 files, and refresh `marker-audit/v1-kilo-marker-port-assessment.tsv`/`.md`. File new work under the owning epic, then advance the cutoff. Run it now, then before each gate's go/no-go.
6. **N5 — v1 reference fixtures.** Record v1 behavior at the cutoff for offline wait, overflow accounting, slow snapshot and snapshot retention, so that #14371–#14374 verify against pinned v1 behavior regardless of later upstream merges.
7. **N6 — Package decisions.** Import `kilo-docs` (needed at G1) and `kilo-jetbrains` (for G3, after N1). Assess `kilo-web-ui` as port or obsolete. Record `kilo-console` as obsolete.
8. **Discovery:** #14425 and #14426 (cloud agents) and #14429 and #14430 (Anaconda Desktop). Each one records which binary, protocol and surface it consumes, which sets the gate for #14427/#14428 and #14431/#14432.
9. **N7 — Alignment.** Align the progress plan and the issue bodies (see "Progress plan alignment" and the register).

### Phase D — G1: CLI/TUI

10. #14017 runtime: #14371–#14375, #14377, #14379, #14382. Verify against the N5 fixtures. #14378 is split: its tables and bindings are post-cutover, and alerts and sound need a G1 decision in N7.
11. **N8 — Customer v2 store identity** in the `kilo-cli` host:
    - concrete paths per Decision 4;
    - boot fails closed on v1 or OpenCode stores;
    - assert that upstream `V1Migration` does nothing on an empty store;
    - verify whether the v1 IDE and CLI currently share one DB/auth file, and if so document the split history for users.
12. #14413 import:
    - covers the DB, `auth.json` and Kilo `kilo.jsonc` keys; originals are untouched;
    - fixtures come from released v1 versions, including the cutoff;
    - a re-run imports only new sessions, never duplicating or overwriting v2-side changes (a test is required).
13. #14020 distribution: #14408, #14409, #14410, #14411, #14412. v1 and v2 CLIs install side by side.
14. #14018 sharing: #14396, #14397, #14398, #14401, and the fail-closed part of #14399.
15. #14019 remote: #14402–#14407, and the host-registration part of #14395.
16. Any #14427/#14428 or #14431/#14432 that discovery attaches to G1.
16a. **N12 — TUI picker, dialogs and status/footer**, covering progress-plan rows that have no issue:
    - model picker inline preview and section/search interaction;
    - provider-specific guidance and failure details in the provider/integration dialogs;
    - version/config guidance and onboarding in the status/footer (the presence part is #14395).

    It touches `packages/tui` and `packages/kilo-cli/src/tui-plugin`, so run it in series with #14375–#14379.
16b. **N13 — Runtime integration remainder**, covering progress-plan rows that have no issue:
    - memory durable injection indicators;
    - the remaining CLI/cloud indexing paths;
    - sandbox cross-platform release validation;
    - v1 sandbox policy variants (settings, toggle, inheritance semantics).
16c. **N11 — G1 acceptance run.**
    - Execute every G1-tagged test-plan scenario end to end, including rows already marked "Implemented, full E2E pending": Gateway auth/org/catalog, memory, indexing, sandbox, telemetry, swarm, skills/agents, config, review, headless run, ACP, updater, model info, sidebar.
    - Include external-gated verification where permitted: the deployed Gateway, and `kilo cloud` against the deployed service.
    - Record results with SHA in the progress plan.
17. **G1 go/no-go (#14414, G1 run):**
    - N11 (G1) has passed;
    - the canary operates in isolation;
    - N4 has run and its G1 items are dispositioned;
    - rollback is the v1 CLI on untouched v1 files.

### Phase E — G2: VS Code

18. #14016, in this order:
    1. #14383, the real typecheck. It comes first and depends on N1, because of the scope rename.
    2. The remaining VS Code issues: #14384–#14394, #14380 (message deletion, whose consumer is the VS Code client), and the VS Code visibility-reporting part of #14395.
    3. The Restricted Mode key conflict and desktop verification of the Stop fix, both tracked under #14384/#14387.
19. #14021: #14415 → #14416 (FIM, a hard gate; start alongside G1) and #14417.
20. **N9 — Handshake and extension switch:**
    - the capability handshake (Decision 7);
    - the extension bundles the v2 binary and uses the v2 store;
    - opt-in import on first launch;
    - verify the mapping of the v1 extension's globalState and secrets.
20a. **N14 — Original-extension consumers**, covering progress-plan rows that have no issue:
    - memory UI acceptance;
    - indexing write controls;
    - sandbox controls;
    - the telemetry capture/proxy surface.

    It sits under #14016 and touches `packages/kilo-vscode`, so coordinate it with #14386 (settings webview).
20b. **N11 — G2 acceptance run** of every G2-tagged scenario, including the permission/question UI callers and policy variants.
21. **G2 go/no-go (#14414, G2 run):** N11 (G2) has passed and N4 has run again. Rollback is the previous extension version on untouched v1 files.

### Phase F — G3: JetBrains

22. #14022: #14420 → #14421 → #14422 and #14423 (#14423 needs #14416) → #14424. Generate the client from the stable assembled OpenAPI contract, and follow the same import, handshake and rollback rules as G2.
22a. **N11 — G3 acceptance run** of every G3-tagged scenario.
23. **G3 go/no-go (#14414, G3 run)** after N11 (G3) passes.

### Phase G — v1 retirement

24. **N10:**
    - rename `main` to a `v1` maintenance branch (security fixes only, announced end of life) and promote `kilo-v2` to `main`;
    - move the v1 dirs aside with a backup and a one-time migration, then have v2 take the canonical `kilo` paths (there is no reverse migration);
    - work through the post-cutover backlog.

## Dependency order

```
Phase 0 (P1–P4: create N1–N14) ──> every N-unit below
Start after Phase 0 (no other blockers): N4, N5, N6 (kilo-docs, kilo-web-ui), N7
Start now (existing issues): #14425/#14426, #14429/#14430, #14415
N1 ──> N2 ──> #14381
N1 ──> N3
N1 ──> N6 (kilo-jetbrains import), N8, and all parity issues below
N1 + #14411 started early

G1: #14371..#14375, #14377, #14379, #14382 (need N5)
    #14396, #14397 ──> #14398 ──> #14401
    #14402 ──> #14403..#14406 ──> #14407
    N8 ──> #14413
    #14408, #14409, #14410, #14412, #14411
    N12 (after #14375..#14379, same files), N13
    all of the above ──> N11 (G1) ──> + N4 run ──> #14414 (G1)

G2: #14383 ──> #14384..#14394, #14380, N14
    #14415 ──> #14416, #14417
    N8 + #14387 ──> N9
    all ──> N11 (G2) ──> + N4 run ──> #14414 (G2)

G3: #14420 ──> #14421 ──> #14422, #14423 (needs #14416) ──> #14424 ──> N11 (G3) ──> #14414 (G3) ──> N10
```

## Issue register

Nothing in the tree is skipped. Every issue has a gate, is marked post-cutover with a reason, or gets its gate from discovery.

| Issue | Title (short) | Placement | Reason / change needed (applied by N7) |
|---|---|---|---|
| **#14017** | Runtime and CLI/TUI parity | G1 epic | |
| #14371 | Offline network wait | G1 | Verify against the N5 fixtures instead of the stale "pinned v1 revision"; drop "before upstream merges move the engine" |
| #14372 | Overflow accounting | G1 | Same as #14371 |
| #14373 | Slow-snapshot interaction | G1 | Same as #14371 |
| #14374 | Snapshot retention/concurrency | G1 | Same as #14371 |
| #14375 | TUI notifications | G1 | |
| #14376 | Legacy theme catalogue | **Post-cutover** | Decision 5 (legacy TUI extras) |
| #14377 | Session scope switching | G1 | |
| #14378 | Alerts, tables, bindings, sound | **Split** | Tables and bindings are post-cutover (Decision 5); alerts and sound get a G1 decision |
| #14379 | Location/event filtering | G1 | |
| #14380 | Message deletion | G2 | The consumer is the VS Code client |
| #14381 | Marker-disposition sweep | Phase B, after N2 | Markers change with the merge |
| #14382 | Plan-to-Code handoff regression | G1 | |
| **#14018** | Sharing | G1 epic (partly) | |
| #14396 | Share transport | G1 | |
| #14397 | Share payload contract | G1 | |
| #14398 | Public viewer for v2 messages | G1 | Decision 5 |
| #14399 | Team sharing ownership | **Split** | Fail-closed refusal gates G1; the ownership model is post-cutover |
| #14400 | Incremental sharing | **Post-cutover** | Decision 5 |
| #14401 | Deployed share contracts (external) | G1 | |
| **#14019** | Remote | G1 epic | `/remote` is a CLI feature |
| #14402–#14407 | Relay protocol, transcript, suggestions, detach/heartbeat, metadata, deployed acceptance | G1 | |
| **#14020** | Distribution and cutover | G1 epic, repeated per surface | |
| #14408 | CI/build hardening | G1 | |
| #14409 | Production payload format | G1 | |
| #14410 | Update/rollback with artifacts | G1 | |
| #14411 | Signing/notarization/hosting | G1 | Starts during Phase B |
| #14412 | Clean install | G1 | |
| #14413 | Opt-in import | G1 | Change to the customer v2 store (not `kilo2`), re-runnable/idempotent import, and cutoff fixtures |
| #14414 | Canary and runbook | G1, G2, G3 | Make it per surface; replace the draft links "#03/#04/#06" with #14410, #14411, #14413 |
| **#14016** | VS Code parity | G2 epic | |
| #14383 | Real typecheck | G2, first | Blocked by N1 (scope rename) |
| #14384–#14394 | Sidebar, tabs, settings, connection, auth, generation, terminal, Agent Manager, notifications, removal, timeline | G2 | Restricted Mode and Stop verification go under #14384/#14387 |
| #14395 | Presence registry and relay | **Split** | Host registration is G1 (with remote); VS Code visibility reporting is G2 |
| **#14021** | Editor services | G2 epic | |
| #14415 | Services inventory | G2 | Can start now |
| #14416 | FIM/next-edit | G2, G3 | Hard gate; starts alongside G1 |
| #14417 | Code actions/generation | G2 | |
| #14418 | Voice | **Post-cutover** | Decision 5 |
| #14419 | Image generation and KiloClaw | **Post-cutover** | Decision 5 |
| **#14022** | JetBrains | G3 epic | |
| #14420–#14424 | Inventory, startup/auth, sessions, terminal and editor services, IDE validation | G3 | #14423 needs #14416 |
| **#14023** | Cloud agents | Discovery | |
| #14425, #14426 | Identify and map consumers | Discovery, now | |
| #14427, #14428 | Implement and validate | Gate set by discovery | |
| **#14024** | Anaconda Desktop | Discovery | |
| #14429, #14430 | Discover and assess | Discovery, now | |
| #14431, #14432 | Adapt and validate | Gate set by discovery | |
| N1 | Consolidation merge and scope-rename codemod | Phase B | New, created in Phase 0 |
| N2 | `kilo-v2` ratchet | Phase B | New, created in Phase 0 |
| N3 | Sync automation and `e2e` lane | Phase B | New, created in Phase 0 |
| N4 | Recurring `main` delta sweep | Phase C, each gate | New, created in Phase 0 |
| N5 | v1 reference fixtures | Phase C | New, created in Phase 0 |
| N6 | Package decisions | Phase C | New, created in Phase 0 |
| N7 | Progress-plan and issue-body alignment | Phase C | New, created in Phase 0 |
| N8 | Customer v2 store identity | G1 | New, created in Phase 0 |
| N9 | Handshake and extension switch | G2 | New, created in Phase 0 |
| N10 | v1 retirement | Phase G | New, created in Phase 0 |
| N11 | Gate acceptance run (G1, G2, G3) | G1, G2, G3 | New, created in Phase 0; covers the "Implemented, E2E pending" rows |
| N12 | TUI picker, dialogs, status/footer | G1 | New, created in Phase 0; progress-plan rows that had no issue |
| N13 | Runtime integration remainder | G1 | New, created in Phase 0; progress-plan rows that had no issue |
| N14 | Original-extension consumers | G2 | New, created in Phase 0; progress-plan rows that had no issue |

New issues to create in Phase 0. They are children of #13750 unless the Unit column names another parent. Fill in "Issue #" in P3.

| ID | Issue # | Unit | Gate/Phase | Blocked by | Touches |
|---|---|---|---|---|---|
| N1 | TBD | Consolidation merge to the latest v2 tag, including the scope-rename codemod, baseline, doc fixes and re-verification | B | — | Whole repo |
| N2 | TBD | `kilo-v2` ratchet and post-merge footprint | B | N1 | `migration-tracking/`, script dir |
| N3 | TBD | Upstream-tag dry-run workflow and `e2e` lane | B | N1 | New `.github/workflows/kilo-*` files |
| N4 | TBD | Recurring `main` delta sweep from the cutoff | C, each gate | — | `marker-audit/` |
| N5 | TBD | v1 reference fixtures for #14371–#14374 | C | — | Test fixtures only |
| N6 | TBD | Package decisions: import `kilo-docs`/`kilo-jetbrains`, assess `kilo-web-ui` | C | N1 (for the imports) | `packages/kilo-docs`, `packages/kilo-jetbrains` |
| N7 | TBD | Align the progress plan and sweep the issue bodies | C | — | `plans/kilo-opencode-v2-plan-progress.md`, test plans, GitHub |
| N8 | TBD | Customer v2 store identity (under #14020) | G1 | N1 | `packages/kilo-cli` host/paths |
| N9 | TBD | Capability handshake and extension v2 store/import switch (under #14016) | G2 | N8, #14387 | `packages/kilo-vscode` |
| N10 | TBD | v1 retirement and storage consolidation | G | #14414 (G3) | Branches, `kilo-cli` paths |
| N11 | TBD | Gate acceptance run, once per surface: every gate-tagged test-plan scenario including "Implemented, E2E pending" rows, plus external-gated Gateway and `kilo cloud` verification where permitted; results with SHA | G1, G2, G3 | That gate's issues; N7 (test-plan gate tags) | Test plans, progress plan |
| N12 | TBD | TUI picker inline preview and search, provider/integration dialog guidance and failure details, status/footer guidance and onboarding (under #14017) | G1 | N1 | `packages/tui`, `packages/kilo-cli/src/tui-plugin` (in series with #14375–#14379) |
| N13 | TBD | Runtime integration remainder: memory injection indicators, CLI indexing paths, sandbox cross-platform validation and v1 policy variants (under #14017) | G1 | N1 | `packages/kilo-cli`, `packages/kilo-memory`, `packages/kilo-indexing` |
| N14 | TBD | Original-extension consumers: memory UI, indexing write controls, sandbox controls, telemetry capture/proxy (under #14016) | G2 | #14383 | `packages/kilo-vscode` (coordinate with #14386) |

## Progress plan alignment (N7 scope)

`migration-tracking/plans/kilo-opencode-v2-plan-progress.md` needs one pass. After it, it receives only status updates.
- Replace the status "Implementation paused" and the 09-09 date.
- Map the phase table (0–6, single cutover) to G1/G2/G3 plus post-cutover.
- Add `Gate` and `Issue` columns to every inventory row.
- Mark the Decision-5 rows `Post-cutover`, and record a ship/defer/drop decision for every deferred row.
- Replace "Next steps" (currently VS Code first) with this plan's G1-first order.
- Rewrite the import and canary rows for the customer v2 store, re-runnable import, and per-surface canary.
- Add rows for N1 (scope rename), N4, N8 and N9.
- Record the v1 assessment cutoff and the adopted upstream tag.
- Tag every scenario in `test-plans/kilo-opencode-v2-test-plan*.md` with G1, G2, G3 or post-cutover, so that N11 can select scenarios by gate.
- Working log: after P0, record the realignment as a milestone entry. Leave historical entries as they are, since they describe their own checkpoints.
- Verify that every progress-plan row links to an issue. Rows without an issue must reach zero; the nine found on 09-30 are covered by N11–N14.

## Validation

- **Every change:**
  - package-level `bun typecheck` (never `tsc`);
  - tests from the package directory;
  - `lint:effect-simplifications` with no new violations relative to the recorded baseline.
- **N1:**
  - merge-result failures are a subset of pristine-tag failures;
  - `bun install` resolves with the renamed scope;
  - a search finds no `@opencode-ai/` references other than packages upstream kept on the old scope;
  - `check:generated` passes in `packages/client` and `packages/www`;
  - `packages/cli` and `kilo-cli` build and pass the service smoke test;
  - `bun run extension` builds.
- **N2:** counts are at or below the recorded baseline in CI.
- **N4:** zero unclassified Kilo-owned or marked files in `cutoff..origin/main` at each gate.
- **Gates:**
  - execute the gate rows in `test-plans/kilo-opencode-v2-test-plan*.md` against an isolated real host, with external networking denied where possible;
  - record the SHA and test limits;
  - never record a local pass as E2E.
- **Import/cutover:**
  - schema diff of the v1 store (at the cutoff) against the migrator's expected tables, on real fixtures;
  - credentials and supported config keys are preserved;
  - the v1 binary still opens the original store afterwards.

## Progress metrics (reported in the progress plan at each checkpoint)

| Metric | What it tells you | How it is measured | Target | When |
|---|---|---|---|---|
| Upstream lag | How far `kilo-v2` trails upstream; growth means the sync lane stalled | Commits from `kilo-v2`'s upstream merge base to the latest upstream v2 tag | 0 after each tag merge; alarm after one missed tag | Each upstream tag |
| Unassessed `main` changes | v1 behavior whose v2 impact is unknown | Kilo-owned/marked files changed in `cutoff..origin/main` without a disposition | 0 at each gate's go/no-go | Each gate, and monthly |
| Shared-file patches | Future merge cost ("merge tax") | N2 count of marked upstream files | At or below the post-N1 baseline; every increase justified | Every PR (CI) |
| Gate readiness | How close each surface is to shipping | E2E-accepted progress-plan rows ÷ all rows for that gate | 100% before go/no-go | Weekly |
| Open work per gate | Remaining execution units | Open issues with that gate | 0 before go/no-go | Weekly |
| Source parity | Remaining v1 behavior to port | needs-port/partial counts in the assessment TSV | Decreasing; every remaining file is gated, post-cutover or not needed | After each N4 |
| Progress-plan rows without an issue | Work nobody owns | Progress-plan rows with an empty `Issue` column | 0 | Each N7/N4 pass |
| Canary health | Whether a surface is safe to widen | Crash rate, update success, import failures, v1-store access attempts (must be 0), from #14414 telemetry | Thresholds in the #14414 runbook | Daily during canary |

## Risks

| Risk | Mitigation |
|---|---|
| Skipped tag merges reopen the gap | N3 dry-run workflow plus a named sync owner |
| The scope rename breaks every Kilo import | N1 codemod, with a search check and `bun install`/typecheck validation |
| First-ever upstream merge, large and cross-cutting | Dedicated worktree, one slice, feature work held until green |
| `main` keeps changing without labels | N4 sweep runs before every gate, independent of the v1 team's labels |
| Split history between G1 and G3 | Re-runnable import (#14413); document it if v1 IDE and CLI share storage |
| Parallel agents collide | "Touches" field on every issue; the TUI issues run in series |
| Stale issue bodies mislead agents | N7 sweep of all 62 bodies |
| FIM is the largest IDE gate | Starts alongside G1 |
| Deferred-scope creep | A ship/defer/drop decision per deferred row before each gate |
| Import fixtures miss newer v1 schemas | Fixtures at the current cutoff, refreshed by each N4 |

## Open (non-blocking)

- Exact customer v2 path names (N8).
- A G1 decision on #14378's alerts and sound.
- The v1 end-of-life date after G3.
- Owners for every issue, plus the sync (N1/N3) and sweep (N4) lanes.
