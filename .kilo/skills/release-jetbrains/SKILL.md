---
name: release-jetbrains
description: Use when releasing the Kilo JetBrains plugin -- resolve a version ("next rc" or explicit), run the prepare workflow, edit and commit a filtered human-readable changelog on the release PR, then watch publish to completion.
---

# JetBrains Release

Use this skill when releasing the Kilo JetBrains plugin.

This skill drives the existing JetBrains release workflows. It must not move, delete, or recreate JetBrains release tags. It must always confirm the resolved version with the user before dispatching the prepare workflow because the prepare workflow creates an immutable `jetbrains/v<version>` tag.

## Preconditions

- Run from the repository root.
- `gh` must be authenticated for `Kilo-Org/kilocode` with permission to dispatch workflows, read PRs, and write contents. Merge permission is only required if the user asks the skill to merge the release PR automatically.
- Check auth with `gh auth status`. For GitHub CLI OAuth, refresh common release scopes with `gh auth refresh -s repo -s workflow`; `repo` covers private-repo contents and PR operations, and `workflow` allows workflow dispatch. If using a fine-grained token instead, grant repository permissions for Actions read/write, Contents read/write, and Pull requests read/write. Merging still requires normal repository collaborator permission or a token/user allowed by branch protection.
- Reference `packages/kilo-jetbrains/RELEASING.md` for manual recovery rules.
- Do not locally check out the generated release branch. The helper scripts update the release branch through GitHub to avoid disturbing the current worktree.

## Version Resolution

Resolve the user's version request:

```bash
bun .kilo/skills/release-jetbrains/script/resolve-version.ts --spec "next rc"
```

Accepted specs:

| Spec | Meaning |
|---|---|
| `next rc` | If the latest JetBrains tag is an RC, increment its `rc.n`; otherwise start the next patch RC at `rc.1`. |
| `next stable` | If the latest JetBrains tag is an RC, use its base version; otherwise use the next patch stable. |
| `x.y.z-rc.n` | Explicit RC release. |
| `x.y.z` | Explicit stable release. |

Show the resolved `version`, `kind`, and default `fromTagDefault` to the user.

## CLI Pin Verification

Before dispatching prepare, verify the JetBrains plugin is pinned to the intended Kilo Core release. The plugin downloads the CLI version from `packages/kilo-jetbrains/package.json`, not from the JetBrains plugin version. Prepare tags `origin/main`, so the authoritative pin is the value on `origin/main`, not a local edit.

Run the pin preflight:

```bash
bun .kilo/skills/release-jetbrains/script/check-pin.ts
```

The script prints:

| Field | Meaning |
|---|---|
| `pinMain` | CLI version that `origin/main` will lock into the release tag. |
| `pinLocal` | CLI version in the current worktree, useful for catching stale local checkouts. |
| `latestCli` | Latest stable `v*` Kilo CLI GitHub release. |
| `prevJetbrainsCli` | CLI pin used by the latest `jetbrains/v*` release tag, for reviewing the jump. |
| `pinnedMain` / `pinnedLocal` | Whether `kilo.cli.pinned=true`; `false` means repo CLI dev mode. |
| `assetsOk` / `missingAssets` | Whether the pinned CLI release has every runtime asset. |
| `drift` | `up-to-date`, `behind`, `worktree-behind-main`, `repo-mode-on-main`, `repo-mode-local`, or `assets-missing`. |

Interpretation:

| Drift | Action |
|---|---|
| `up-to-date` | Continue after user confirmation. |
| `behind` | Stop and show `pinMain`, `latestCli`, and `prevJetbrainsCli`; ask whether to cancel, bump + test, or proceed anyway. |
| `worktree-behind-main` | Explain that prepare tags `origin/main`; refresh the worktree or rely on `pinMain` in the confirmation. |
| `repo-mode-on-main` | Stop. `kilo.cli.pinned=false` is dev-only and must be reset to `true` on `main` before release. |
| `repo-mode-local` | Stop or reset local `kilo.cli.pinned=true`; release checks should run from a releasable local state. |
| `assets-missing` | Stop. The pinned CLI release is incomplete and would fail runtime download. |

Show the resolved JetBrains plugin version, release kind, default `fromTagDefault`, `pinMain`, `latestCli`, `prevJetbrainsCli`, and `assetsOk` to the user, then ask for confirmation before continuing. If the user wants a different CLI pin, use the bump workflow below and do not dispatch prepare until the bump is merged to `main`.

## Bump the CLI Pin

Use this only when the user wants to test or release with a different CLI than `origin/main` currently pins. The helper refuses versions whose GitHub release or runtime assets are missing.

Local test edit only:

```bash
bun .kilo/skills/release-jetbrains/script/set-pin.ts --latest
# or
bun .kilo/skills/release-jetbrains/script/set-pin.ts --version 7.4.1
```

Then test from `packages/kilo-jetbrains/`:

```bash
./gradlew typecheck
./gradlew test
```

If the user confirms the tested pin should be released, open or update a pin bump PR to `main`:

```bash
bun .kilo/skills/release-jetbrains/script/set-pin.ts --latest --pr
# or
bun .kilo/skills/release-jetbrains/script/set-pin.ts --version 7.4.1 --pr
```

After that PR merges to `main`, re-run `resolve-version.ts`, re-run `check-pin.ts`, confirm `drift=up-to-date`, then dispatch prepare. Do not dispatch prepare from a local-only pin edit; the prepare workflow tags `origin/main`.

## Prepare Workflow

After confirmation, dispatch and watch the prepare workflow:

