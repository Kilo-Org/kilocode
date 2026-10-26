# Kilo OpenCode v2 fork conventions

Rules for working on Kilo's v2 line: the integration branch `origin/v2` on Kilo-Org/kilocode, built on upstream OpenCode's v2 line. Kilo `origin/main` (v1) keeps its own conventions.

This file holds the working rules. Facts and decisions live in one place each; this file links to them:

| Topic | Canonical place |
|---|---|
| Branches, pinned refs, decisions (D1 to D10), working model | [`../plans/migration-context.md`](../plans/migration-context.md) |
| Units, gates, per-unit `Mechanism` column | [`../plans/kilo-v2-migration-plan.md`](../plans/kilo-v2-migration-plan.md) |
| Placement strategy, vocabulary, shape rules | [`../plans/v2-host-strategy.md`](../plans/v2-host-strategy.md) |
| How to place one change, done-proofs | `.kilo/skills/v2-feature-placement/SKILL.md` |
| Branches and PRs, isolation, self-test, test policy, progress map | `.kilo/skills/v2-migration/SKILL.md` |
| Sync procedure and shared-patch checks | `script/upstream/README.md` |
| Known reds and validation commands | [`baseline/pinned-v2-baseline.md`](baseline/pinned-v2-baseline.md), reproduced by [`script/v2-baseline.ts`](script/v2-baseline.ts) |

Where this file conflicts with `migration-context.md`, that file wins.

## Upstream base and syncs

- The base is not fixed (D1). Kilo merges every upstream release into `origin/v2`, so the base moves with each sync. The current base is the release commit that `pinned()` in `script/upstream/utils/upstream.ts` returns: the second parent of the newest `chore(upstream): sync v2.x.y (<sha>)` merge, computed offline. `migration-context.md` records it with its date. Do not copy the SHA into other documents.
- The sync source is `upstream/dev`, upstream's v2 line since 2026-10-10. `upstream/v2` is frozen and never merged. `upstream` is `https://github.com/anomalyco/opencode.git`, fetch only.
- Never treat the tip of `upstream/dev` as the base. Each sync merges one release commit (the parent of a `v2.x.y` tag), pinned by SHA, in its own PR, with a merge commit. A commit past a release is merged only when Kilo needs an unreleased fix, and the PR says why. Every PR is validated against the `origin/v2` it targets, which carries the base.
- `bun script/upstream/merge.ts` runs a sync (it calls `bun script/check-workflows.ts --fix`, which removes the upstream workflows Kilo dropped and fails on a new one; add each new workflow to `active` or `removed` in `script/check-workflows.ts`). The procedure, conflict rules and the sync PR body are in `script/upstream/README.md`.
- After a sync, re-run the baseline (`bun migration-tracking/technical-notes/script/v2-baseline.ts --checks`), diff the failure list against the previous capture in `baseline/pinned-v2-baseline.md`, and record the new capture there. The script reads the new pin by itself.
- If a release commit that `origin/v2` merged stops being reachable from `upstream/dev`, upstream rewrote history: stop, assess a new integration base with the user, and never force-push `origin/v2` to match.

## Branches

- **Integration branch:** `origin/v2`. Long-lived; it becomes `main` at cutover. Every change reaches it through a PR, and a human merges. Never target `main` or upstream's `dev`.
- **Work branches:** one per unit, branched from `origin/v2` (or from the open PR branch it stacks on, which it then targets). Names are short and hyphenated, at most three words, with no slashes and no prefixes (`reland-agents-md`, `kilo-rpc-scaffold`). Commits and PR titles use `type(scope): summary` with types `feat|fix|docs|chore|refactor|test`. No Changesets.
- **Merge forward, never rebase the integration branch.** Its history is shared and must stay stable. Upstream syncs and PRs land on it as merge commits. An open PR takes a moved `origin/v2` with `git merge origin/v2`, not a rebase or a force-push, so reviewers keep their place.
- Always qualify the remote: `origin/v2` is Kilo's integration branch, `upstream/v2` is upstream's frozen branch. Use `gh -R Kilo-Org/kilocode`; without it `gh` resolves to upstream.

## Dev-fix triage lane

Fixes that land on Kilo `origin/main` do not reach the v2 line by themselves, and neither do unreleased fixes on `upstream/dev`. Each candidate gets an explicit classification before any port:

- `not-applicable`: the v2 architecture removed the affected code path.
- `already-fixed`: upstream v2 fixed it independently; record the upstream commit.
- `port`: re-implement against v2. Cherry-pick only when the commit is isolated and its provenance and dependencies are understood; re-implementing is the default.
- `defer`: real on v2 but outside the current gate; record why and the unit that owns it.

Record the result where the work is tracked, not in commit messages. v1 changes go through the v1 delta sweep (plan unit U-L2-01) and the progress map (`migration-tracking/progress/`, generated; the `v2-migration` skill says how a cell closes: a done-proof for `port`, a `native` disposition for `already-fixed`, `dropped` with evidence for `not-applicable`, an open cell with the owning unit for `defer`). An unreleased upstream fix that Kilo needs goes into a sync PR past the release commit (D1).

## Kilo-owned paths

Prefer new Kilo-owned files over edits to upstream files: every shared-file edit is a potential conflict at every sync. The one list of Kilo-owned paths is `owned` in `script/upstream/utils/owned.ts`; the merge tooling keeps Kilo's version of them, and the marker check and the shared-patch counter skip them. The main ones:

| Path | Purpose |
|---|---|
| `packages/kilo-*/` | Kilo packages: the host `kilo-cli`, the plugins `kilo-plugin`, logic packages `kilo-*-core` |
| `packages/<pkg>/src/kilocode/`, `packages/<pkg>/test/kilocode/` | Kilo modules and tests inside an upstream package, when they cannot live in a Kilo package yet |
| `migration-tracking/` | Migration docs and tooling outside any package: plans, discovery, this file, `baseline/`, `script/` |
| `.kilo/`, `script/upstream/`, `script/kilocode/`, `script/check-*.ts`, `script/dev-isolated.ts`, `.github/workflows/kilo-v2.yml` | Kilo agent config and skills, sync and CI tooling |

A path that also exists in the pinned upstream release is shared even when it matches a pattern. Do not fork or rename an upstream package to add Kilo behavior. Do not reconstruct the v1 `packages/opencode` tree; it does not exist on v2.

### Markdown tables in Kilo-owned files

Use the compact form: a minimal separator row and exactly single-space-padded content cells.

```
| Command | What it runs |
|---|---|
| `bun typecheck` | Every package, through turbo. |
```

Not the padded form, which makes a one-cell edit rewrite every row:

```
| Command                       | What it runs                   |
| ----------------------------- | ------------------------------ |
| `bun typecheck`               | Every package, through turbo.  |
```

Unlike Kilo `main`, this tree does not exclude markdown from prettier: `.prettierignore` lists five generated or vendored paths and nothing else, so `prettier --write` over a Kilo-owned document re-pads every table. Do not run it over Kilo documents. Nothing enforces the rule yet: no v2 workflow runs prettier, and v1's `script/check-md-table-padding.ts` has no v2 equivalent, so review upholds it. Leave upstream documents formatted the way upstream formats them.

### Root `AGENTS.md`

The root `AGENTS.md` is upstream's file. Kilo adds one marked block at its top (`kilocode_change start - agents-md` ... `kilocode_change end - agents-md`) with the rules that override upstream's on this line (integration branch, moving base, branch names, `bun dev` isolation instead of `dev:live`, placement, direction of code movement, checks) and pointers to this file, the context brief and the skills. The upstream text below the block stays untouched. The block is a rung 4 entry in `script/upstream/shared-patches.json`. Keep it short: a new rule goes into the canonical document, and the block links to it.

## Plugin-first extension order

