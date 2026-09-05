# Pinned upstream v2 baseline

Phase 0 baseline for `plans/kilo-opencode-v2-issue-13750.md` (originally
captured as slice 1 of the now-superseded `plans/kilo-opencode-v2-port.md`, bead
`kilocode-cmy`).

This records the exact refs the Kilo OpenCode v2 line is based on, the
authoritative validation commands **as defined by this v2 tree**, and the
results of running them on pristine upstream v2. Everything below was produced
on 2026-08-13 on branch `johnnyeric/v2-baseline` with no Kilo product code in
the tree.

Reproduce with `bun kilocode/script/v2-baseline.ts --checks`.

## Refs

Fetched with `git fetch origin main` and `git fetch upstream dev v2` immediately
before recording. `origin` is `https://github.com/Kilo-Org/kilocode.git`;
`upstream` is `https://github.com/anomalyco/opencode.git`.

| Ref | SHA | Commit date | Subject |
|---|---|---|---|
| `upstream/v2` (pinned) | `76dbaf20adbd43fd208a00ef3cda4a51e125a234` | 2026-08-12T18:18:24-04:00 | `fix(catalog): serve app shell at lab route (#42159)` |
| `upstream/dev` | `14b37df39168eaf6a6faf862ec4a7bbe9c825bbd` | 2026-08-12T22:36:40Z | `chore: update nix node_modules hashes` |
| `origin/main` | `f7115470740c51fd4200fedd9ad3edfad60589ce` | 2026-08-12T10:38:03-06:00 | `Merge pull request #13077 from Kilo-Org/fix/ci-test-stability-in-process` |

`upstream/dev` moved after the pin was chosen. The pin is deliberately the
`upstream/v2` tip at pin time, not the newest `upstream/dev` commit.

## Merge bases and ancestry

```
$ git merge-base upstream/dev upstream/v2
0e2dd4ad150d0182fc9e43d81424d8db11465977
$ git merge-base origin/main upstream/v2
0e2dd4ad150d0182fc9e43d81424d8db11465977
$ git merge-base origin/main upstream/dev
dc67b7a3bed6334a9639fe1362bb90c56288bc7c
$ git merge-base --octopus origin/main upstream/dev upstream/v2
0e2dd4ad150d0182fc9e43d81424d8db11465977
```

`0e2dd4ad150d0182fc9e43d81424d8db11465977` (`chore: generate`, 2026-06-26) is
the dev/v2 divergence point and also the base shared with Kilo `origin/main`.

Commits ahead of that base, verified 2026-08-13:

| Ref | Commits ahead of `0e2dd4ad` |
|---|---|
| `upstream/dev` | 899 |
| `upstream/v2` | 1470 |
| `origin/main` | 3391 |

Ancestry checks at the time of writing:

```
$ git rev-parse HEAD
76dbaf20adbd43fd208a00ef3cda4a51e125a234
$ git merge-base --is-ancestor 76dbaf20adbd43fd208a00ef3cda4a51e125a234 HEAD; echo $?
0
$ git rev-list --count upstream/v2..HEAD
0
$ git rev-list --count HEAD..upstream/v2
0
```

At baseline capture, `HEAD` was exactly the pinned SHA: the tree carried no Kilo
commits, so every result below is pristine upstream v2. The slice's own commit
sits on top of that; `git rev-list --count upstream/v2..HEAD` is expected to be
non-zero afterwards, while the first two checks must keep holding.

`johnnyeric/kilo-opencode-v2` (the integration branch) also pointed at the
pinned SHA and is checked out in a different worktree; this slice did not touch
it.

## Toolchain

| Tool | This host | Upstream CI at the pin |
|---|---|---|
| bun | 1.3.14 | 1.3.14 (`packageManager` in root `package.json`, via `.github/actions/setup-bun`) |
| node | v22.23.2 | 24 for install/unit; 26.4.0 for the Node build step; 24.15 for e2e |
| git | 2.50.1 (Apple Git-155) | 2.52.0 |
| OS | macOS 26.5.1, Darwin 25.5.0, arm64 | `blacksmith-4vcpu-ubuntu-2404` and `blacksmith-4vcpu-windows-2025` |
| ffmpeg | not installed | installed on Linux by the unit job |

`bun install` reported `5088 packages installed` and left `bun.lock` unchanged
(`git status --porcelain` empty afterwards).