```bash
bun .kilo/skills/release-jetbrains/script/dispatch-prepare.ts --kind rc --version 7.0.1-rc.7
```

Pass a generous Bash timeout, such as `1800000` ms, because the script blocks on `gh run watch --exit-status`. If the shell times out but the workflow is still running, re-attach with:

```bash
bun .kilo/skills/release-jetbrains/script/dispatch-prepare.ts --kind rc --version 7.0.1-rc.7 --run-id <run-id>
```

The script prints `prNumber`, `prUrl`, `runUrl`, and `branch` on success. Immediately show the `prUrl` to the user so they can open the release PR without asking for it later.

## Changelog Draft

Create a changelog draft after the prepare PR exists:

1. Read the PR body with `gh pr view <pr> --json body`.
2. Extract `JetBrains-From-Tag`, `JetBrains-Tag`, and `## Generated Notes`.
3. Fetch the release range tags if they are missing locally:

```bash
git fetch origin refs/tags/<from-tag>:refs/tags/<from-tag> refs/tags/<tag>:refs/tags/<tag>
```

4. Use the release range and path filter as the primary relevance signal:

```bash
git log --oneline <from-tag>..<tag> -- packages/opencode packages/kilo-jetbrains
```

Keep JetBrains and CLI/runtime changes. Drop unrelated VS Code, docs, gateway, telemetry, i18n, desktop, and webview-only changes unless they affect the CLI bundled into the JetBrains plugin.

Rewrite terse commit or PR titles into user-facing bullets grouped under `### Added`, `### Fixed`, and `### Changed`. Keep the exact generated header format:

```markdown
## [<version>] - <date>
```

Write the editable draft to:

```text
packages/kilo-jetbrains/build/release/<version>-changelog.md
```

Include source context in an HTML comment so it is easy to edit but not shipped:

```markdown
<!-- CONTEXT - deleted automatically on commit. Source PRs in range:
- #1234 feat(jetbrains): ... https://github.com/Kilo-Org/kilocode/pull/1234
- #1235 fix(cli): ... https://github.com/Kilo-Org/kilocode/pull/1235
-->
```

Ask the user to edit the file and confirm when done.

## Commit Changelog

After the user confirms the draft is ready, strip the `<!-- CONTEXT ... -->` block into a temporary cleaned file, then commit the cleaned section to the release branch:

```bash
bun .kilo/skills/release-jetbrains/script/update-changelog.ts --version 7.0.1-rc.7 --file /path/to/clean-section.md
```

The script updates `packages/kilo-jetbrains/CHANGELOG.md` on `jetbrains/release/v<version>` through the GitHub contents API and commits with:

```text
docs(jetbrains): edit changelog for v<version>
```

If `update-changelog.ts` fails with `gh: Not Found (HTTP 404)`, verify the release branch and changelog path with:

```bash
gh api "repos/Kilo-Org/kilocode/contents/packages/kilo-jetbrains/CHANGELOG.md?ref=jetbrains/release/v<version>"
```

Then either fix and retry the helper, or perform the equivalent contents API update using `ref` in the query string.

After the changelog commit succeeds, show the release PR URL again and tell the user that the PR needs manual approval and merge before publishing can continue.

## Approve And Publish

Ask the user to approve the release changelog and metadata. Before merging or publishing, verify the PR approval and required checks are green:

```bash
gh pr view <pr> --json mergeStateStatus,reviewDecision,statusCheckRollup
gh pr checks <pr> --watch --interval 10
```

Do not merge or publish while required checks are failing unless the user explicitly gives a maintainer override.

If a required check fails from an apparent flake, rerun only the failed jobs and wait for the run to finish:

```bash
gh run rerun <run-id> --failed
gh run watch <run-id> --exit-status
```

By default, have the user merge the release PR manually in GitHub, then watch the publish workflow:

```bash
bun .kilo/skills/release-jetbrains/script/watch-publish.ts --pr <number> --version 7.0.1-rc.7
```

Only merge automatically when the user explicitly asks for it and `gh` has merge permission:

```bash
bun .kilo/skills/release-jetbrains/script/watch-publish.ts --pr <number> --version 7.0.1-rc.7 --merge
```

Pass a generous Bash timeout, such as `1800000` ms. If the shell times out, re-attach with:

```bash
bun .kilo/skills/release-jetbrains/script/watch-publish.ts --pr <number> --version 7.0.1-rc.7 --run-id <run-id>
```

If `watch-publish.ts --merge` reports that the PR is already merged, or a transient GitHub API `5xx` interrupts publish-run discovery, rerun without `--merge`:

```bash
bun .kilo/skills/release-jetbrains/script/watch-publish.ts --pr <number> --version <version>
```

Report the Marketplace channel and GitHub Release URL. RC versions publish to the `eap` channel; stable versions publish to the default Marketplace channel.

## Recovery

- If prepare created the tag but failed before creating a PR, rerun prepare for the same version. The existing workflow reuses the tag if it points to the same commit.
- If a tag points to an unexpected SHA, stop and inspect manually. Do not move or delete release tags casually.
- If prepare tagged an unintended CLI pin, do not move the tag. Land the intended pin on `main`, resolve the next JetBrains version, and create a new release tag.
- If release PR checks fail from an apparent flake, use `gh run rerun <run-id> --failed`, then `gh run watch <run-id> --exit-status` before publishing.
- If publish fails after merge, rerun the failed workflow only if Marketplace did not already accept the version.
- If Marketplace succeeds but GitHub Release upload fails, manually create or edit the GitHub Release for `jetbrains/v<version>` using the reviewed changelog.