Use the first rung that works. Prefer rungs 1–2 even when the donor has a working non-plugin solution. Code moves one way, from upstream files into Kilo-owned files, never back: a Kilo-owned mirror of an upstream file is rung 2 and is never replaced by a seam in the file it mirrors, and a patch never changes an upstream default (upstream's own tests pass unchanged without the host). Source of truth: `../plans/v2-host-strategy.md` section 5. A PR that uses rung 3 or 4 says why rungs 1 and 2 do not work, and rungs 3 and 4 carry a `kilocode_change` marker. Branding and product strings use automated renaming in Kilo-owned code (rung 5), never hand edits in upstream files. PR #15417 supplies the interim source/build adapter described below. The `v2-migration` skill carries the same order for agents; the plan adds the per-unit `Mechanism` column (`../plans/kilo-v2-migration-plan.md` §B0). The procedure for one change is the skill `.kilo/skills/v2-feature-placement/SKILL.md`; the reasoning and the guarantees are in `../plans/v2-host-strategy.md`.

Vocabulary: a **plugin hook** is an extension point upstream exposes through `@opencode/plugin` (rung 1, no marker). A **seam** is a generic knob or dispatch point Kilo adds to an upstream file so a plugin hook becomes possible (rung 3, one to three marked lines that carry no Kilo value). A **patch** is a Kilo-specific line inside an upstream file (rung 4, one line thick, behavior in a Kilo module). Every marked line carries its feature: `kilocode_change(<feature>)`, or `kilocode_change(<feature>:<id>)` when it replaces a progress-map cell; a Kilo-owned file that replaces a v1 patch cell carries `kilo_port(<feature>:<id>)` instead. Logic packages (`packages/kilo-*-core`) import nothing from `@opencode/*`; adapters import core internals only when no public surface has it, and name each one in the PR.

| Rung | What | v2 mechanism, examples | Marker |
|---|---|---|---|
| 1 | Kilo plugin on the public plugin API | `@opencode/plugin` domains: agent, provider, model, aisdk, session, event, tool, permission, command, skill, mcp, rpc, storage, worktree, shell, vcs, websearch, integration, reference | None (Kilo-owned path) |
| 2 | Kilo host composition (unit U-E0-01) | Kilo's own entry point, `packages/kilo-cli`. Register Kilo plugins through `SdkPlugins.register` (`packages/core/src/plugin/sdk.ts`): list them in `packages/kilo-plugin/src/index.ts`, the host registers them. Replace Effect services with layers, for example `Global.layerWith` for app directories. Translate `KILO_*` environment variables before boot | None |
| 3 | Seam patch in a shared file | Small and generic: widen an API, add a hook, export a value, with upstream's value as the default. Prefer files that change rarely. No `kilocode/` path, `Kilo*` identifier or Kilo string literal in the marked lines; with one, it is rung 4 | `kilocode_change` |
| 4 | Feature patch in a shared file | Last resort | `kilocode_change`, reason in the PR |
| 5 | Branding and product strings | Kilo-owned automated renaming; interim source/build adapter in #15417, mapping reviewed at every sync; never hand-edit upstream | None (Kilo-owned path) |

### Branding and upstream drift

The interim approach in #15417 keeps the replacement catalog and artwork in `packages/kilo-cli/src/branding/`. The host applies the same transformation during source loading and compilation, without editing upstream source or changing behavior without the host. Compiled binaries contain the branded output. This is rung 5 for renaming; loader/bootstrap wiring is rung 2 host composition, not a public plugin hook.

The catalog still depends on upstream paths and wording. At every sync, including clean merges, inspect moved/deleted files and changed anchors, update the mapping, and rerun branding tests and source/compiled checks. Known anchor changes and missing mapped files fail tests; newly introduced text outside the catalog still needs manual review. Preserve internal imports, provider/protocol IDs and schema URLs rather than applying a blanket replacement.

A dedicated sync-time branding audit/report is a proposed follow-up, not implemented automation. The disabled legacy conflict-only rename passes are not a substitute. Generated copies or a stable branding API require a separate approved design. The agent procedure is in `.kilo/skills/v2-migration/SKILL.md`, section "Branding and upstream drift", and `.kilo/skills/v2-feature-placement/SKILL.md`.

### Areas expected to need rung 3 or 4

Measured 2026-10-13 (plan delta, #15021). Plugin first reduces shared patches but not to zero: v1 `origin/main` patched 609 upstream files with 5,246 markers; the archived port had 3,719 Kilo-owned paths and 24 shared production files (5 core, 1 plugin, 4 theme, 14 TUI). Seam patches age fast: after 1,462 upstream commits, 5 of those 24 still applied, 16 conflicted and 3 targets were deleted. Needing rung 3 or 4 here is expected, not a policy failure:

- **TUI:** 14 of the archived port's 24 shared files. The busiest upstream file, `packages/tui/src/routes/session/index.tsx`, got 52 upstream commits in 5 weeks.
- **Environment variables:** 123 `OPENCODE_*` variables in 364 files, with no central module in core. Host translation covers reads; Kilo-specific behavior needs patches.
- **Cost tracking:** the plugin session API gives `tokens` but no cost. Gateway cost per request probably needs a provider-level seam (not verified in detail).
- **Session format and remote ownership (E4):** probably core seams.
- **Identity paths:** 11 static `Global.Path` references in 7 files bypass `Global.layerWith`.
- **Branding:** about 4,100 `"opencode"` literals in about 790 files. Rung 5 (Kilo-owned automated renaming, interim adapter in #15417), not a public plugin hook. Review new visible text at each sync; do not rename every literal.

## Narrow shared seams

When a Kilo capability genuinely needs upstream code to call it:

- Add the smallest possible registration or dispatch point, and put the logic in a Kilo-owned module the seam imports or a plugin configures.
- Do not refactor, reformat or restructure surrounding upstream code in the same change. A seam diff reads as a few added lines.
- Respect v2's dependency direction: Schema to Core and Protocol, then Server; generated clients after. Client runtime code may depend on Schema and Protocol, never on Core or Server.
- Never hand-edit generated output: `packages/client/src/promise/generated`, `packages/client/src/effect/generated`, `packages/client/src/effect/api`, `packages/protocol/openapi.json`, `services/www/openapi.json`. Regenerate with `bun run generate` in the owning package (`packages/client` after a Protocol or Server `HttpApi` change; `packages/protocol` and `services/www` for their OpenAPI documents; each has `check:generated`). Report generated diffs separately from handwritten ones.

## `kilocode_change` markers

- Mark every Kilo edit inside a shared upstream file with a `kilocode_change` comment saying what changed and why, so upstream merges show the intent. Markers apply to plugin-first rungs 3 and 4 only. Forms: inline `// kilocode_change(<feature>) - <reason>` (add `seam` for rung 3), a block `kilocode_change start - <reason>` ... `kilocode_change end`, or `# kilocode_change` and `<!-- kilocode_change -->` in YAML, shell and Markdown. The counters recognize a block only when `start` or `end` follows `kilocode_change` directly (`script/upstream/utils/shared.ts`, `utils/markers.ts`), so a block names its feature after `start -`, not as `kilocode_change(<feature>) start`.
- Every shared file Kilo changes has an entry in `script/upstream/shared-patches.json` with its rung and the missing seam; a PR that adds a patch raises `limits` in the same diff, and one that removes a patch lowers them. A file that cannot carry markers (JSON) states an `unmarked` reason. Check with `bun script/check-opencode-annotations.ts --worktree` and `bun script/check-shared-patches.ts --worktree` before a commit; CI runs both without `--worktree` (`kilo-v2.yml`, job `shared upstream patches`).
- Do not mark Kilo-owned files. A file under a Kilo-owned path is Kilo by construction; markers there are noise. When source moves from a shared v1 file into a Kilo package (for example `packages/kilo-plugin`), drop the inherited markers, keep useful explanatory comments, and close the progress-map cell it replaces.
- Preserve existing markers when resolving an upstream merge. Resolve in favour of the current v2 architecture first, then reapply the Kilo invariant through its owned seam.
- Removing a marker from a shared upstream file requires explaining whether its behavior was removed or relocated. Removing redundant markers from Kilo-owned files does not remove the behavior; record that distinction in the PR.

## Packages that are not on v2 yet

Rules that apply once a package lands, kept here so the landing PR finds them:

- **`kilo-vscode` (G2): `virtua` patch.** v1 `main` pins `virtua@0.49.1` and patches it (`patches/virtua@0.49.1.patch`, adds `VirtualizerHandle.measure()`), and `packages/kilo-vscode/webview-ui/src/components/chat/MessageList.tsx` calls `handle.measure()` for the transcript handoff-flicker fix. v2 has neither the dependency nor the patch. Port the patch with its call site, or neither, and do not bump `virtua` without both.

## Validation

The commands come from this v2 tree and its CI (`.github/workflows/check.yml`, `test.yml`, `kilo-v2.yml`), not from Kilo `main`. `bun migration-tracking/technical-notes/script/v2-baseline.ts --checks` runs them in CI order, and `baseline/pinned-v2-baseline.md` lists them with the last result.

- `bun run check` from the root (lint and typecheck; the pre-push hook runs it). `bun typecheck` and `bun test` from package directories. Never run `tsc`, and never run tests from the root (`bunfig.toml` test root `do-not-run-tests-from-root`); `bun turbo test` runs each package's own tests.
- Isolate tests from the real home as the `v2-migration` skill describes.
- Pristine upstream is already red at each base. Before attributing a failure to a change, compare it with the current capture in `baseline/pinned-v2-baseline.md`, and with `origin/v2` before the change when `origin/v2` has moved past that capture.
- Report handwritten and generated diffs separately, and never report a check as passing without having run it.
