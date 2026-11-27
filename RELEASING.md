# Releasing Kilo Code

Kilo Code uses a fully automated CI pipeline triggered via GitHub Actions `workflow_dispatch`. A single workflow handles version bumping, building all artifacts, publishing to every distribution channel, and updating package registries.

## How to Trigger a Release

1. Go to the [`publish` workflow](https://github.com/Kilo-Org/kilocode/actions/workflows/publish.yml) in GitHub Actions.
2. Click **"Run workflow"**.
3. Select the `main` branch. On any other branch the `version` job fails in its first step, before it creates the draft release, and the `publish` job runs in the `release` environment, which only accepts `main`.
4. Fill in the inputs:
   - **`bump`** (choice): `patch`, `minor`, or `major`. Determines how the version number is incremented.
   - **`version`** (string, optional): Override the version explicitly instead of using `bump`. Leave empty to use the bump-based calculation.
   - **`oidc_check`** (boolean, default off): Only check VS Code Marketplace trusted publishing. See [Checking Marketplace Trusted Publishing](#checking-marketplace-trusted-publishing).

   > **⚠️ Do not fill in `version` unless you have a specific reason to.**
   > The default behavior — leaving `version` empty and selecting a `bump` level — is almost always what you want. The automated bump logic computes the correct next version from the current state of the repo. Only use the `version` override for exceptional cases like skipping versions or publishing a pre-release (e.g. `1.5.0-beta.1`).

5. Click **"Run workflow"** to start the release.

## What Happens During a Release

The `publish.yml` workflow starts with `version`, which creates the draft release before the build and publish jobs run. The main jobs are:

### 1. Version (`version`)

- Checks out the repo with full history (`fetch-depth: 0`).
- Runs `script/version.ts` to compute the next version based on the `bump` or `version` input.
- Generates release notes from the commit history since the last release.
- Creates a **draft** GitHub Release with the computed tag (e.g. `v1.2.3`) and release notes.
- Outputs the `version`, `release` (database ID), and `tag` for downstream jobs.

### 2. Build CLI (`build-cli`)

- Runs `packages/opencode/script/build.ts` to compile the Kilo CLI binary.
- Builds native binaries for **all supported platforms and architectures**:
  - Linux: x64, arm64 (glibc and musl), plus baseline (non-AVX2) variants
  - macOS: x64, arm64, plus baseline variants
  - Windows: x64 (plus baseline variant), arm64
- Patches ELF interpreters on Linux binaries for broad compatibility.
- Creates platform archives (`.tar.gz` for Linux, `.zip` for macOS/Windows) with SBOM sidecars, an evidence manifest and a checksum file.
- Uploads the `dist/` directory as a workflow artifact (`kilo-cli`) for subsequent jobs.

### Sign, describe and upload the CLI (`sign-cli-windows`, `sbom-cli-windows`, `upload-cli`, `attest-cli`)

- `sign-cli-windows` EV-signs the Windows executables and packages the Windows zips the release ships from them, recording their digests.
- `sbom-cli-windows` describes the signed zips again: new SBOM sidecars, manifest entries and checksum lines. Every other evidence file stays as `build-cli` wrote it.
- `upload-cli` checks every archive and evidence file against the digests recorded by the job that produced it, then uploads them to the draft GitHub Release.
- `attest-cli` attests each archive's SBOM under the digest of the uploaded bytes (the signed digest for the Windows zips).

### 3. Build VS Code Extension (`build-vscode`)

- Downloads the CLI artifacts from the previous job.
- Runs `packages/kilo-vscode/script/build.ts` to build VSIX packages for all target platforms:
  - `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`
- Each VSIX bundles the platform-specific CLI binary.
- Uploads the VSIX files as a workflow artifact (`kilo-vscode`).

### 4. Publish (`publish`)

Downloads all build artifacts and publishes to every distribution channel, in this order. Every write to the GitHub Release and the checks before publishing it address it by the release id the `version` job recorded; the smoke test downloads assets by tag.

#### Release Assets on the Draft

- Checks the downloaded CLI dist and VS Code packages against the digests their jobs recorded.
- Uploads the VSIX files and their SBOM evidence to the draft GitHub Release.
- Checks that the draft holds exactly the CLI assets of the checked evidence manifest and the VS Code files `build-vscode` recorded. Distribution evidence that a failed earlier run left on the draft is removed first; it is uploaded again later.

#### Version Commit and Tagging

- Updates the `version` field in all `package.json` files across the monorepo.
- Updates the Zed extension manifest (`extension.toml`) with the new version.
- Rebuilds the TypeScript SDK (`packages/sdk/js`).
- Commits the version bump, tags the commit, and pushes to the repo. If an earlier run already pushed them (tag `v<version>` on origin, pointing at a commit on `main` whose `packages/opencode/package.json` has that version), this is skipped; any other existing tag fails the run. If only the tag is missing but the `release: v<version>` commit with that version is among the last 100 commits on `main`, that commit is tagged instead of committing again. If neither is found but `main` already has the version, the run fails without committing.

#### CLI (`@kilocode/cli`)

- Packs the platform-specific binary packages (e.g. `@kilocode/cli-linux-x64`) and the main `@kilocode/cli` package, and describes each exact tarball.
- Builds and pushes a multi-arch **Docker image** (`ghcr.io/kilo-org/kilocode`) to GitHub Container Registry (linux/amd64 + linux/arm64).
- Builds and pushes the image's **OpenShell variant** (`ghcr.io/kilo-org/kilocode:<version>-openshell` and `:latest-openshell`) from the Dockerfile's `openshell` stage, for the same platforms.
- Uploads the npm and container SBOM evidence to the draft, checks the complete draft again (every expected asset, each with its recorded digest, nothing else) and only then publishes the GitHub Release with its notes. No asset is uploaded after this, so the published release never changes.
- Publishes the packed tarballs to **npm**: the platform packages, then `@kilocode/cli`. The installer and `kilo upgrade` take the version from npm and download the archives from the GitHub Release, so npm gets the version only once the release is public.

#### SDK (`@kilocode/sdk`)

- Builds and publishes the TypeScript SDK to **npm**.

#### Plugin (`@kilocode/plugin`)

- Builds and publishes the plugin interface package to **npm**.

#### VS Code Extension

- Publishes platform-specific VSIX packages to the **VS Code Marketplace** via `vsce publish --oidc`. The `publish` job runs in the `release` GitHub Actions environment, and the `kilocode` publisher trusts `Kilo-Org/kilocode`'s `publish.yml` workflow in that environment, so no Marketplace token is stored.
- Publishes the same packages to **Open VSX** via `ovsx publish --trusted-publishing`, using GitHub Actions OIDC instead of a PAT.

### 5. AUR and Homebrew (`package-managers`, stable releases only)

Runs after `publish`, once the release is public, in the `release-keys` environment. It installs no packages and runs only `script/kilocode/package-managers.ts` on Node. It reads the AUR key and the kilo-maintainer app key from the STS bundle of `ci-kilocode-release` (see `.github/actions/kilo-credentials/README.md`), and takes the archive digests from the CLI evidence manifest `build-cli` recorded, after checking that manifest's digest.

- **AUR (Arch Linux)**: Clones `kilo-bin` from the AUR over SSH (host keys pinned in the script), writes the `PKGBUILD` and `.SRCINFO` with the new version and SHA256 checksums, and pushes.
- **Homebrew**: Clones `Kilo-Org/homebrew-tap` with an app token that may write only that repository, updates the `kilo.rb` formula with the new version, download URLs, and SHA256 checksums, and pushes.

Each update is retried from a new clone up to three times. A repository that already has the files of this version is left unchanged, so the job can be re-run on its own (**Re-run failed jobs**). A failure fails the job but does not touch the release or the npm packages.

### Recovering from a Failed `publish` Job

Re-run the failed `publish` job (**Re-run failed jobs**); the build jobs and their recorded digests are reused.

- **Failed before the release was published** (for example the evidence upload or the second draft check): the GitHub Release is still a draft. The Docker images may already be pushed. The re-run skips the version commit and tag if they were pushed, removes leftover distribution evidence from the draft, packs and describes the npm packages again, rebuilds and pushes the images, uploads the evidence, checks the draft and publishes it. npm has nothing yet: packages are published only after the release.
- **Failed after the release was published** (for example an npm publish): the re-run uploads nothing and does not touch the release. It checks the published assets (the CLI and VS Code assets against their recorded digests, the distribution evidence against its own manifest), skips the Docker builds, skips npm packages that are already published, and packs the others again; each tarball must have the digest the published evidence names, or the run stops before publishing it. The `package-managers` job runs again after it.

### Fixing a Bad Release

Immutable releases are turned on for this repository: once a GitHub Release is published, its tag and assets can no longer be changed or deleted. A bad release is fixed by publishing a new version (for example a patch bump), not by editing or replacing the published release. Drafts stay editable until they are published, which is why every asset is uploaded and checked before the release is published.

## Prerequisites and Permissions

### Repository Access

- The workflow only runs in the `Kilo-Org/kilocode` repository (guarded by `if: github.repository == 'Kilo-Org/kilocode'`).
- You must have **write access** to the repository to trigger a `workflow_dispatch` event.

### Workflow Permissions

The workflow requires these GitHub token permissions:

- `id-token: write` -- for VS Code Marketplace and Open VSX Trusted Publishing, and npm provenance attestation
- `contents: write` -- for creating releases, pushing tags, and uploading assets
- `packages: write` -- for publishing Docker images to GHCR

### Open VSX Trusted Publishing

Before publishing the stable extension `kilocode.kilo-code`, configure its Open VSX trusted publisher registration to match the `publish` job:

- Repository: `Kilo-Org/kilocode`
- Workflow filename: `publish.yml`
- Environment name: `release`

The `publish` job inherits the workflow's `id-token: write` permission. The Open VSX client is installed from `bun.lock` and uses `--trusted-publishing` to authenticate without a PAT. The shared GitHub secret `OVSX_TOKEN` and its registry token are retained for other consumers; this workflow no longer uses them.

### Required Secrets

The following secrets must be configured in the repository. The VS Code Marketplace needs no secret (see [Checking Marketplace Trusted Publishing](#checking-marketplace-trusted-publishing)). The AUR key and the kilo-maintainer app key of the `package-managers` job come from Kilo STS, not from GitHub secrets.

| Secret | Purpose |
|---|---|
| `KILO_API_KEY` | Kilo Gateway key for the pre-publish smoke test (`smoke-test.yml`) |
| `KILO_ORG_ID` | Kilo organization ID for the pre-publish smoke test |
| `BENCH_GITHUB_TOKEN` | Read access to `Kilo-Org/kilo-bench` for the pre-publish smoke test |
| `KILO_MAINTAINER_APP_SECRET` | GitHub App private key for the kilo-maintainer bot (release commit, tag, draft release and JetBrains pin PR in the `publish` job) |
| `NPM_TOKEN` | npm authentication token for publishing packages |

The repository variable `KILO_MAINTAINER_APP_ID` holds the kilo-maintainer app id, which is public.

### Environments

| Environment | Jobs | Purpose |
|---|---|---|
| `release` | `publish`, `oidc-check` | npm, VS Code Marketplace and Open VSX trusted publishing |
| `release-keys` | `package-managers` | The only environment the STS policy `ci-kilocode-release` accepts; no other job of the workflow may use it (see `.github/actions/kilo-credentials/README.md`) |

Both allow only `main`.

### Concurrency

The workflow's concurrency group is `<workflow>-<ref>-<version or bump>`, so a second run for the same branch and version or bump waits for the first instead of running in parallel (a newer waiting run replaces an older one).
A trusted publishing check (`oidc_check`) uses `<workflow>-<ref>-oidc-check`, so it never queues behind or cancels a release.

### Checking Marketplace Trusted Publishing

The VS Code Marketplace publisher `kilocode` has a trusted publishing policy for the `Kilo-Org/kilocode` repository, the `publish.yml` workflow, and the `release` environment. If you rename the workflow file or the environment, update the policy in the Marketplace publisher management page first.

To check the policy without building or publishing anything, run the `publish` workflow on `main` with **`oidc_check`** enabled. Only the `oidc-check` job runs: it exchanges the GitHub OIDC token for a short-lived Marketplace credential, the same way `vsce publish --oidc` does, and asks the Marketplace for that credential's roles on `kilocode` (the request `vsce verify-pat kilocode` makes). It uses only `curl` and `jq` from the runner image. All other jobs are skipped.

A green check proves that the trust policy matches this repository, workflow, and environment, and that the Marketplace accepts the credential for `kilocode`. It does not prove upload rights, because the role check passes for any role on the publisher. The first real release proves the upload.
