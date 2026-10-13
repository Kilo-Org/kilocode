# v2 plan delta: upstream/dev sync and plugin-first extensions

Status: proposed on 2026-10-13. When the bootstrap docs land on `v2`, fold this file into `kilo-v2-migration-plan.md` and `migration-context.md` (action item A8), then delete it.

- Merge tooling: #15020
- Agent rules: `.kilo/skills/v2-migration/SKILL.md`
- Until they land, the bootstrap docs are on `origin/kilo-v2-clean-bootstrap`. Read them with `git show origin/kilo-v2-clean-bootstrap:<path>`.

## 1. Facts

Verified on 2026-10-13 with the commands in the evidence column.

| Fact | Evidence |
|---|---|
| Upstream made v2 its default branch on 2026-10-10 | `5caf1f9 chore: promote v2 to dev`. `upstream/dev` has no `packages/opencode` |
| `upstream/v2` is frozen | Tip `4617210822b` (2026-10-10). `git rev-list --count upstream/dev..upstream/v2` is 0 |
| Kilo `v2` lags upstream | Base `5e73d5cb1f7` is the release commit of `v2.0.26` (2026-10-08), the parent of the tag. Since then upstream released `v2.0.27` (2026-10-12) and `v2.0.28` (2026-10-13), and `upstream/dev` changed 534 files in the harness packages, +9,940 / -4,354 lines |
| Upstream releases v2 almost daily | 10 releases from `v2.0.19` (2026-09-29) to `v2.0.28` (2026-10-13). v2 releases are tags only. The "Latest" GitHub release is still `v1.19.0` (2026-10-11) |
| The next sync has no code conflicts | Dry run (`git merge-tree`) of `origin/v2` with `044d8b7d2e5`, the release commit of `v2.0.28`: 0 conflicts outside `.github/workflows/`. 7 modify/delete conflicts on deleted workflows, 1 content conflict in `check.yml`. About 10 new upstream workflows to delete |
| The first sync adds history | `git rev-list --count origin/v2..upstream/dev` is 1,506. File content is not affected |
| The shared diff on `v2` is small today | 28 shared files, 25 of them deleted workflows |
| The v1 fork patched widely | `origin/main`: 609 upstream files with 5,246 `kilocode_change` markers |
| Plugin first reduces patches, but not to zero | Archived port (tag `kilo-v2-checkpoints-2026-09`): 3,719 Kilo-owned paths, 54 shared paths, 24 shared production files (5 core, 1 plugin, 4 theme, 14 TUI) |
| Seam patches age fast | Archived port after 1,462 upstream commits: of 24 shared production files, 5 still apply, 16 conflict, 3 were deleted upstream (`core/src/plugin/system-prompt.ts`, `theme/src/tui/defaults.ts`, `theme/src/tui/fallback.ts`) |
| Branding cannot be a plugin | About 4,100 `"opencode"` literals in about 790 source files on `origin/v2` |
| Environment variables are spread | 123 different `OPENCODE_*` variables in 364 source files, with no central module in core |

## 2. Upstream sync (lane L1)

### Changes to the plan and the context

- Decision D1, lane L1 and unit U-L1-01: the merge source is `upstream/dev`. The sync target is the newest release commit: the parent of the newest `v2.x.y` tag, which is on `upstream/dev`. This follows the base rule in `migration-context.md` ("the base is the tag's parent"). Merge the tip of `dev` only when a fix after the newest release is needed, and pin it by SHA.
- `migration-context.md`, name collision note: add that `upstream/v2` is frozen since 2026-10-10 and must not be merged.

### Why syncs start now, before the tooling

- Upstream ships about 5 releases a week, and in the last 5 days it changed 534 harness files. Every week without a sync makes the next sync bigger, and every Kilo patch is built against an older API. The archived port shows the cost: 5 weeks without a sync, and 16 of 21 remaining seam patches conflict.
- Today the shared diff is 28 files, and the next sync has no code conflicts (section 1). Manual syncs are cheap now.
- The tooling only pays off when shared patches grow. Each sync is the real test for the next tooling step, so the tooling grows with the syncs.

### Steps