## Authoritative v2 commands

Derived from this tree only — root `package.json`, `turbo.json`,
`.github/workflows/typecheck.yml`, `.github/workflows/test.yml`, and per-package
`package.json` scripts. Kilo main's `packages/opencode` commands do not apply:
that package does not exist on v2.

| Purpose | Command | Working dir |
|---|---|---|
| Install | `bun install` | repo root |
| Typecheck (all packages) | `bun typecheck` (= `bun turbo typecheck --concurrency=3`) | repo root |
| Unit tests (all packages) | `GITHUB_ACTIONS=false bun turbo test` | repo root |
| Generated client contract | `bun run check:generated` | `packages/client` |
| Generated docs/OpenAPI | `bun run check:generated` | `packages/www` |
| CLI binary build | `bun run script/build.ts --single --skip-install` | `packages/cli` |
| Service lifecycle smoke | `bun run script/service-smoke.ts` | `packages/cli` |
| Node CLI build + smoke | `bun run script/build-node.ts --single --skip-install --outdir=dist/node` then `bun run script/service-smoke.ts --node` | `packages/cli` |
| Client regeneration | `bun run generate` | `packages/client` |

Constraints this tree imposes:

- Tests cannot run from the repo root. `bunfig.toml` sets
  `[test] root = "./do-not-run-tests-from-root"` and the root `test` script
  exits 1. Use `bun turbo test` or run from a package directory.
- Typecheck must go through `bun typecheck` / `bun turbo typecheck`, never
  `tsc` directly (root `AGENTS.md`). Packages use `tsgo`.
- `.husky/pre-push` enforces the bun version and runs `bun typecheck`.
- The `e2e` job in `.github/workflows/test.yml` is skipped on the v2 branch by
  its own `if: github.ref_name != 'v2' && github.head_ref != 'v2'`. It is not
  part of the v2 baseline gate.
- `bun run lint`, `bun run lint:effect-patterns`, and `bun run test:lint-rules`
  exist but are not run by any workflow in this tree.

## Results on pristine upstream v2

`GITHUB_ACTIONS=false bun turbo test` was run twice: once as CI runs it, then
once with `--continue` so a single failure would not mask the rest.

| Check | Result | Detail |
|---|---|---|
| `bun install` | pass | 5088 packages, 13.2s, lockfile unchanged |
| `bun typecheck` | pass | 34 of 34 turbo tasks successful, 17.3s |
| `GITHUB_ACTIONS=false bun turbo test` | **fail** | 17/23 tasks successful, stopped at `@opencode-ai/app#test` |
| `GITHUB_ACTIONS=false bun turbo test --continue` | **fail** | 20/23 successful; failures: `@opencode-ai/app#test`, `@opencode-ai/tui#test`, `opencode-drive#test` |
| `packages/client` `bun run check:generated` | pass | no generated drift |
| `packages/www` `bun run check:generated` | pass | no generated drift |
| `packages/cli` build + `service-smoke.ts` | pass | `cli-darwin-arm64` built, smoke exits 0 |
| `bun run lint` | **fail** | 4232 warnings, 1 error (not CI-enforced) |
| `bun run lint:effect-patterns` | **fail** | 33 errors (not CI-enforced) |
| `packages/cli` Node build + `service-smoke --node` | not run | CI pins Node 26.4.0 for this step; this host has Node 22.23.2 |

## Pre-existing failures

None of these were introduced by this slice. Every one reproduced with `HEAD`
exactly at the pinned SHA and no Kilo files in the tree.

### Also red on upstream CI at the pinned SHA

Upstream's own `unit (linux)` and `unit (windows)` checks fail at
`76dbaf20`. Read-only confirmation:

```
$ gh api repos/anomalyco/opencode/commits/76dbaf20adbd43fd208a00ef3cda4a51e125a234/check-runs
unit (linux)      completed  failure
unit (windows)    completed  failure
typecheck         completed  success
build-cli         completed  success
generate          completed  success
e2e               completed  skipped
```

1. **`opencode-drive`**, in `test/instance/config.test.ts`: "instance
   configuration > initializes the simulation provider with the current OpenCode
   provider shape" fails with `SyntaxError: Failed to parse JSON`. Reproduced
   locally and present verbatim in the upstream `unit (linux)` log. This is the
   failure that turns upstream's job red.
