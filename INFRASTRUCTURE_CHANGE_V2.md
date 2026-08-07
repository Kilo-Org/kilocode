# Infrastructure Change Review V2 — upstream v1.18.13 merge (round 2)

Reviewed HEAD: `37a5cbf5db` (worktree HEAD is `ca36b6bb9f`, which only adds round-1 report docs on top). Pre-merge Kilo base: `b135b4e10a`. Upstream tag: `v1.18.13` = `a105350812`. Round-2 delta: `git diff cce22e608f..37a5cbf5db` (65 files, 4 fix commits: `cbbbd7217f`, `af6d1ded6d`, `a4d86f117f`, `37a5cbf5db`). Round-1 report: `INFRASTRUCTURE_CHANGE.md`.

## Scope & methodology

Two passes. (1) Re-verified every round-1 finding at the new head by reading the current files and diffing against upstream (`git diff a105350812..HEAD -- <path>`; empty = verbatim upstream). (2) Reviewed the delta's infrastructure files (`.github/actions/setup-bun/action.yml`, `.github/workflows/test.yml`, `package.json`, `bun.lock`, `.changeset/opencode-v1-18-0.md`, `script/check-test-ci.ts`, `script/translate-app.*`, `script/upstream/transforms/*`, `script/upstream/utils/config.ts`, `patches/*`) and ran the relevant guards: `bun run script/check-workflows.ts` (ok, 29 workflows), `bun run script/check-test-ci.ts` (ok, 25 test-bearing packages, 10 root script test files), `bun test ./script` (55 pass / 0 fail across 10 files), and `bun install --frozen-lockfile` (ok — "Checked 2059 installs across 2322 packages (no changes)"). (3) Fresh sweep of the full PR diff (`git diff --name-only b135b4e10a..HEAD`) for infra patterns (Docker, turbo.json, .npmrc/bunfig.toml, .husky, publish/release scripts, SDK generation, issue templates, CODEOWNERS, dependabot): the only infra-path hits beyond round-1 coverage are the delta files themselves and `artifacts/glm52-rise-video/.gitignore` (trivial, part of round-1 finding 3's directory). Full-PR `.github/` diff contains exactly two files: the setup-bun action and `test.yml`.

## Round-1 verification status

### Finding 1 — setup-bun duplicate Node setup: **FIXED**

- Commit `a4d86f117f` deleted Kilo's `Setup Node for native dependency builds` step (`actions/setup-node@v6`, non-Windows). At HEAD the action has a single Node setup: upstream's unconditional `Setup Node` step (`setup-node@49933ea5...` v4.4.0, Node 24), byte-identical to upstream.
- Kilo's `Configure node-gyp Node headers` step and the `npm_config_nodedir` export (both non-Windows, `kilocode_change`-marked) are retained. The header-detection step locates headers via `fs.realpathSync(process.execPath)`, so it works with any setup-node version — it now sees the v4.4.0-installed Node 24.
- `git diff a105350812..HEAD -- .github/actions/setup-bun/action.yml` shows only marked Kilo hunks (Windows cache exclusion, node-gyp headers, nodedir export, `--frozen-lockfile` + Windows retry, cache-save exclusion). No unmarked deviation remains.
- Residual (accepted behavior, not a defect): Windows runners get Node 24 from upstream's unconditional step and still run native builds **without** `npm_config_nodedir` (Kilo's export is non-Windows only). This is now the deliberate final state; CI Windows legs are the verification surface for `@lydell/node-pty` builds.

### Finding 2 — `script/translate-app.ts` unmarked edits / wrong binary: **FIXED** (by removal)

- Commit `cbbbd7217f` deleted `script/translate-app.ts`, `script/translate-app.test.ts`, `script/translate-app.md` and removed the root `translate:app` script. The unmarked-edits and `opencode`-binary problems are moot.
- Recurrence is prevented in the merge tooling: `script/upstream/utils/config.ts` adds all three files to `skipFiles`; `transform-package-json.ts` adds `translate:app` to `DELETE_UPSTREAM_SCRIPTS`; `PRESERVE_SCRIPTS` gains `test:script:ci`; tests cover all three (`skip-files.test.ts`, `transform-package-json.test.ts`) and pass.
- No dangling references: a repo-wide grep for `translate-app` / `translate:app` hits only merge-tooling config/tests and the review reports themselves. In particular, `.opencode/command/translate.md` never invoked the script (it is an agent prompt), so its retention creates no broken reference — see finding 4 for its own status.

