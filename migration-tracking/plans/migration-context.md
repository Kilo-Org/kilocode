# Migration context (canonical brief)

This file is the single source for the shared facts, decisions and rules of the Kilo v1 → v2 migration. Role prompts (discovery, planner, coordinator) and implementation session prompts point here instead of restating it. When a fact here changes, change it here first.

Status: active. The bootstrap docs landed on `origin/v2` (#15038). Lane L1 is running: the upstream merge tooling (#15026) and the syncs to `v2.0.27` (#15029) and `v2.0.30` (#15136) are merged. No Part B unit is marked done yet. Last updated 2026-10-16. Plan: [`kilo-v2-migration-plan.md`](kilo-v2-migration-plan.md).

## Branches and pinned refs

| Item | Value |
|---|---|
| Integration branch | `origin/v2` on Kilo-Org/kilocode (long-lived; becomes `main` at cutover). Not to be confused with opencode's `upstream/v2` |
| Current working base | `origin/v2`. The migration docs landed there on 2026-10-13 (#15038). Every session branches from it |
| Upstream base commit | `5e73d5cb1f788637b1b3d5cf1298ea694cbad0c5`: the parent of upstream release tag `v2.0.26` (`feat(core): add Google Cloud credential setup for Vertex (#53798)`). It is on `upstream/v2` and on `upstream/dev` |
| Upstream release tag | `v2.0.26` = `9b4ec5714d481559990db0a816d5dec19541a814` (reference marker only; not on upstream's v2 line, see note) |
| Archived old port | tag `kilo-v2-checkpoints-2026-09` = `879b89e89034f0e9f4cfb7fd09a5323ef06f83c9` (former `kilo-v2` tip). Donor code only |
| V1 target (behavioral reference) | `origin/main` pinned at `fb7e96eda5409517a05948b9efaf01c53997bf6e` (2026-10-09) |
| V1 assessment snapshot | `f7115470` (2026-08-12): where the existing 816-file source assessment stops. The assessment itself reviewed `d99662338e` (2026-08-10, 800 commits earlier); the first v1 delta sweep starts from `d99662338e` so the gap gets file-level dispositions. No unit verdict depends on the difference (discovery register, gap table) |

Note on the base: upstream cuts each release as a separate version-bump commit (`release: vX`) on top of the tip of its v2 line, tags it, and does not merge it back. The tag is therefore one commit off the branch. The base is the tag's parent: release-equivalent code, on the branch, and free of the version-bump commit, so later merges of `upstream/dev` stay clean. Each sync targets a release commit the same way (D1).

Eventual end state: Kilo's `origin/v2` becomes `main`; today's `main` becomes `v1`, maintained for critical fixes only, for a limited period.

## Repositories

- Kilo repo: `Kilo-Org/kilocode` (remote `origin`). `main` is Kilo v1.
- Upstream: `anomalyco/opencode` (remote `upstream`, fetch only). Its v2 line is branch `dev`, written `upstream/dev`, since upstream promoted v2 to `dev` on 2026-10-10 (`5caf1f9`). Before that the line was branch `v2`, written `upstream/v2`. Published on npm as `@opencode/cli`. Upstream renamed its workspace scope from `@opencode-ai/*` to `@opencode/*` on 2026-09-07 (`a5312e16`); a few packages kept the old scope.
- The old port branch `kilo-v2` still exists but is frozen. Read it through the archive tag.
- **Name collision:** since 2026-10-12 the Kilo integration branch is `v2` on `origin` (Kilo-Org/kilocode), the same name as upstream's `v2` (anomalyco/opencode). Always qualify the remote: write `origin/v2` for the Kilo integration branch and `upstream/v2` for upstream's branch, in docs, commands and merge targets. `upstream/v2` is frozen since 2026-10-10 (tip `4617210822b`) and must not be merged; the sync source is `upstream/dev`.

## Decisions (authoritative)

Do not re-litigate these without new evidence. Proposed changes go to the user.

1. **New base.** A clean branch from upstream v2 (see pinned refs). Never merge the old port branch into it. Upstream changes arrive by merging `upstream/dev` (upstream's v2 line since 2026-10-10), pinned by SHA each time. Syncs target release commits (the parent of a `v2.x.y` tag); a commit past a release is merged only when Kilo needs an unreleased fix. Release tags are markers, not merge targets. `upstream/v2` is frozen and never merged.
2. **Freeze.** The old port branch is archived donor code. Current v1 `main` (pinned above) is the behavioral reference.
3. **Donor rules.** The donor provides mechanism: how a Kilo feature is expressed on v2 (seams, RPC definitions, plugin shape, host-adapter pattern). Behavior and policy come from current v1.
4. **Staleness gate.** For each feature, diff the v1 files it touches between the assessment snapshot and the v1 target. Empty delta: the donor is likely faithful. Non-empty: re-derive behavior from v1 and keep only the donor's v2 mapping.
5. **Staged cutover.** G1 CLI/TUI → G2 VS Code → G3 JetBrains, each with its own go/no-go. G2 and G3 are independent client-surface tracks that run in parallel with G1 once their prerequisites land. Until their gate, the IDEs stay on v1: VS Code bundles the CLI from the same `main` build (no version pin); JetBrains pins a CLI version.
6. **Storage.** A separate customer v2 data store. v1 files are never touched while any v1 surface ships. Import is opt-in and re-runnable. Path consolidation only after G3.
7. **Scope.** Post-cutover (non-gating): voice, image generation, team and incremental sharing, legacy TUI extras, and features behind experimental flags on v1 that are off by default, unless explicitly made a gate. Features named experimental but on by default on v1 (for example background subagents and the shared agent board) are in scope like any shipped feature. KiloClaw is not needed. Hard gates: FIM/next-edit for G2; whether it gates G3 is pending Q-G3-01. Cloud agents and Anaconda Desktop gate whichever surface they consume.
8. **Gates override P-labels** for surface readiness. P-labels order work globally; gates define what a surface needs to ship.
9. **Plan format.** One file with two parts: Part A high level (epics, gates, critical path, risks), Part B low level (per-epic units, dependencies, acceptance), plus appendices (facts, glossary, links).
10. **Readability.** Separate why, what, when and how-to-verify. Progressive disclosure. No sub-numbered steps. Issue IDs only in Part B and the register. One canonical place per fact.

## Deferred decisions

Decisions intentionally left open until the work that needs them. Each has a deadline; the coordinator raises it with the user and owners before that point. Detail and evidence: `migration-tracking/discovery/v2-unit-register.md`, "Open questions"; questions added by the planner (Q-HOST-01, Q-TEL-01): `kilo-v2-migration-plan.md` §A10.

| Decision | Deadline |
|---|---|
| v2 binary name and distribution channel (npm dist-tag), and how v1 IDEs are kept from resolving the v2 binary. Cloud owners proposed a `kilo2` binary on npm `next` (2026-10-07) | **Before the first beta or preview release that is distributed outside the team** |
| VS Code (G2) and JetBrains (G3) questions, including whether FIM/next-edit gates G3 when JetBrains v1 has no FIM | When the trigger unit listed in the register starts |

## Working model

| Rule | Detail |
|---|---|
| Human merges | The user merges every PR. No agent merges. |
| Coordinator | Read-only on the integration branch and the working base. Never pushes to them, never force-pushes, never rebases them, never holds a long-lived branch. |
| Implementation | Sessions are started by the user from prompts the coordinator prepares. One unit per session, one branch and one PR per unit. |
| Coordinator meta edits | Default: micro-PR (short-lived hyphenated branch such as `coord-status-<id>` or `coord-plan-<slug>`, one logical change, report the URL, delete the branch after merge). For edits that deserve an audited session: a micro-session prompt for the user instead. |
| GitHub actions by the coordinator | May comment on issues and set labels for status hygiene, conservatively and only when it clearly helps. Never creates or closes issues; that goes through the user or a prepared prompt. |
| Writers | One writer per branch and per file. Announce ownership before starting. |
| Escalation | Epic or scope changes, gate assignment of consumers, and anything that changes a decision above go to the user. |

**Enforcement is by convention only, for now.** The account running the migration has write access but not repo admin, so branch protection on Kilo's `origin/v2` cannot be set yet (see deferred admin tasks). Until an admin adds it:

- Direct pushes to `origin/v2` are forbidden by convention. Every change reaches it through a PR.
- Repo settings, Actions settings, secrets and branch protection are escalations to a repo admin. No agent attempts them.

## Conventions

- Follow the repo `AGENTS.md` and `migration-tracking/technical-notes/v2-fork-conventions.md`. Note that the `AGENTS.md` on this branch is upstream's until Kilo's is re-landed.
- Branch names: short, hyphenated, no slashes or type prefixes. Commits and PR titles: `type(scope): summary`.
- Kilo behavior lives in `kilo-*` packages or `packages/<pkg>/src/kilocode/`. Shared-file patches carry a `kilocode_change` marker and a stated missing seam.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Never edit generated files.
- Run `bun typecheck` from package directories, never `tsc`. Do not run tests from the repo root.
- No Changesets.
- Run `bun install` after switching to this branch from a v1 checkout; the dependency graph differs and the upstream pre-push hook (`bun run check`) fails without it.
- Compare any failing check against the recorded baseline before attributing it to a change.

## Definition of done per unit

Code, tests, acceptance evidence, an updated unit row (Status cell in Part B of the plan), and docs. A local pass is never recorded as end-to-end.

## Deferred admin tasks

These need a repo admin (or account credentials) and do not block work. Track them here and in a GitHub issue labelled `admin`.

| Task | When | Owner |
|---|---|---|
| Branch protection on `origin/v2`: require a PR before merging (0 approvals now, raise to 1 when reviewers are available), force-push and deletion disabled | Now | Repo admin |
| Actions permissions and secret access for the upstream sync workflow and the e2e lane | When those workflows land | Repo admin |
| Signing and notarization credentials | Before the G1 preview release train | Account owner |
| Protect the branch that becomes `main` | At cutover | Repo admin |

## Bootstrap status

| Item | State |
|---|---|
| Kilo integration branch `origin/v2` created from the upstream base | Done |
| Old port archived as a tag | Done |
| Migration docs landed on `origin/v2` | Done 2026-10-13: #15038 |
| This file | Done |
| Branch protection | Deferred (admin task) |
| Baseline health recorded (`bun install`, `bun run check`) | Done 2026-10-11: `technical-notes/baseline/pinned-v2-baseline.md` |
| Discovery report | Done 2026-10-12: `migration-tracking/discovery/` |
| Migration plan | Done 2026-10-12: `migration-tracking/plans/kilo-v2-migration-plan.md` |

## Reference artifacts

- Plan (living): `migration-tracking/plans/kilo-v2-migration-plan.md`. The previous execution plan, progress plan and working log in `plans/` are superseded (banners at the top) and kept as reference only.
- Discovery outputs (frozen evidence once absorbed by the plan): `migration-tracking/discovery/` (feature inventory, epic taxonomy, unit register, doc inventory).
- Source parity: `migration-tracking/marker-audit/` (the 816-file assessment and shared-change inventory).
- API and session differences: `migration-tracking/technical-notes/baseline/v2-v1-schema-diffs.md`, `migration-tracking/technical-notes/baseline/v2-v1-session-diffs.md`.
- Technical notes: `migration-tracking/technical-notes/` and `technical-notes/baseline/`.
- GitHub: issue #13750 and its children, for scope and acceptance detail.