2. **`@opencode-ai/tui`**, in `test/mini/footer.view.test.tsx`: "run entry
   content preserves monochrome markdown grammar" expects the ASCII fallback
   `Caf? -> ...` but receives `Café → …`. Reproduced locally and present in the
   upstream `unit (linux)` log at the same SHA.

### Host-environment failures, green on upstream CI

3. **`@opencode-ai/app`**, in `src/i18n/desktop-native.test.ts`: "desktop native
   locale detection > uses Unicode likely subtags for script-sensitive bundles"
   — `detectDesktopNativeLocale(["pa-PK"])` returns `"en"`, expected `"pa"`.
   Root cause is ICU data, not code. `packages/app/src/i18n/desktop-native.ts:158`
   maps `pa` to `pa-Arab-PK` and compares maximized scripts, but this host
   resolves the newer Nastaliq subtag:

   ```
   $ bun -e 'console.log(new Intl.Locale("pa-PK").maximize().toString())'
   pa-Aran-PK
   $ node -e 'console.log(new Intl.Locale("pa-PK").maximize().toString())'
   pa-Arab-PK
   ```

   Upstream `unit (linux)` at the same SHA reports `676 pass / 0 fail` for this
   package; this host reports `675 pass / 1 fail`. Local only.

4. **`opencode-drive`** — three `test/driver/index.test.ts` cases fail with
   `NotFound: ChildProcess.spawn (ffmpeg ...)`. The upstream unit job installs
   ffmpeg on Linux; this host has none. Local only; install ffmpeg to clear
   them, which still leaves failure 1.

### Not gated by CI

5. `bun run lint` (4232 warnings, 1 error) and `bun run lint:effect-patterns`
   (33 errors) are red on pristine v2. No workflow in this tree runs them, so
   they are not a regression signal on their own. Use them only as a delta
   against this baseline.

**Consequence for later slices:** a red `bun turbo test` does not by itself mean
a Kilo change broke something. Compare against this table, and re-run
`bun kilocode/script/v2-baseline.ts --checks` from a clean checkout of the
pinned SHA when a failure is ambiguous.

## Why no fork CI workflow yet

`.github/workflows/` is upstream-owned and this slice adds no workflow file,
deliberately:

- This effort is local-only by explicit instruction. Nothing is pushed, so no
  workflow added here could actually run; committing one would claim CI
  coverage that does not exist.
- The baseline is already red upstream (failures 1 and 2). A fork workflow
  running the same commands would be red on its first run, which is a worse
  signal than this report plus the reproducer script.
- The integration branch `johnnyeric/kilo-opencode-v2` has no remote yet, so a
  workflow has no meaningful trigger to target. `test.yml` and `typecheck.yml`
  trigger on `push` to `dev`/`v2` and on `pull_request`; adapting them needs the
  fork's branch and remote model to exist first.
- Editing shared upstream workflow files conflicts on every upstream merge and
  is exactly what the fork conventions try to avoid.

Revisit when the integration branch gets a remote. At that point the smallest
useful step is a Kilo-owned workflow that runs
`bun kilocode/script/v2-baseline.ts --checks` and compares against this report,
not a copy of upstream's `test.yml`.

## Reproducer

`kilocode/script/v2-baseline.ts` is the automation for this report.

```
bun kilocode/script/v2-baseline.ts            # offline ref and ancestry checks only
bun kilocode/script/v2-baseline.ts --checks   # also replay the commands above
```

It asserts the pinned SHA is still an ancestor of `HEAD` and that local
`upstream/v2` still resolves to it, then runs the install, typecheck, test,
generated-artifact, and CLI build/smoke commands, writing per-check output to
`kilocode/baseline/logs/` (gitignored by the root `logs/` rule). It exits
non-zero if any check fails; it never suppresses a known-red check, because
suppression would hide a real regression behind a pre-existing one.

`kilocode/script/` is intentionally not a workspace package, so the script is
not covered by `bun typecheck`: every typecheck project in this repo lives
inside a workspace, and `@types/bun` is only installed in packages that declare
it. Making `kilocode/` a workspace would mean editing upstream's root
`package.json` for one script. It is validated by running it in both modes
instead. Revisit if `kilocode/script/` grows beyond a couple of files.
