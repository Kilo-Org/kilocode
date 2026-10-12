# Discovery: classification of the seeded `migration-tracking/` docs

Status: discovery output, 2026-10-11. Owner: discovery analyst (single writer). Companion files: `v2-feature-inventory.md`, `v2-epic-taxonomy.md`, `v2-unit-register.md`.

Scope: every file seeded under `migration-tracking/` on `kilo-v2-clean-bootstrap` (HEAD `a876c2912a` = BASE `5e73d5cb` + 2 documentation commits). Classification was read-only. It did not move, rename or delete any seeded file; acting on these classes is planner or coordinator work.

**Post-classification change.** This discovery phase refreshed `technical-notes/baseline/pinned-v2-baseline.md` at BASE (it was rewrite-or-drop). It is now **living**. The counts below reflect that. `v2-baseline.ts` stays rewrite-or-drop.

Classes: **living** (kept and maintained) · **evidence** (frozen factual record: cite it, don't maintain it) · **archive** (superseded, history only) · **rewrite-or-drop** (wrong or stale against the new decisions or base).

Decision numbers refer to `plans/migration-context.md` §Decisions (D1 to D10). Old docs cite "execution-plan Decision N"; that numbering is different (old D5 = new D7, old D3 = new D5, old D4 = new D6).

## 1. Counts

| Class | Files |
|---|---|
| living | 4 (`migration-context.md`, `v2-v1-schema-diffs.md`, `v2-v1-session-diffs.md`, refreshed `pinned-v2-baseline.md`) |
| evidence | 54 |
| archive | 24 |
| rewrite-or-drop | 11 (includes 2 `.DS_Store`, which should be dropped) |
| **Total** | **93** (91 content files + 2 `.DS_Store`) |

The new discovery outputs under `migration-tracking/discovery/` are discovery evidence. They stay frozen once the plan absorbs them; the plan (D9) becomes the living source.

Base facts this classification relies on:
- `git ls-tree HEAD packages/` contains **no `kilo-*` package**. The base has ai, app, cli, client, codemode, console, containers, core, desktop, effect-drizzle-sqlite, enterprise, function, gui-extensions, http-recorder, httpapi-codegen, identity, latex, merman, plugin, plugin-browser, protocol, schema, script, sdk, server, session-ui, simulation, stats, storybook, theme, tui, ui, util and web.
- The DONOR tag `879b89e8` adds `kilo-cli`, `kilo-client`, `kilo-gateway`, `kilo-i18n`, `kilo-ide-ui`, `kilo-indexing`, `kilo-memory`, `kilo-ui`, `kilo-vscode`, plus `packages/www` and `packages/updates`. There is **no `kilo-sandbox` and no `kilo-jetbrains`** even on DONOR.
- The base has no `packages/www`. Generated docs now live at `services/www`. `.github/workflows/typecheck.yml` is gone (replaced by `check.yml`, which runs `bun run check`). Package scope is `@opencode/*` (for example, `packages/cli` is `@opencode/cli`).
- `migration-tracking/` at HEAD is identical to DONOR's copy except for three files added at bootstrap: `plans/migration-context.md`, `baseline/v2-v1-schema-diffs.md` and `baseline/v2-v1-session-diffs.md` (`git diff --stat 879b89e8 HEAD -- migration-tracking`).
- 56 of the 91 content files reference `packages/kilo-cli`, which does not exist on BASE.

## 2. Material findings (cross-cutting)

1. **Assessment-snapshot SHA discrepancy (affects D4).** `marker-audit/v1-kilo-marker-port-assessment.md:9` states "Pinned v1 `d99662338e3d…`" (2026-08-10, merge #13046). `migration-context.md` and the discovery brief give the snapshot as `f7115470` (2026-08-12). `d99662338` is an ancestor of `f7115470`, 800 commits and 732 files earlier (`git rev-list --count`, `git diff --stat`). The older docs cite `f7115470` as `origin/main` at baseline time (`pinned-v2-baseline.md` Refs table). The assessment text itself names `d99662338`. Recommendation: the staleness gate should diff from `d99662338` (conservative superset), or `migration-context.md` should record both. UNVERIFIED: whether individual TSV rows were assessed at `d99662338` or later. The TSV has no SHA column.
2. **The working log contains a live-looking stop instruction.** `plans/kilo-opencode-v2-working-log.md:21-26` says "Implementation is paused… Do not resume implementation or restart delegates without a new instruction". Its header (lines 3-9) calls it the local copy of #13750 that is still being maintained. An agent reading it could obey it. It needs a superseded banner, or its move into an archive location, when the new plan lands.
3. **`technical-notes/script/v2-baseline.ts` does not run correctly on the new base** (§5). It hard-codes pin `76dbaf20`, asserts `upstream/v2 == pin`, and calls `packages/www`.
4. **`v2-fork-conventions.md` is cited by `migration-context.md` (Conventions) as a rule source but is largely stale** (§4). It conflicts with `migration-context.md` and `AGENTS.md` on branch naming (`johnnyeric/` prefix) and on the pin.
5. **`kilo2` naming tension.** `cloud-agent-contracts.md:40-47` records a cloud-owner decision (2026-10-07): ship v2 on a new npm dist-tag `next`, keep the **`kilo2` binary** for the migration, and keep `@kilocode/cli@latest` on v1. The old plans say the opposite: "Do not ship `kilo2` to customers" (working-log:567-571, original-issue-body) and the customer store is "not preview `kilo2`" (execution-plan:65). D6 says only "a separate customer v2 data store", so binary and channel naming is undecided in the canonical brief. It belongs in the plan's open questions or an escalation to the user.
6. **Gap-label collision.** `cloud-agent-contracts.md:216-355` names its gaps "G1"…"G11". These collide with gate names G1/G2/G3 (D5, D10 readability). Rename them when absorbed (for example, CA-1…CA-11).
7. **Old decision numbering is cited inside evidence.** `editor-services-inventory.md` and both cloud-agent docs cite "execution-plan Decision 5". Under the new brief that is D7. The content is consistent with D7, but the citations need a mapping note.
8. **#13750 on GitHub still points at `kilo-v2`.** The published body (`github-drafts/issue-13750/issue-body.md:3-15`) sends readers to the `kilo-v2` branch's `migration-tracking` and progress plan, and embeds screenshots by raw URL from `kilo-v2`. This is a GitHub follow-up for the user or coordinator, not a docs edit.
9. **Sharing gate drift.** `technical-notes/session-sharing.md` §Remaining gates, working-log:1786-1821, `remote-share-next-contracts.md` §4.2 and subissue 03 treat team ownership and incremental sync as completion criteria. Under D7 these are post-cutover. Individual share/unshare/fork and the public viewer remain gating (old execution-plan:69).
10. **Evidence about "v2" mostly describes donor `kilo-cli` mechanisms measured against v2 `59b29de4`.** BASE is about 1,000+ commits later (old execution-plan:23 measured 1,013 commits behind on 09-28). The staleness gate (D4) covers the V1 side only. Seam claims (for example "`ctx.session.hook("context")` exists", `sidebar.content` slot, `Mcp.SpawnHooks`) must be re-checked at BASE before reuse. Mark them UNVERIFIED at BASE.

## 3. Per-file classification

Columns: class · reason · pin/branch assumed · contradicts (decision) · facts worth preserving.

### Root, assets, plans

| Path | Class | Reason | Assumes | Contradicts | Facts worth preserving |
|---|---|---|---|---|---|
| `README.md` | rewrite-or-drop | Index describing the old structure: the execution plan is "the index", the progress plan holds status, and a "N7 alignment" is pending. It omits `migration-context.md` and `discovery/` | `kilo-v2` structure, old root `plans/` and `kilocode/` origins | D9 (plan format), D1 | The collection was copied from the root `plans/` and `kilocode/` dirs, so relative links and script paths may still be broken (lines 44-60). After rewrite it becomes **living** |
| `.DS_Store` | rewrite-or-drop (drop) | macOS junk | — | — | — |
| `technical-notes/.DS_Store` | rewrite-or-drop (drop) | macOS junk | — | — | — |
| `assets/kilo-v2-cli-2026-09-10.png` | archive | Screenshot of the donor CLI, embedded in the published #13750 body via a raw `kilo-v2` URL | `kilo-v2` | — | Donor CLI UI on 2026-09-10 (Plan session, tabs, questions, usage sidebar) |
| `assets/kilo-v2-vscode-2026-09-10.png` | archive | Same, for the donor VS Code UI | `kilo-v2` | — | Donor VS Code sidebar and Agent Manager on 2026-09-10 |
| `plans/migration-context.md` | **living** | Canonical brief (fixed rule) | BASE `5e73d5cb`, Kilo integration branch `origin/v2`, V1 `fb7e96ed`, SNAP `f7115470`, DONOR `879b89e8` | — | Needs the SNAP note from finding 1 and the `kilo2`/`next` channel question from finding 5 |
| `plans/kilo-opencode-v2-execution-plan.md` | archive | Old plan (fixed rule). Finalized 09-30, never started | `kilo-v2` on base `59b29de4`, merge release tags into `kilo-v2`, scope-rename codemod | D1 (tags as merge targets, work continues on `kilo-v2`), D2 | See §7. Its decisions 3/4/5/6/8 map to new D5/D6/D7/D7/D8 |
| `plans/kilo-opencode-v2-plan-progress.md` | archive | Old progress plan (fixed rule). Status "Implementation paused", 09-09 | `kilo-v2`, phases 0-6 with a single cutover | D5 (single cutover, VS Code-first next steps), D7 (voice, image, Claw and JetBrains rows as needs-port or deferred, not post-cutover), D6 (preview store) | 88-row capability inventory (lines 77-198) with per-row remaining scope; see §7 |
| `plans/kilo-opencode-v2-working-log.md` | evidence | Frozen dated record. It holds unique facts (user decisions, incidents, measurements, sharing gates, harness rationale) that exist nowhere else, so it is more than a superseded plan. Its headers and pause instruction are hazardous (finding 2) | `kilo-v2`, `76dbaf20` → `59b29de4`, V1 `ecccd1f`/`d99662338`, `kilo2` identity | D1/D2 (header and pause), D6 (`kilo2` and "take the kilo paths" rules, lines 558-596) | 09-08 user decision: preserve the original VS Code UI; the upstream-app wrapper was rejected (71-79). Store and rollback rules (558-596). Sharing gates (1786-1821). Self-sufficient CLI harness (1838-1889) |

### github-drafts/issue-13750 (published 2026-09-10; GitHub holds live status)

| Path | Class | Reason | Assumes | Contradicts | Facts worth preserving |
|---|---|---|---|---|---|
| `README.md` | archive | Publication review package | `kilo-v2` | — | Body plus nine subissues published 09-10; the progress comment was never published |
| `issue-body.md` | archive | Source of the live #13750 body | `kilo-v2`, `kilo2`, `packages/kilo-cli` | D1 (branch and start-here links), D5 (phase 6 single cutover), D6 (`kilo2` preview store) | Original placement model: catalog / host / plugin owners, and "from-scratch `packages/kilo-cli` because upstream `packages/cli` exports no wrap surface" (line 60). This is an open question for the clean base. 36 original capability rows |
| `original-issue-body.md` | archive | The pre-09-10 issue text | `kilo-v2` with a pinned SHA | D1, D5, D6 | "What this is not" list (lines 12-18): no `packages/opencode` host on v2, no dual-running on the same SQLite or `kilo.jsonc`, no ambient migration on startup |
| `progress-comment.md` | rewrite-or-drop | Unpublished draft checkpoint, stale | `kilo-v2` | D1 (framing) | 816 files and 6,128 markers; disposition counts 65/137/233/163/68/150 (already in the assessment) |
| `published-subissues.md` | evidence | Issue-number map | — | — | #14016 VS Code, #14017 runtime/CLI/TUI, #14018 sharing, #14019 remote, #14020 distribution/cutover, #14021 editor services, #14022 JetBrains, #14023 cloud agents, #14024 Anaconda |
| `shared-source-footprint.md` | rewrite-or-drop (drop) | Three-line pointer stub to `marker-audit/` | — | — | none |
| `tracking-policy.md` | rewrite-or-drop | Document-ownership rules built around the progress plan as capability owner and the working log as an append-only record | `kilo-v2` docs set | D9 (one plan file, A/B parts), D10 (one canonical place per fact) | The issue is the public entry point and the repo holds versioned detail. Subissue completion must update affected rows without implying adjacent ones are complete |
| `subissues/01-original-vscode.md` | archive | Draft of #14016 | donor VS Code port | — | Acceptance list: Stop/reconnect, notifications and suggestions, agent and skill removal, message deletion, presence, terminal tickets, Agent Manager/notebook |
| `subissues/02-runtime-cli-tui.md` | archive | Draft of #14017 | "pinned v1 revision" | — (D4 replaces "pinned v1 revision") | Offline wait, overflow, snapshot policy; Plan-to-Code handoff regression |
| `subissues/03-session-sharing.md` | archive | Draft of #14018 | — | **D7** (team ownership and incremental sync in acceptance) | Viewer must render self-contained v2 messages; unsupported paths stay fail-closed |
| `subissues/04-remote-sessions.md` | archive | Draft of #14019 | — | — | Relay acceptance list: transcript, attachments, suggestions, exit/interrupt |
| `subissues/05-distribution-cutover.md` | archive | Draft of #14020 | single canary | D5 (single cutover framing) | CI hardening, payload format, update/rollback, signing, clean install, opt-in import |
| `subissues/06-editor-services-clients.md` | archive | Draft of #14021 | — | **D7** (speech, image generation and Claw integration as acceptance items, line 20-21) | FIM/next-edit is the core; code actions, enhance prompt and commit generation in real UI |
| `subissues/07-jetbrains.md` | archive | Draft of #14022 | — | — | Do not assume the VS Code adapter is reusable unchanged; inventory the plugin's SDK, HTTP, event and terminal contracts |
| `subissues/08-cloud-agent-integration.md` | archive | Draft of #14023 | — | — | `kilo cloud` CLI, remote relay and Agent Manager do not establish cloud-agent compatibility |
| `subissues/09-anaconda-client-integration.md` | archive | Draft of #14024 | — | — | Discovery-first: identify the product, repo, owner and integration mode (binary, SDK/HTTP, ACP, bridge) |

### marker-audit

| Path | Class | Reason | Assumes | Contradicts | Facts worth preserving |
|---|---|---|---|---|---|
| `README.md` | evidence | Index of frozen audits. Its line "refresh the current inventory when shared changes move" is obsolete on BASE | donor | — | Kilo-owned files carry no markers; "already ported 65" is not a count of modified upstream files |
| `kilo-override-marker-inventory.md` | archive | Pre-cleanup (2026-09-08) marker search of the donor worktree, already superseded by the current inventory | donor worktree at a Johnny-local path | — | 350 redundant markers removed from 55 Kilo-owned files on 09-08 |
| `v1-kilo-marker-port-assessment.md` | evidence | The 816-file assessment (cited by the discovery brief) | V1 **`d99662338`** (line 9); v2 destinations name `packages/kilo-cli` (273×), `kilo2`, `kilocode/baseline` | — (but see finding 1) | Totals: 65 ported, 68 deferred, 137 native, 163 needs-port, 150 not-needed, 233 partial, 0 unresolved. The v2 destination column refers to donor paths; re-map to BASE |
| `v1-kilo-marker-port-assessment.tsv` | evidence | Machine-readable form (817 lines incl. header) | same; no SHA column | — | Columns: v1_file, marker_lines, occurrences, ownership, feature_purpose, disposition, v2_destination, reason, snippets |
| `v2-current-shared-change-inventory.md` | evidence | Donor's upstream-diff footprint. Shows which upstream seams the donor needed (the mechanism) | upstream ancestor `59b29de4`, reviewed `6315d9da` | — | 54 shared paths, 52 marked (24 production source, 4 tests, 22 READMEs, AGENTS.md, .gitignore), 2 unmarked (package.json, bun.lock) |
| `v2-shared-source-footprint-2026-09-10.md` | evidence | Dated measurement | `59b29de4` | — | The 24 shared production files (5 core, 4 theme, 1 plugin, 14 tui), listed at lines 5-28. This is the candidate seam list for BASE |

### technical-notes (top level and script)

| Path | Class | Reason | Assumes | Contradicts | Facts worth preserving |
|---|---|---|---|---|---|
| `v2-fork-conventions.md` | rewrite-or-drop | Cited as a convention source, but its pin, branch model and companion docs are stale (§4). It becomes **living** after rewrite | pin `76dbaf20`, branch `johnnyeric/kilo-opencode-v2`, slices `johnnyeric/v2-*` | D1 (pin and branch), AGENTS/brief naming rule; companion = progress plan (D9) | Dev-fix triage vocabulary, `virtua` patch caveat, marker rules, compact markdown tables, narrow-hook rules (§4) |
| `script/v2-baseline.ts` | rewrite-or-drop | Does not run correctly at HEAD (§5) | `PINNED_V2=76dbaf20`, `packages/www`, `typecheck.yml` mirror | D1 | Design: offline ancestry assertions, `--checks` replays CI commands, logs to gitignored `baseline/logs/`, never suppresses known reds |
| `session-sharing.md` | evidence | Cloud share contract audit, 2026-09-05 | cloud `origin/main` `08c4887f`; donor plugin | D7 if its team and incremental gates are read as gating | Contract: `POST /api/session` → `{id, ingestPath}`; share returns a purpose-bound JWT `share_token`; public read `GET /session/:shareToken`; export `{info, messages:[{info, parts}]}`. The older cloud checkout `c32be17d` returns UUID `public_id` (wrong target) |

### technical-notes/baseline (56 files)

Unless stated otherwise, "Assumes" means donor `packages/kilo-cli` (or another `kilo-*` package) on v2 `59b29de4`, compared with V1 `ecccd1f` (origin/main 2026-09-04). Each such note needs a V1 staleness check (`ecccd1f..fb7e96ed`) and a seam re-check at BASE before reuse.

| Path | Class | Reason | Assumes | Contradicts | Facts worth preserving |
|---|---|---|---|---|---|
| `agent-policy-v2-parity.md` | evidence | Donor agent-transform mechanism | `59b29de4`, `ecccd1f`, kilo-cli | — | `build` keeps its ID and displays as "Code"; Ask = read-only deny rules; Debug added; Orchestrator not resurrected; user `ask`/`debug` IDs win |
| `auto-packaging-v2-probe.md` | evidence | Measured Bun `--compile` probe | kilo-cli `dist/interactive/kilo2`, Bun 1.4.0 | — | `import.meta.resolve` of the routed plugin fails in compiled binaries. A builtins-injection `onLoad` seam worked but was rejected as fragile |
| `cli-fixture-storage-incident.md` | evidence | 2026-09-07 incident | donor fixtures | — | Running fixture entrypoints directly wrote 59 dummy credentials into the real interactive DB. Every fixture must isolate HOME and XDG itself, not rely on wrappers |
| `cli-remainder-next-gaps.md` | archive | Gap audit superseded by closure verification | `kilo-v2` `61a8707c` | — | V1 has six sidebar plugins with orders: pr 50, footer 99, usage 150, indexing 225, background-processes 250, memory-status 1000 |
| `cli-tui-closure-verification.md` | evidence | Donor acceptance evidence for the CLI/TUI remainder | `ecccd1f`, kilo-cli | — | Test counts per area, and which items were source-reviewed rather than fault-injected |
| `cloud-agent-consumers.md` | evidence | #14425 discovery (2026-10-02/07) | cloud `3de933dd`, V1 `622ed1f5`, `kilo-v2` `a2e6c1f6` | — (KiloClaw EOL agrees with D7; cites old "Decision 5") | Consumers and pins: cloud-agent-next `@kilocode/cli@7.8.1` (pinned, independent cutover); auto-routing-benchmark and the MCP-catalog CI float on `@latest`; Gastown and KiloClaw EOL. Owner = `cloud` team |
| `cloud-agent-contracts.md` | evidence | #14426 mapping (2026-10-07) | cloud `3de933dd`, V1 `62f674d4`, `kilo-v2` `78226332`, upstream `f20f5b68` | — (finding 5: `kilo2` binary vs old D4; finding 6: G-label collision) | Owner decisions 2026-10-07: `next` dist-tag, `kilo2` binary, auth import acceptable, migrate sessions using upstream's v1→v2 migrator, restore from both, no v2 consumers deployed. 11 gaps for #14427. Five open owner questions (lines 376-392) |
| `cloud-cli-v2-parity.md` | evidence | Port ledger for the `kilo cloud` client | `ecccd1f` `kilocode/cloud/` (14 files), kilo-cli | — | Byte-ported modules; env-reading origin resolvers dropped in favour of injected origins |
| `config-mapping-v2-gap.md` | evidence | Per-key v1 → v2 config mapping | `ecccd1f`, kilo-cli `import-v1-config.ts` | — | Kilo-only `kilo.jsonc` keys and their v2 destination or refusal |
| `credential-import-v2-parity.md` | evidence | Credential import rules | `ecccd1f`, kilo-cli | — | Host-local import only, with no credential writer over HTTP/RPC; OAuth `accountId` = selected org; well-known = origin+key mapping |
| `editor-services-inventory.md` | evidence | #14415 inventory (2026-10-02) | V1 `622ed1f5`, `kilo-v2` `a2e6c1f6` | — (aligned with D7; old numbering) | FIM via Gateway `/kilo/fim`; next-edit `client.kilo.edit`; the v2 snapshot has no routes and is non-functional. Speech and image producers are absent (post-cutover). KiloClaw has 0 paths on V1 and 40 stale paths on donor. JetBrains V1 consumes enhance-prompt and branch-name but not FIM |
| `existing-vscode-port.md` | evidence | Donor VS Code transplant record (09-08) | V1 `d99662338` (kilo-code 7.4.20), kilo-vscode, kilo-client | — | User requirement: the original extension UI and workflows on the v2 backend. Six webviews and two workers; type-only `ide-types.ts` closure |
| `explore-policy-v2-parity.md` | evidence | V1 Explore shell ceiling | `ecccd1f` | — | `readOnlyBash` = 28 read allows + 20 git allows + operator and flag denies; Explore adds `gh *` and `find *` denies. Counts verified |
| `extension-cleanup-audit.md` | archive | Audit against a "6 approved shared-patch files" ceiling from the vanished `plans/kilo-opencode-v2-issue-13750.md` | `59b29de4`, HEAD `82040801` | — | none beyond the shared-change inventory |
| `extension-surface-inventory.md` | evidence | VS Code surface inventory (09-05) | V1 `ecccd1f` (7.5.14) and `d99662338` (7.4.20) | Stale vs **D7**: lists KiloClaw as an "unassigned scope candidate" | Extension command and control inventory beyond the 43 rows |
| `external-resume-parity.md` | evidence | Claude/Codex import parity | `76dbaf20`, V1 `f7115470` (`e87dc77b`, `b59ebd7b`) | — | v2 import is explicit-file only; ambient `/resume-claude` and `/resume-codex` discovery and the picker are gaps |
| `goal79-scope-boundary.md` | archive | Superseded percentage-goal checkpoint | `ecccd1f` | D5 ("VS Code/JetBrains explicitly deferred") | none |
| `ide-preview-integration.md` | archive | Upstream-app wrapper prototype the user rejected (09-08) | — | — | Wrapper infrastructure (loopback verification, SecretStorage, proxy credential) was valid but is not a port |
| `indexing-v2-parity.md` | evidence | Indexing engine port boundary | `ecccd1f`, `59b29de4` | — | V1 `kilo-indexing`: 49 modules, 10 embedders, LanceDB and Qdrant, 30 tree-sitter languages; host runtime 582 lines; worker isolation |
| `memory-activity-next-slice.md` | evidence | Save-pulse slice | `ecccd1f` | — | 5-second success pulse on `memory.status`/`memory.updated` with `detail.type:"saved"` |
| `memory-sidebar-v2-parity.md` | evidence | Memory sidebar row parity | `ecccd1f` | — | Label and tone mapping; the durable-marker half has no v2 seam |
| `memory-ui-v2-parity.md` | evidence | Memory dialog parity | `ecccd1f` | — | The public dialog API has no append-to-composer operation |
| `memory-v2-parity.md` | evidence | Memory engine boundary, plus a 09-05 user smoke-test reopening | `ecccd1f` | — | Duplicate-command regression lesson: test palette and autocomplete row counts separately |
| `model-info-bench-seam.md` | evidence | Model-info panel | `ecccd1f` | — | Cached-Free rule; tier threshold `context > tier.size` |
| `model-loading-v2-parity.md` | evidence | Picker loading parity | `ecccd1f` | — | Non-actionable loading state; `BYOK` and `May train` labels; Auto group from `kilo-auto/*` |
| `model-prompt-policy-v2-parity.md` | evidence | Prompt-selector port | `ecccd1f`, `61a8707c` | — | Eight closed-enum selectors: anthropic, trinity, anthropic_without_todo, codex, gemini, ling, gpt55, beast |
| `model-prompt-v2-audit.md` | evidence | Seam analysis | `ecccd1f`, `59b29de4`/`82040801` | — | V1 selection lives at `session/system.ts:49-75`; the v2 `ctx.session.hook("context")` seam (re-verify at BASE) |
| `model-sidebar-v2-parity.md` | evidence | Model, agent and sidebar batch (its memory claim was later superseded) | `ecccd1f`, `59b29de4` | — | `TuiApp.modelPicker` presentation hook; recommendations from `preferredIndex`; personal vs team model endpoints |
| `non-ide-closure-checkpoint.md` | archive | Superseded percentage checkpoints | `61a8707c` | — | none (the 31/43 metric is dropped) |
| `non-ide-completion-audit.md` | archive | Superseded 26/43 audit | `76dbaf20`, `82040801` | — | Its classification vocabulary (reusable, delta, seamblocked, productdecision, deployedgate, ide-bound) is a possible input |
| `packaging-correction-plan.md` | evidence | As-built portable-directory packaging (09-06) | kilo-cli, `@kilocode/cli` | — | No-install closure from the resolved graph; preserves patched and trusted deps. The loopback smoke test stays `test.skip` |
| `packaging-next-slice.md` | archive | Explicitly SUPERSEDED, REJECTED AND FROZEN | kilo-cli | — | Rejection reasons (P1 `rm(outdir)` and others) as anti-patterns |
| `pinned-v2-baseline.md` | **living** (refreshed) | Was rewrite-or-drop (pin `76dbaf20`, branch `johnnyeric/v2-baseline`, contradicting D1). Discovery refreshed it to BASE `5e73d5cb` and the phase branch on 2026-10-11 (§6) | BASE, `kilo-v2-clean-bootstrap` | — | Current reds: core tests 30 (host env), `lint:effect-patterns` 27, protocol `openapi.json` stale |
| `plan-v2-parity.md` | evidence | Plan workflow parity | `ecccd1f` | — | V1 Plan = workflow (`plan_exit` requires a saved plan; follow-up offers new session, continue, or refine). The v2 builtin writes to `$HOME/.opencode/plan`, so it needs replacement, not composition |
| `reliability-checkpoint-2026-09-07.md` | evidence | Regression checkpoint | donor | — | Signed-out Gateway must disable the provider when the catalog is empty; register sidebar installers once in plugin setup |
| `remote-share-next-contracts.md` | evidence | Contract audit (09-06) | `kilo-v2` `61a8707c`, `ecccd1f`, cloud `08c4887f` | D7 if §4.2/§5 are read as gating | Relay `CLIOutboundMessageSchema` in cloud `services/session-ingest/src/types/user-connection-protocol.ts` |
| `remote-v2-parity.md` | evidence | Relay boundary | `ecccd1f` | — | `KILO_SESSION_INGEST_URL` defaults to `https://ingest.kilosessions.ai` `/api/user/cli?token=&connectionId=`; message set listed; `orgId` optional |
| `sandbox-linux-validation.md` | evidence | Linux bwrap probe (09-05) | `59b29de4` + kilo-cli | — | Debian 13, bwrap 0.12.0, image digest recorded; shell-only scope |
| `sandbox-spawn-next-slice.md` | evidence | MCP spawn confinement | `61a8707c`, kilo-cli | — | Shared edit to `core/src/mcp/index.ts` adds `Mcp.SpawnHooks.beforeSpawn` (seam candidate). PTY, remote MCP and git spawns are out of scope |
| `settings-v2-parity.md` | evidence | Settings audit | `ecccd1f`, `59b29de4` | — | V1 has no settings CLI command; HTTP `config-console` overlay API with revisions; writer semantics; 0600 mode |
| `sidebar-bench-v2-parity.md` | evidence | Terminal Bench sidebar | `ecccd1f` | — | Gateway `terminalBench {overallScore, avgAttemptCostUsd}`, tolerant decode |
| `sidebar-indexing-v2-parity.md` | evidence | Indexing sidebar | donor | — | Disabled, loading and unavailable states are distinct; consent-off means no engine init |
| `sidebar-pr-v2-parity.md` | evidence | PR sidebar | `ecccd1f` | — | `gh` lookup chain reproduced verbatim (view → list by SHA → fork parent) |
| `sidebar-processes-v2-parity.md` | evidence | Process sidebar | `ecccd1f` | — | Stale durable `running` must not show a PID after a server restart |
| `sidebar-usage-v2-parity.md` | evidence | Usage sidebar | donor | — | Cache rate = `read/(input+read+write)`; forks are not family children |
| `skill-shell-parity.md` | evidence | Trusted skill `!` shell | `ecccd1f` | — | Trust only for global or builtin provenance; project skills untrusted |
| `skills-v2-parity.md` | evidence | Skills and project config | `59b29de4`, `76dbaf20` | — | Opt-in `.kilo/` and `.kilocode/` walking; project plugins are reported, not loaded |
| `startup-loading-v2.md` | evidence | Startup optimization | donor, `kilo2` | — | 60-second identity-hashed catalog snapshot; TUI renders before Gateway activation |
| `swarm-v2-parity.md` | evidence | Swarm board | `ecccd1f` | — | Default-off; board keyed by root session; `main` and `ALL` recipients only |
| `telemetry-v2-overlap.md` | evidence | Telemetry audit | `59b29de4` | — | V1 PostHog on by default; upstream dropped PostHog for OTLP. Donor uses an opt-in allowlisted OTLP exporter (a privacy decision) |
| `updater-local-parity.md` | evidence | Local directory updater | kilo-cli, `kilo2` | — | Manifest contract (tree sha256, size, format); archives unsupported. BASE now has `services/update` (UNVERIFIED overlap) |
| `v1-fixture-generation.md` | evidence | V1 writer fixture | V1 `d99662338`, `ecccd1f` | — | Fixture built through V1 writer methods, not SQL; Effect versions recorded |
| `v1-session-schema-audit.md` | evidence | Store schema diff | V1 `d99662338`/`1536aef0`/`ecccd1f`; v2 `59b29de4` | — | Copy-then-migrate is **not proven lossless**. Re-run against V1 `fb7e96ed` and BASE: BASE adds migration `20260910120000_clear_v1_session_permission.ts` |
| `v2-v1-schema-diffs.md` | **living** | Reference explainer for client tracks, named in `migration-context.md`. Spot-check at BASE: the generated `types.ts` path and the 10 message kinds still hold | "v2 on `kilo-v2`" (re-point to BASE) | — | v1 `{info, parts[]}` vs v2 self-contained typed messages; 10 kinds |
| `v2-v1-session-diffs.md` | **living** | Same; named in the brief | "on `kilo-v2`" (re-point to BASE) | — | Event-sourced sessions, inbox and steer vs v1 FIFO queue |
| `vscode-packaging.md` | evidence | VSIX packaging | kilo-vscode | — | `vsce package --no-dependencies`; sanitizes `workspace:*` |

### test-plans

| Path | Class | Reason | Assumes | Contradicts | Facts worth preserving |
|---|---|---|---|---|---|
| `kilo-opencode-v2-test-plan.md` | rewrite-or-drop | Index linking to a non-existent `kilo-opencode-v2-issue-13750.md`; runs from `packages/kilo-cli` with `kilo2` | kilo-cli, `kilo2` | D5 (IDE deferred, no gate tags) | 164 scenarios (UI-001 to UI-083, RT-001 to RT-081); stable IDs for reporting; "an authored case is not validation" |
| `kilo-opencode-v2-test-plan-runtime.md` | rewrite-or-drop | Expected text is "quoted from current source", meaning donor source at `82040801`, not V1 | HEAD `82040801` plus uncommitted changes; kilo-cli (32×) | **D3** (behavior from donor, not V1), D5 | RT IDs and safety labels (FIXTURE, USER-OPT-IN, PENDING-VERIFICATION); permissions, persistence, import, isolation and sandbox scenario topics |
| `kilo-opencode-v2-test-plan-ui.md` | rewrite-or-drop | Same; links point at kilo-cli tests (80×) | kilo-cli | **D3**, D5 | UI IDs grouped into 14 sections (startup and branding through sidebar truthfulness); all NOT RUN |

## 4. `technical-notes/v2-fork-conventions.md`: does it still apply on the clean base?

| Rule (line) | Status on BASE | Note |
|---|---|---|
| Pinned upstream SHA `76dbaf20` (12-14) | **Wrong** | BASE is `5e73d5cb` (D1). `76dbaf20` is an ancestor of HEAD, but it is not the base |
| Never treat latest `upstream/v2` as the base; record the validated SHA (15-16) | Applies | Matches D1 ("pinned by SHA each time") |
| Adopting a snapshot: fetch, record SHA and merge base, merge, re-run the baseline, diff failures (17-20) | Applies | Point at the refreshed baseline doc |
| Stop if a recorded SHA becomes unreachable; never force-push (21-23) | Applies | |
| `upstream/dev` is a sibling, diverged at `0e2dd4ad` (24-25) | Applies (fact) | |
| `virtua@0.49.1` patch caveat (27-34) | **Stale / UNVERIFIED** | BASE root `package.json` has no `virtua`, and `patches/` has no virtua patch. The rule only matters once `kilo-vscode` or `kilo-ide-ui` are re-landed. Keep it as a note for G2 |
| Integration branch `johnnyeric/kilo-opencode-v2`, slices `johnnyeric/v2-*` (38-44) | **Wrong** | Integration branch is Kilo's `origin/v2`. Branch names must be short and hyphenated with no slashes (AGENTS.md, migration-context Conventions) |
| Merge forward, never rebase the integration branch (46-48) | Applies | Matches D1 and the coordinator rules |
| `johnnyeric/` prefix overrides upstream naming (49-53) | **Wrong** | Contradicts AGENTS.md and the brief. The `type(scope): summary` part still applies |
| Dev-fix triage lane `not-applicable/already-fixed/port/defer` (55-67) | Applies (concept) | It should track the V1 delta under the staleness gate (D4) as well as `upstream/dev`. "Parity ledger dev-line lane" no longer exists, so name the new home |
| Kilo-owned paths table (69-79) | Partly | `packages/<pkg>/src/kilocode/` and `test/kilocode/` apply. The `plans/` row is moot (no root `plans/` at BASE). `migration-tracking/technical-notes/` applies. Missing: `kilo-*` packages (migration-context Conventions lists them) |
| Do not fork or rename upstream packages; do not reconstruct `packages/opencode` (81-82) | Applies | |
| Compact markdown tables; do not run prettier on Kilo docs (84-113) | Applies | BASE `.prettierignore` still lists only four generated paths (`sst-env.d.ts`, `packages/desktop/src/bindings.ts`, `packages/client/src/generated/`, `packages/client/src/generated-effect/`), so markdown is not excluded |
| Shared root `AGENTS.md` pointer hook (115-118) | **Not present on BASE** | `AGENTS.md` at HEAD is upstream's, with no Kilo pointer (migration-context notes it). The rule still describes the intended hook |
| Narrow shared hooks, dependency direction, never hand-edit generated output (120-134) | Applies, path fix needed | Generated paths: `packages/client/src/generated*` is fine. `packages/www/openapi.json` does not exist (now `services/www`). `packages/protocol` has its own `generate` / `check:generated` |
| `kilocode_change` marker rules (136-150) | Applies | Matches the brief |
| Validation commands (152-168) | **Partly stale** | `packages/www` → `services/www`. CI now runs `bun run check` (lint + typecheck) and `lint:effect-simplifications`. `do-not-run-tests-from-root` is still true (`bunfig.toml:8`). `bun typecheck` is still `bun turbo typecheck --concurrency=3` |
| Companion docs (3-5) | **Wrong** | Points to the progress plan (archived) and the old pinned baseline |

Verdict: the rules on substance (snapshot tracking, merge-forward, triage vocabulary, Kilo-owned placement, narrow hooks, markers, tables) still apply. The concrete refs, branch model, paths and companion links are wrong. Rewrite it, then make it **living**; `migration-context.md` already points to it.

## 5. `technical-notes/script/v2-baseline.ts`: does it run on BASE?

It was read, not run. Findings:

- `ROOT = path.resolve(import.meta.dir, "../../..")` resolves to the repo root from `migration-tracking/technical-notes/script/`. Correct.
- `PINNED_V2 = "76dbaf20…"` (line 11). The ancestry assertion `merge-base --is-ancestor 76dbaf20 HEAD` would **pass** (verified: `76dbaf20` is an ancestor of HEAD). That passes for the wrong reason: it checks an obsolete pin, not BASE.
- The required assertion `rev("upstream/v2") === PINNED_V2` (lines 48-51) **fails**: local `upstream/v2` = `d2905b8d…`. The script then prints "baseline ancestry broken; refusing to run checks" and exits 1. **As written it does not run on the new base.** It also assumes that `upstream/v2` is never fetched past the pin, which contradicts merging the moving `upstream/v2` branch (D1).
- The `rev()` loop over `origin/main`, `upstream/dev` and `upstream/v2` is offline. If a ref is missing, it prints an empty value. Harmless.
- CHECKS, path by path at HEAD:
  - `install`, `typecheck` (root `typecheck` script exists: `bun turbo typecheck --concurrency=3`): OK.
  - `test` (`bun turbo test --continue`, `GITHUB_ACTIONS=false`): OK. CI now adds `--concurrency=3` and `--affected`.
  - `client-check-generated` (`packages/client` has `check:generated`): OK.
  - `www-check-generated` with cwd `packages/www`: **broken**. `packages/www` does not exist at HEAD; it moved to `services/www`, which has `check:generated`.
  - `cli-build` (`packages/cli/script/build.ts --single --skip-install`; both flags exist at lines 26/29): OK.
  - `cli-service-smoke` (`packages/cli/script/service-smoke.ts` exists): OK.
- Missing relative to current CI (`.github/workflows/test.yml`, `check.yml`): `bun run check` (lint + typecheck), `lint:effect-simplifications` and its rule test, `packages/protocol` `check:generated`, Node build plus `service-smoke --node`, codemode publish dry-run, and SDK `verify:package`. The comment's reference to `typecheck.yml` is stale (the file is gone).
- Rewrite needs: set the pin to BASE `5e73d5cb`. Drop the "upstream/v2 equals pin" assertion, or replace it with "pin is an ancestor of `upstream/v2`" plus "HEAD contains pin". Fix `services/www`. Re-mirror `test.yml` and `check.yml`. The logs dir (`baseline/logs/`) stays gitignored via the root `.gitignore:36` `logs/` rule.

## 6. `technical-notes/baseline/pinned-v2-baseline.md` (refreshed by this phase; pre-refresh state below)

- **Current pin:** `upstream/v2` = `76dbaf20adbd43fd208a00ef3cda4a51e125a234` (2026-08-12, `fix(catalog): serve app shell at lab route (#42159)`). Also recorded: `upstream/dev` `14b37df3`, `origin/main` `f7115470`. Captured 2026-08-13.
- **Branch:** produced on `johnnyeric/v2-baseline`; integration branch named `johnnyeric/kilo-opencode-v2` (no remote at the time). It says it is "Phase 0 baseline for `plans/kilo-opencode-v2-issue-13750.md`" (that file is absent).
- **Reproducer path:** `bun kilocode/script/v2-baseline.ts` (old root `kilocode/` path; now `migration-tracking/technical-notes/script/`).
- **Sections:**
  1. Refs (line 15): table of ref, SHA, date, subject.
  2. Merge bases and ancestry (30): `0e2dd4ad` is the dev/v2/main divergence point; commits-ahead counts (dev 899, v2 1470, main 3391 as of 08-13); ancestry command output.
  3. Toolchain (76): bun 1.3.14, node 22, git, OS; CI runners; ffmpeg.
  4. Authoritative v2 commands (89): table of purpose, command and dir, plus constraints (do-not-run-tests-from-root, `bun typecheck` only, husky pre-push, e2e skipped on v2, lint not CI-run).
  5. Results on pristine upstream v2 (122): pass/fail per check (typecheck 34/34 pass; turbo test 20/23 with `--continue`; lint 4232 warnings and 1 error; `lint:effect-patterns` 33 errors).
  6. Pre-existing failures (140), with subsections: also red on upstream CI (145) (`opencode-drive` JSON parse; tui footer `Café`); host-environment failures (170) (`pa-PK` ICU; ffmpeg missing); not gated by CI (194).
  7. Why no fork CI workflow yet (206).
  8. Reproducer (229).
- **Refresh needs:** BASE `5e73d5cb` and the tag `v2.0.26` marker. Kilo integration branch `origin/v2`. Current CI commands (`check.yml` `bun run check`; `test.yml` with `--affected --concurrency=3`, effect-simplifications, Node 26.4.0 build, `services/www`). Current `packageManager` bun version (UNVERIFIED; not read). New failure inventory. Package names under the `@opencode/*` scope. Bootstrap status in `migration-context.md` lists "Baseline health recorded" as recommended next.

## 7. Facts worth preserving from the old plans (for the new plan's facts appendix)

### `plans/kilo-opencode-v2-execution-plan.md`

| Line | Fact |
|---|---|
| 19 | Upstream `dev` (`2fa3363c`, default branch) and `v2` (`74dbc509`) are separate lines, diverged at `0e2dd4ad` (2026-06-26); v2 was 3,956 ahead and 1,326 behind dev (09-29/30) |
| 20 | Upstream v2 publishes on npm as `@opencode/cli`: 2.0.0 on 2026-09-11, `latest` 2.0.20 on 09-29. v2.0.x are git tags; there is no GitHub Release for v2. Upstream v1 (`opencode-ai@latest` v1.18.33) ships weekly |
| 21 | Scope rename `@opencode-ai/*` → `@opencode/*` on 2026-09-07 (#47852, `a5312e16`); some packages kept the old scope (for example `@opencode-ai/pty`) |
| 22 | V1 `main`: `.opencode-version` v1.18.26; 2,645 non-merge commits since `f7115470` (as of 09-29); no ratchet or manifest exists |
| 23 | Old `kilo-v2` base `59b29de4` (2026-09-03); first Kilo commit `047ffd045f`; at least 1,013 commits behind upstream on 09-28; 14 non-merge Kilo commits (7 squashed checkpoints); upstream never merged in; the earlier `76dbaf20` branch was replaced, not merged |
| 25 | Known reds: `kilo-vscode` `typecheck` is a skip shim (`bun script/typecheck.ts`); the real gate `typecheck:port` (`tsgo --noEmit`) fails; the VS Code preview needs Restricted Mode (key conflict) |
| 26 | Shared footprint: 24 marked shared source files (5 core, 4 theme, 1 plugin, 14 tui) + 4 tests + 2 metadata exceptions |
| 27 | Missing on the old port: `kilo-jetbrains`, `kilo-docs`, `kilo-web-ui`; `kilo-console` obsolete |
| 28 | Tracking: #13750 → 9 subissues (#14016–#14024) → 62 children (#14371–#14432), all open and unassigned. P-labels set 09-21: P0 #14017/#14020, P1 #14016/#14021, P2 #14018/#14019/#14022, P3 #14023/#14024 |
| 30 | Stale docs: `AGENTS.md` default-branch text; fork conventions name `johnnyeric/kilo-opencode-v2` and pin `76dbaf20` (still true at HEAD) |
| 32 | Root problem: upstream moves about 1,000 commits every few weeks, and `main` adds unassessed v1 behavior |
| 36-42 | Feature target = upstream v2 capabilities + all V1 Kilo behavior minus post-cutover or not-needed items (feature parity, not code parity). The "v1 assessment cutoff" bookmark concept advances per delta sweep |
| 46 | v1 soft freeze is an external, best-effort dependency owned by the v1 team; security and critical fixes continue on `main` |
| 57-61 | Client-track items that touch core/server/protocol: #14380 message deletion, N9 server-side handshake, #14416 FIM/next-edit producer, #14391 Agent Manager control plane |
| 65-68 | Customer v2 store distinct from preview `kilo2` and from v1 `kilo` paths. Import copies then migrates the copy and is re-runnable/idempotent. History is split between v2 CLI and v1 IDEs from G1 to G3 |
| 69 | KiloClaw is not needed: already removed from the client on `main`. **Individual snapshot share/unshare/fork-from-share and the public viewer for v2 messages are G1 gates** (v1 CLI features). Team upload stays refused |
| 70 | Cloud agents (#14023) and Anaconda (#14024) gate whichever surface they consume; their discovery runs first |
| 71 | Never mix v1 and v2 routes in one session; explicit version/capability handshake |
| 118 | `main` changes reach v2 via dispositions `not-applicable / already-fixed / port / defer`; re-implement by default |
| 119 | Native equivalence is verified on scope, errors, cancellation, persistence and presentation (now in the discovery brief) |
| 194 | Start signing/notarization (#14411) early because of external lead time |
| 210 | V1 reference fixtures needed for offline wait, overflow accounting, slow snapshot, snapshot retention (#14371–#14374) |
| 222-227 | Store-identity checks: boot fails closed on v1 or OpenCode stores; upstream `V1Migration` must be a no-op on an empty store; verify whether the v1 IDE and CLI share one DB/auth file; verify that v1 IDEs can never resolve the customer v2 `kilo` binary (VS Code does not pin a CLI) |
| 229-231 | Import covers DB + `auth.json` + Kilo `kilo.jsonc` keys; fixtures from released v1 versions; a re-run imports only new sessions (test required) |
| 233-238 | Preview release train before G1 so G1 is not the first v2 release |
| 266-268 | G2 order: real typecheck (#14383) first; Restricted Mode conflict and Stop desktop verification under #14384/#14387 |
| 282-284 | The test plans contain no IDE scenarios; G2 and G3 scenario sets must be written |
| 291 | JetBrains: generate its client from the stable assembled OpenAPI contract |
| 349-382 | Register dispositions: #14376 legacy theme post-cutover; #14378 split (tables and bindings post-cutover; alerts and sound need a G1 decision); #14380 G2; #14395 split (host registration G1, VS Code visibility G2); #14399 split (fail-closed G1, ownership post-cutover); #14400 post-cutover; #14416 G2+G3 hard gate; #14418 post-cutover; #14419 split (image post-cutover, KiloClaw not needed) |
| 448-470 | Validation: `lint:effect-simplifications` with no new violations; import validated by a v1 store schema diff on real fixtures, and the v1 binary still opens its original store afterwards |
| 474-483 | Metric definitions (upstream lag, unassessed `main` changes, shared-file patches, gate readiness, open work per gate, source parity, rows without an issue, canary health) |
| 485-501 | Risks (still relevant): split history; v1 IDE picking up the v2 binary; first-release risk; FIM is the largest IDE gate; import fixtures missing newer v1 schemas |
| 505-508 | Open: exact customer v2 path names; G1 decision on #14378 alerts and sound; v1 end-of-life date; owners for every lane (all unassigned) |

### `plans/kilo-opencode-v2-plan-progress.md`

| Line | Fact |
|---|---|
| 11 | Historical 31/43 (72.1%) broad capabilities accepted; not an effort estimate |
| 13, 204-214 | 816 files / 6,128 annotations; dispositions 65/137/233/163/68/150 |
| 15, 222 | Original extension builds via `bun run extension`; the full extension typecheck fails, so the `typecheck` script skips and `typecheck:port` keeps the real check; desktop verification of the Stop fix is unrun |
| 27-36 | Donor placement map (Gateway → `kilo-gateway`, host → `kilo-cli`, engines → `kilo-*`, VS Code → `kilo-vscode` + webview-ui/`kilo-ui`/`kilo-ide-ui`/`kilo-i18n`, RPC → `packages/schema/src/kilocode`). This is mechanism (D3) |
| 46-48 | Unsupported config values are refused, not silently dropped; settings writes use profile/project scope plus revision checks; refresh keeps sessions and PTYs |
| 77-198 | 88-row inventory with remaining scope per row. It is the best checklist seed for the Part B epics. Rows marked Needs port: offline wait, message deletion, session scope switching, multiline alerts/tables, legacy bindings/sound, public viewer, incremental sharing, notifications/suggestions, agent/skill removal, FIM/next-edit, image/Claw |
| 202 | Native retry does not implement offline-wait interaction; native snapshot does not supply the slow-snapshot question |
| 226 | `packages/kilo-cli` harness: interactive proofs skip without `dist/interactive`; `test:interactive` after `build:tui` (09-24) |

### `plans/kilo-opencode-v2-working-log.md`

| Line | Fact |
|---|---|
| 21-69 | 2026-09-08 pause (Johnny's request, JOH-7). Response/Stop fix: translate native `session.execution.*` to the original UI's busy and turn-close messages. Remaining list for the full VS Code port |
| 71-79 | 2026-09-08 user decision: the original Kilo VS Code UI and workflows must be preserved; the upstream-app wrapper does not satisfy it. Source `d99662338` |
| 81-94 | The wrapper prototype passed local VSIX acceptance (34/43 historical); infrastructure evidence only |
| 436-475 | Remote limits: 8 parent edges; transcript search over the newest 200 messages; per-node location validation; queue snapshots may omit immediately-delivered items. Packaging tested on macOS arm64 only |
| 558-596 | Store rules: V1 DB and live `kilo.jsonc` are incompatible (sharing corrupts data). `V1Migration.transformSession` rewrites the opened SQLite (Bun only). Do not fork `V1Migration` to take a destination path; use host identity (`OPENCODE_DB` / channel DBs). The upstream migrator also imports a sibling `opencode-next.db`. Rollback = v1 binary on the original files; there is no reverse migration |
| 1786-1821 | Sharing gates: target the JWT `share_token` and nested export; viewer reads v1 `message.info.role`, so v2 messages are dropped; team ownership via `kilo_meta` (post-cutover now); no per-item delete/tombstone contract; public sharing needs explicit consent because the export is not redacted |
| 1823-1836 | 2026-09-10 Plan follow-up: Unix-ms filename prefix; new-session handoff keeps the Plan tab and opens a Code tab |
| 1838-1889 | 2026-09-24 harness: `KILO_CLI_INTERACTIVE_DIR` is the analog of v1 `KILO_TEST_CLI_PATH`. `build-tui.ts` needs Bun ≥ 1.4 and throws on Windows. Interactive proofs run developer-local only. Pre-existing failures in `portable.test.ts` and `sidebar-pr.test.tsx` |

### External dependencies and owner contacts (from all docs)

| Item | Source |
|---|---|
| Cloud repo `Kilo-Org/cloud` (owner: `cloud` team; no CODEOWNERS). Consumers pinned: cloud-agent-next `@kilocode/cli@7.8.1`; Gastown 7.2.14 (EOL); KiloClaw 7.2.31 + `@latest` self-upgrade (EOL, residual exposure). Floating: auto-routing-benchmark, MCP-catalog CI | `cloud-agent-consumers.md:48-63,103-164` |
| Cloud-owner decisions 2026-10-07 (`next` dist-tag, `kilo2` binary, auth import, upstream session migrator, restore from both) and five open questions | `cloud-agent-contracts.md:40-59,376-392` |
| Session-ingest / Kilo Sessions relay `https://ingest.kilosessions.ai`; share backend in cloud `services/session-ingest` | `remote-v2-parity.md`, `session-sharing.md` |
| V1 telemetry: PostHog `us.i.posthog.com`, enabled by default | `telemetry-v2-overlap.md` §1 |
| Signing/notarization credentials (account owner) before the G1 preview train | `migration-context.md` deferred admin; old plan line 194 |
| People: Johnny (`johnnyeric`, original port owner, made the 09-08 scope decisions); the cloud owner who reviewed PR #14758 on 2026-10-05; PR #14704 (old execution-plan PR), PR #14758 (cloud-agent inventory review) | working log, `editor-services-inventory.md:5`, `cloud-agent-consumers.md:11,44` |
| Owners: every #14016–#14432 issue is unassigned (09-30, 10-02) | old plan line 28; `editor-services-inventory.md:9` |

## 8. Rewrite-or-drop list (11 remaining)

1. `migration-tracking/README.md`: rewrite as the living index (context brief, discovery, new plan, evidence folders).
2. `technical-notes/v2-fork-conventions.md`: rewrite (BASE pin, Kilo integration branch `origin/v2`, AGENTS branch names, path fixes); then living.
3. ~~`technical-notes/baseline/pinned-v2-baseline.md`~~: done in this phase.
4. `technical-notes/script/v2-baseline.ts`: fix the pin, the ancestry assertion, `services/www` and the CI mirror; then living.
5. `test-plans/kilo-opencode-v2-test-plan.md`: rewrite as a gate-tagged index.
6. `test-plans/kilo-opencode-v2-test-plan-runtime.md`: re-derive expected behavior from V1 (D3); keep the RT IDs.
7. `test-plans/kilo-opencode-v2-test-plan-ui.md`: same; keep the UI IDs.
8. `github-drafts/issue-13750/tracking-policy.md`: replace with D9/D10 doc ownership, or drop.
9. `github-drafts/issue-13750/progress-comment.md`: drop (unpublished, stale).
10. `github-drafts/issue-13750/shared-source-footprint.md`: drop (pointer stub).
11. `.DS_Store`: drop.
12. `technical-notes/.DS_Store`: drop (also add it to `.gitignore`).