### Finding 3 — `artifacts/glm52-rise-video/` LFS pointers: **STILL OPEN**

- Untouched by the delta. The five mp4s remain committed as 132-byte Git LFS pointer blobs (verified: `git cat-file -p` shows `version https://git-lfs.github.com/spec/v1`, e.g. oid `e732068df8...`, size 333945). `git lfs ls-files` shows all five smudged (`*`) locally.
- Still **not verified** that the LFS objects were pushed to the fork's LFS storage (offline sandbox; no network). If they weren't, fresh clones/checkouts of this branch break. Human verification required (fresh clone or `git lfs pull` on a clean clone).
- `artifacts/` was **not** added to `skipFiles`, so future merges keep syncing upstream demo/marketing content into the repo, and `artifacts/glm52-rise-video/package.json` is still stamped with Kilo's repo version `7.4.20` (release tooling will keep bumping it). The policy question from round 1 (sync vs. exclude upstream `artifacts/`) remains unanswered.

### Finding 4 — `.opencode/command/translate.md` references `opencode/gpt-5.6-sol`: **STILL OPEN** (trivial)

- File is unchanged at HEAD; still specifies `model: opencode/gpt-5.6-sol`. Inert at runtime (Kilo command discovery scans `.kilo`/`.kilocode` only, per `CONFIG_REGRESSION.md`), so impact stays trivial.
- New consistency note: the sibling tooling (`script/translate-app.*`) was removed **and** skip-listed, but `.opencode/command/translate.md` and `.opencode/glossary/` (still present) were not. Future merges will keep syncing them, including upstream model references. Recommend either skip-listing them too or explicitly accepting the drift.

## New findings

### N1. Round-1 miss (fixed by delta): `patchedDependencies` ↔ `bun.lock` desync at the round-1 head (medium, closed)