1. **First sync, now.** On a branch from `origin/v2`, merge `044d8b7d2e5` (the release commit of `v2.0.28`). Keep the deleted workflows deleted, keep Kilo's `check.yml` trigger, and delete the new upstream workflows (`bun script/check-workflows.ts` fails until they are gone). Then run `bun typecheck` in the changed Kilo packages and focused tests with the test isolation from the skill. Compare test failures against `origin/v2`, because `pinned-v2-baseline.md` is for the old base. The PR body gives the SHA and release, the lag before and after, each conflict and its resolution, and the shared files touched. Merge the PR with a merge commit. A squash removes the upstream ancestry, and the next sync then conflicts again.
2. **After the sync.** Open PRs merge `v2` into their branch (no force-push), run their checks again and self-test again.
3. **Tooling, one step per sync** (#15020):
   1. The annotation check and the shared-patch counter. They need no decision and enforce section 3. Start them in parallel with the first sync.
   2. `script/upstream/merge.ts` and the transforms, with v2 path lists, after decision D-1.
   3. The string and import codemods, together with the rebranding work.
   4. A v2 mode for the upstream-merge agent, the review command and the merge skills.
4. **Cadence.** Sync to the newest release commit at least weekly, and right away when a release fixes something Kilo needs. If a week is missed, the next sync PR says why. Each sync PR records the lag in releases and days.

## 3. Extension policy: plugin first

Use the first rung that works. A PR that uses rung 3 or 4 says why rungs 1 and 2 do not work.

| Rung | What | v2 mechanism, examples | Marker |
|---|---|---|---|
| 1 | Kilo plugin on the public plugin API | `@opencode/plugin` domains: agent, provider, model, aisdk, session, event, tool, permission, command, skill, mcp, rpc, storage, worktree, shell, vcs, websearch | None (Kilo-owned path) |
| 2 | Kilo host composition (unit U-E0-01) | Kilo's own entry point. Register Kilo plugins through `SdkPlugins.register` (`packages/core/src/plugin/sdk.ts`). Replace Effect services with layers, for example `Global.layerWith` for app directories. Translate `KILO_*` environment variables before boot | None |
| 3 | Seam patch in a shared file | Small and generic: widen an API, add a hook, export a value. Prefer files that change rarely. Offer it upstream when it is generic | `kilocode_change` |
| 4 | Feature patch in a shared file | Last resort | `kilocode_change`, reason in the PR |
| 5 | Branding and product strings | The rename script during each sync, never hand edits | None (script) |

### Budget and reporting

- Each PR lists the shared files it changes, with the rung and the missing seam.
- The counter (#15020, U-L3-01) tracks shared files, marked lines and unmarked exceptions. CI fails when the count grows without a stated seam.
- One generic seam is better than many small edits. Example: one product-identity seam for app name, environment prefix and user agent.
- Keep upstream's internal package names (`@opencode/*`) unless decision D-1 says otherwise.

### Areas that will need rung 3 or 4

This is expected and is not a failure of the policy.

- **TUI:** 14 of the 24 shared production files in the archived port. It also has the busiest upstream files: `packages/tui/src/routes/session/index.tsx` got 52 upstream commits in 5 weeks.
- **Environment variables:** host translation covers reads. Kilo-specific behavior needs patches.
- **Cost tracking:** the plugin session API gives `tokens` (`TokenUsage`) but no cost. Gateway cost per request probably needs a provider-level seam. Not verified in detail.
- **Session format and remote ownership (E4):** probably core seams.
- **Identity paths:** 11 static `Global.Path` references in 7 files do not go through `Global.layerWith`.

## 4. Host package next (unit U-E0-01)

U-E0-01 is a pre-gate unit, and nobody has started it. Without it, feature PRs register Kilo code in upstream's builtin lists:

- #14998 Gateway: `packages/core/src/plugin/provider.ts` (one marked registration)
- #14999 Kilo agents: `packages/core/src/plugin/internal.ts` (one import, two list lines)
- Identity (no PR yet): the `app` constant in `packages/util/src/global.ts`

Proposal: make the host package the next foundation PR. Acceptance:

- `bun dev` starts the Kilo host entry, and the host entry runs the upstream CLI and server.
- Kilo plugins register through `SdkPlugins.register`, not through `internal.ts` or `provider.ts`.
- The archived port's `packages/kilo-cli/src/host.ts` is the mechanism reference (decision D3). Check it against the current `v2` before reuse.
- If `SdkPlugins` lacks a needed phase, add it as one rung-3 seam. The archived port added a `post` phase so that host policy runs after user config.

In-flight PRs do not wait. They merge with their marked registration and move to host registration when U-E0-01 lands.

## 5. Doc changes when the bootstrap docs land

- `migration-context.md`: change "Current working base" to `origin/v2`. Change D1 to `upstream/dev`. Add the note that `upstream/v2` is frozen.
- Plan: change the D1 row in A3, the L1 lane row and U-L1-01 to `upstream/dev`.
- Plan, A8 risk "Shared-patch growth": refer to the rung table in section 3.
- U-L3-01: define the three counted metrics and the rung field per shared file.
- U-E0-01: mark it as the next foundation unit, with the acceptance in section 4.
- `v2-fork-conventions.md`: add the rung table. Markers are for rungs 3 and 4 only.
- Add the Gateway epic (#14991) to the plan (action item A8).

## 6. Decisions for the next sync

| ID | Decision | Proposal |
|---|---|---|
| D-1 | Package names on `v2` | Keep upstream's internal `@opencode/*` names. Rename only published packages, the binary and user-visible strings. v1 renamed on every merge, which caused a large share of the conflicts |
| D-2 | Sync cadence and target | At least weekly, to the newest release commit (the parent of the newest `v2.x.y` tag) |
| D-3 | Owners of U-L1-01, U-L3-01 and U-E0-01 | To agree |
| D-4 | Split of identity and branding | Identity PR 1 is store isolation and the `kilo2` app directory. Binary, user agent, theme and logo go with rebranding (Fabio, A11) |
