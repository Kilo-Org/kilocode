# Releasing the JetBrains Plugin

JetBrains releases are locked by an immediate `jetbrains/v<version>` tag, then gated by a reviewed release PR. The tag fixes the exact source code that will be published; the PR is where maintainers review and edit the version and changelog before publishing starts.

The published code comes from `jetbrains/v<version>`. Marketplace and GitHub release notes come from the reviewed changelog merged in the release PR.

## Skill-Assisted Release

Maintainers can use the Kilo `release-jetbrains` skill to drive this process from a version request such as `next rc` or an explicit version. The skill resolves and confirms the version, dispatches and watches the prepare workflow, helps produce a filtered human-readable JetBrains/CLI changelog draft, commits the reviewed changelog to the release PR, and watches publishing after the PR is merged.

JetBrains plugin builds and runtime downloads use the Kilo Core version pinned in `packages/kilo-jetbrains/package.json`, so verify that pin points at a published `v<version>` release before creating the release tag.

`kilo.cli.pinned=false` in `packages/kilo-jetbrains/gradle.properties` is local development mode only. It generates the client from `packages/opencode/` and bundles a locally built CLI into the plugin; production Gradle builds and release scripts fail until the property is restored to `true`.

The skill lives at `.kilo/skills/release-jetbrains/SKILL.md`. It does not move or recreate release tags, and merge permission is only required if the user explicitly asks the skill to merge the release PR automatically.

## CLI Pin Review

The JetBrains plugin has two independent versions:

| Field | Meaning |
|---|---|
| `packages/kilo-jetbrains/package.json` `version` | The pinned Kilo CLI release used for OpenAPI generation and runtime downloads. |
| `packages/kilo-jetbrains/gradle.properties` `kilo.jetbrains.version` | The JetBrains Marketplace plugin version. |

The prepare workflow tags `origin/main`, so the CLI pin that matters is the one already merged to `main`. Before creating a release tag, run:

```bash
bun .kilo/skills/release-jetbrains/script/check-pin.ts
```

The script reports the CLI that `origin/main` will lock, the latest published stable CLI release, the CLI shipped by the latest `jetbrains/v*` tag, whether `kilo.cli.pinned=true`, and whether all runtime assets exist. Stop before tagging if the pin is behind the latest CLI and you want to test the newer CLI first.

To test a different CLI pin locally:

```bash
bun .kilo/skills/release-jetbrains/script/set-pin.ts --latest
cd packages/kilo-jetbrains
./gradlew typecheck
./gradlew test
```

To land the tested pin on `main` before releasing:

```bash
bun .kilo/skills/release-jetbrains/script/set-pin.ts --latest --pr
```

Merge the generated pin PR first, then re-run `check-pin.ts` and dispatch prepare. Do not dispatch prepare from a local-only pin edit.

Stable CLI releases also try to open this pin bump PR automatically after publishing. The PR is labeled `jetbrains-cli-pin-bump`. Release publishing does not fail if creating the PR fails; inspect the publish log for either the PR URL or the warning with manual follow-up instructions.

## Create Release Tag And PR

1. Open the GitHub Actions workflow:

[https://github.com/Kilo-Org/kilocode/actions/workflows/prepare-jetbrains-release.yml](https://github.com/Kilo-Org/kilocode/actions/workflows/prepare-jetbrains-release.yml)

2. Click **Run workflow**. This immediately creates `jetbrains/v<version>` at the current `origin/main` commit, then creates or updates the release PR.

3. Fill the inputs:

| Input | Value |
|---|---|
| `kind` | `rc` for an EAP release, `stable` for a default Marketplace release. |
| `version` | `x.y.z-rc.n` for RCs, `x.y.z` for stable releases. |
| `from_tag` | Optional previous tag for the changelog range. Leave empty unless the default range is wrong. |

Examples:

```text
kind=rc
version=7.3.13-rc.1
```

```text
kind=stable
version=7.3.13
```

## Changelog Range Defaults

The workflow chooses a changelog base automatically and generates notes against the locked release commit:

| Release | Default `from_tag` |
|---|---|
| First RC for a version, e.g. `7.3.13-rc.1` | Latest stable JetBrains tag. |
| Later RC, e.g. `7.3.13-rc.2` | Previous RC for the same base version. |
| Stable, e.g. `7.3.13` | Latest stable JetBrains tag, ignoring RCs. |

Use `from_tag` only to override this comparison range. It does not change the release target commit.

For the first stable JetBrains release, there may be no previous stable tag yet. In that case, pass the last RC or another reviewed JetBrains tag as `from_tag`.

## Review the PR

The workflow creates or updates a branch like:

```text
jetbrains/release/v7.3.13-rc.1
```

The PR updates:

| File | Purpose |
|---|---|
| `packages/kilo-jetbrains/gradle.properties` | JetBrains plugin version in `kilo.jetbrains.version`. |
| `packages/kilo-jetbrains/CHANGELOG.md` | Release notes packaged into the plugin. |

Review `packages/kilo-jetbrains/gradle.properties` and edit `packages/kilo-jetbrains/CHANGELOG.md` before merging. This changelog entry is rendered into JetBrains `<change-notes>`, so it appears on the Marketplace and inside IntelliJ plugin UI.

The PR can change release metadata such as `packages/kilo-jetbrains/gradle.properties` and `packages/kilo-jetbrains/CHANGELOG.md`, but it does not change the tagged source code that will be built.

## Merge and Publish

When the release PR is merged, the `publish-jetbrains` workflow validates the existing tag and release PR markers:

```text
jetbrains/v<version>
```

Then it publishes from that tag:

[https://github.com/Kilo-Org/kilocode/actions/workflows/publish-jetbrains.yml](https://github.com/Kilo-Org/kilocode/actions/workflows/publish-jetbrains.yml)

Publishing behavior:

| Version | Marketplace channel | GitHub release |
|---|---|---|
| `x.y.z-rc.n` | `eap` | Prerelease |
| `x.y.z` | default | Stable release |

The workflow checks out `jetbrains/v<version>` for verification, signing, and Marketplace publishing. It overlays the reviewed `packages/kilo-jetbrains/gradle.properties` and `packages/kilo-jetbrains/CHANGELOG.md` from the merged PR before rendering release notes and before `publishPlugin`, so the Marketplace plugin version, Marketplace notes, and GitHub Release use the reviewed metadata.

## Installing RC Builds

RC builds are published to the `eap` channel. To get them in IntelliJ IDEA:

1. Open **Settings > Plugins**.
2. Click the gear icon and choose **Manage Plugin Repositories**.
3. Add the following URL:

```text
https://plugins.jetbrains.com/plugins/list?channel=eap&pluginId=28350
```

4. Search for **Kilo Code** in the Marketplace tab.

## Manual Recovery

If the prepare workflow created the tag but failed before creating or updating the PR, rerun the workflow for the same version. It reuses the tag if it still points to the same locked commit.

If publish validation says the tag points to the wrong SHA, stop and inspect manually. Do not move, delete, or recreate release tags casually.

If publish failed after merge, rerun the failed `publish-jetbrains` workflow if the failure happened before Marketplace accepted the version. Marketplace may reject a duplicate version after a successful publish.

If Marketplace publishing succeeded but GitHub Release upload failed, manually create or edit the GitHub Release for the existing tag. Use the reviewed release notes from `packages/kilo-jetbrains/CHANGELOG.md` in the merged release PR.

If the immediate tag must be created manually because the prepare workflow could not push it, create it at the intended locked `origin/main` commit before merging the release PR:

```bash
git fetch origin main
git tag jetbrains/v7.3.13 <locked-main-sha>
git push origin jetbrains/v7.3.13
```

## Required GitHub Actions Secrets

| Secret | Purpose |
|---|---|
| `KILO_MAINTAINER_APP_ID` | GitHub App ID used to create/update release PRs and immediate release tags. |
| `KILO_MAINTAINER_APP_SECRET` | GitHub App private key used to create/update release PRs and immediate release tags. |
| `JETBRAINS_MARKETPLACE_TOKEN` | Marketplace API token for publishing. |
| `JETBRAINS_CERTIFICATE_CHAIN` | PEM certificate chain for plugin signing. |
| `JETBRAINS_PRIVATE_KEY` | PEM private key for plugin signing. |
| `JETBRAINS_PRIVATE_KEY_PASSWORD` | Password for the private key. |

Before the first publish, complete `RELEASE_TODO.md` to set up these secrets and the Marketplace plugin entry.