- **What round 1 missed:** Round 1 assessed `bun.lock` as "regenerated consistently with the dependency/patch changes" at summary level. It was not: at `cce22e608f`, root `package.json` declared patches `@dnd-kit/dom@0.5.0` and `solid-js@1.9.10`, while `bun.lock`'s patch map contained **neither** entry and resolved `solid-js@1.9.12` (Kilo's tree never resolves `@dnd-kit/dom` at all — zero occurrences in `bun.lock`, because upstream's packages that need it are skipped). A stale/missing patch entry desyncs the lockfile from `package.json`; `bun install --frozen-lockfile` treats that as "lockfile had changes, but lockfile is frozen". The setup-bun action installs with `--frozen-lockfile` on every CI leg, so installs at the round-1 head would very likely have failed CI. Inferred from the fix shape, not re-executed at the old revision — flagged for human confirmation against CI history.
- **The fix (`37a5cbf5db`) is correct on all three axes:**
  - Dropped `@dnd-kit/dom@0.5.0` patch + file — correct, the dependency is absent from Kilo's tree (upstream keeps its own copy because its app packages use it).
  - Rekeyed `solid-js@1.9.10` → `solid-js@1.9.12` and rebased the patch content: the dropped hunk (`if (!Transition.sources.has(node)) node.value = nextValue;`, solid #2046) is verified present in the published `solid-js@1.9.12` dist (`node_modules/.bun/solid-js@1.9.12/.../dist/solid.js:721`), i.e. absorbed upstream; the remaining hunks (cleanNode/onCleanup/catchError) are still carried.
  - Synced `bun.lock`'s patch map (`+"solid-js@1.9.12": "patches/solid-js@1.9.12.patch"`).
- **Verified at new head:** `bun install --frozen-lockfile` completes clean ("Checked 2059 installs across 2322 packages (no changes)").

### N2. Round-1 miss (fixed by delta): merge reset `packages/http-recorder` homepage/bugs to upstream URLs (low, closed)

- At base `b135b4e10a` the package pointed at `github.com/Kilo-Org/kilocode`; the merge reset both fields to `anomalyco/opencode` (upstream bleed in a Kilo-relevant metadata field); the delta restored the Kilo-Org URLs. Publish metadata only, no runtime impact. Round 1 did not assess this file. No transform/skip rule covers `homepage`/`bugs` for upstream-shared packages, so the same reset can recur on the next merge unless the merge tooling learns it — flagged for human decision (accept manual cleanup each merge, or extend `transform-package-json.ts`).

### N3. Changeset naming/content drift vs. merge target (low, open)

- `.changeset/opencode-v1-18-0.md` (added in `cbbbd7217f`) declares `patch` bumps for `@kilocode/cli` and `kilo-code` — matching the established precedent (`.changeset/opencode-v1-17-9-to-v1-17-13.md` used the same two packages and `patch`).
- But: the merge lands upstream **v1.18.13** (range v1.17.13 → v1.18.13), while the filename says `v1-18-0` and the summary reads "Adopt OpenCode v1.18.0 improvements". Prior convention used range filenames (`opencode-v1-17-9-to-v1-17-13.md`) with detailed categorized bullet lists; the new changeset is a single generic sentence. Changeset text ships verbatim in release notes — flagged for human polish (rename to the actual range, expand description), not a correctness blocker.

## Notable non-findings

- **`test.yml` workflow change — no allowlist drift (explicitly verified).** `script/check-workflows.ts` guards file-level add/remove under `.github/workflows/`; `test.yml` is already in its `active` list and no workflow files were added/removed, so `bun run script/check-workflows.ts` passes (ok, 29 workflows). The content changes are Kilo-authored and sit entirely inside pre-existing `kilocode_change start/end` blocks (new `Verify package test scheduling` and `Run root tooling unit tests` steps, junit `report_paths`/artifact `path` extended to cover root `.artifacts/unit/junit.xml`). Residual guard gap, by design: content edits to an already-accepted workflow are invisible to the check — if a future merge changes an accepted workflow's content from upstream, it passes silently. Acceptable today because all `.github/` divergence is Kilo-owned; stated for awareness.
- **New CI guard wiring is internally consistent.** `script/check-test-ci.ts` (`kilocode_change - new file`) requires every test-bearing package (except exempted `packages/kilo-vscode`) to define `test:ci`, and requires the root `test:script:ci` script when `script/*.test.ts` files exist. It passes at HEAD; the root script runs `bun test ./script` with junit output to `.artifacts/unit/junit.xml`, which the workflow's publish/upload steps now include; the new root script is in `PRESERVE_SCRIPTS` so future merges keep it. `bun test ./script`: 55 pass / 0 fail (10 files).
- **`transform-i18n` marker emission + 19 locale files.** The transform now appends `// kilocode_change` to lines it brands, and the delta applied that to the Kilo Go subscription line in 19 `packages/ui/src/i18n/*.ts` files (valid TS, comment after comma). Spot-check of `en.ts` vs upstream: all other unmarked diff lines are either inside an existing `kilocode_change start/end` block (mermaid keys), verbatim upstream intake from v1.18 (`sessionReviewV2`/`promptInput`/etc. — 33 matching keys in upstream's `en.ts`), or pre-existing Kilo-only keys already on main and untouched by this PR.
- **`meta.txt` branding.** `packages/opencode/src/session/prompt/meta.txt` now says Kilo/kilo.ai (was OpenCode/opencode.ai after the merge), and `takeTheirsAndTransform` in `script/upstream/utils/config.ts` plus a test in `skip-files.test.ts` make the branding repeatable on future merges.
- **`packages/sdk-next` `test:ci` timeout** raised 10s → 30s (CI stability; it already had `test:ci`, so unrelated to the new guard).
- **Fresh sweep:** no changes in the full PR to Docker files, `turbo.json`, `.npmrc`, `bunfig.toml`, `.husky` (hook content), `script/generate.ts`, publish/release scripts, issue/PR templates, CODEOWNERS, or dependabot config. `.opencode-version` remains `v1.18.13`. SDK regeneration files (`packages/sdk/openapi.json`, `types.gen.ts`) untouched by the delta (round-1 assessment stands). The only previously unassessed infra-path file is `artifacts/glm52-rise-video/.gitignore` — trivial upstream demo content, covered by finding 3's policy question.

## Limitations

- Offline sandbox: LFS remote-push verification (finding 3) and CI history confirmation (N1's inferred frozen-install failure at the old head) could not be performed; both are flagged for humans.
- The old-head install failure mechanism (N1) was validated at the new head only (`bun install --frozen-lockfile` passes now); I did not re-run it at `cce22e608f` to avoid mutating the review worktree.
- Annotation-check behavior on the merge head self-skips (`--worktree`: "No shared upstream source files changed"); i18n marker coverage was therefore verified by manual diff against upstream, per-file and per-block, as described above.
- Delta review was infra-scoped: the ~40 product-code files in the delta (provider/modal/session/UI changes and their tests) were not reviewed here.
- `git status` note: two untracked sibling review reports (`CONFIG_REGRESSION_V2.md`, `OPENCODE_MENTIONS_V2.md`) appeared in the worktree during this review; they are outside this report's scope and were not read or modified.
