# Releasing Kilo Code

Kilo Code uses a fully automated CI pipeline triggered via GitHub Actions `workflow_dispatch`. A single workflow handles version bumping, building all artifacts, publishing to every distribution channel, and updating package registries.

## How to Trigger a Release

1. Go to the [`publish` workflow](https://github.com/Kilo-Org/kilocode/actions/workflows/publish.yml) in GitHub Actions.
2. Click **"Run workflow"**.
3. Select the `main` branch. On any other branch the `release-draft` job fails in its first step, before it creates the draft release, and the `publish` job runs in the `release` environment, which only accepts `main`.
4. Fill in the inputs:
   - **`bump`** (choice): `patch`, `minor`, or `major`. Determines how the version number is incremented.
   - **`version`** (string, optional): Override the version explicitly instead of using `bump`. Leave empty to use the bump-based calculation.
   - **`oidc_check`** (boolean, default off): Only check VS Code Marketplace trusted publishing. See [Checking Marketplace Trusted Publishing](#checking-marketplace-trusted-publishing).

   > **⚠️ Do not fill in `version` unless you have a specific reason to.**
   > The default behavior — leaving `version` empty and selecting a `bump` level — is almost always what you want. The automated bump logic computes the correct next version from the current state of the repo. Only use the `version` override for exceptional cases like skipping versions or publishing a release candidate (e.g. `1.5.0-rc.1`, with `pre_release` on). `release-draft` accepts only `x.y.z` and `x.y.z-rc.n`, the forms the JetBrains CLI pin accepts.

5. Click **"Run workflow"** to start the release.

## What Happens During a Release

The `publish.yml` workflow starts with `release-draft`, which decides the version and creates the draft release before the build and publish jobs run. The main jobs are:

### 1. Version and draft release (`release-draft`)

- `release-draft` is the only job that decides the version. It holds the job token with `contents: write`, installs nothing and stops first unless the workflow runs on `main`.
- Without a `version` input, `script/kilocode/release-draft.ts` takes the `bump` (default patch) of the highest `vx.y.z` among origin's tags and the tag names of every release, drafts included. The one exception is the draft this workflow run created on an earlier attempt, which a re-run of the job reuses. An orphan draft of an earlier run therefore counts: the next run bumps past it.
- A `version` input must be `x.y.z` or `x.y.z-rc.n` (`-rc.n` only with `pre_release`), must not be a tag or a release yet, and its `x.y.z` must be above the highest version.
- It looks the tag up once more and then creates the **draft** GitHub Release with the tag name (e.g. `v1.2.3`); the notes are written when the release is published. Any doubt (an existing tag or release, an error other than "not found") stops here, before any build.
- `release-draft` outputs the `version`, `release` (database ID), and `tag` for every later job.

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
- `smoke-cli` (job token `contents: write`, nothing checked out or installed) downloads `kilo-linux-x64.tar.gz` from the draft by its release id, checks it against the digest the CLI evidence manifest records and hands it to the smoke test (`smoke-test.yml`, read access only) as an artifact with that digest, which the smoke test checks again. While the bench is waived (`WAIVE_BENCH` at the top of `publish.yml`), `smoke-cli` is skipped and the smoke test only records the exception.

### 3. Build VS Code Extension (`build-vscode`)

- Downloads the CLI artifacts from the previous job.
- Runs `packages/kilo-vscode/script/build.ts` to build VSIX packages for all target platforms:
  - `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`
- Each VSIX bundles the platform-specific CLI binary.
- Uploads the VSIX files as a workflow artifact (`kilo-vscode`).

### 4. Release Commit (`release-commit`, then `release-push`)

- `release-commit` runs right after `release-draft`, holds no secret and no OIDC permission, and checks out the dispatch commit with its commit history. It updates the `version` field in the `package.json` files (not the JetBrains CLI pin, and none under `.github/`, `script/`, `bin/` or `nix/`), updates the Zed extension manifest (`extension.toml`), consumes the changesets into the changelogs, updates `bun.lock`, and commits only those changes as `release: v<version>` with the tag `v<version>`. Other changes in the working tree, tracked or new, stay out of the commit, with a warning. It uploads the commit and tag as a git bundle (artifact `release-commit`) and records the bundle's sha256.
- `release-push` runs once every check before publishing has passed (the validation jobs, the smoke test and `release-assets`' check of the draft), in the `release-keys` environment, and installs nothing. It checks the bundle's sha256 and the bundled commit (see "Release commit check" in `.github/actions/kilo-credentials/README.md`): one parent, the dispatch commit; only version and changelog lines and paths. It then writes the release commit itself from the checked tree (parent the dispatch commit, the kilo-maintainer identity) and pushes it to `main` with the tag in one atomic push, with the kilo-maintainer app key from the STS bundle of `ci-kilocode-release`. If `main` moved since the dispatch, it merges `main` and the release commit with git alone, refuses a conflict, checks the merge the same way, and pushes the merge; the tag stays on the release commit, which is exactly the built source plus the version commit. A re-run that finds the tag on origin at that commit pushes nothing.

### 5. Release Assets (`release-assets`)

Runs before `release-push` with the job token (`contents: write`) and installs nothing. Checks the downloaded VS Code packages against the digests `build-vscode` recorded, uploads the VSIX files and their SBOM evidence to the draft GitHub Release, and checks that the draft holds exactly the CLI assets of the checked evidence manifest and those VS Code files. Distribution evidence that a failed earlier run left on the draft is removed first; it is uploaded again later. Every write to the GitHub Release and every check before publishing it address it by the release id `release-draft` recorded; `smoke-cli` also downloads the CLI archive by release id.

### 6. Packages and Images (`publish-build`)

Checks out the pushed tag (and checks that it is the commit `release-push` pushed), with read access to the repository and write access to GHCR only:

- Packs the platform-specific CLI npm packages (e.g. `@kilocode/cli-linux-x64`) and the main `@kilocode/cli` package, and describes each exact tarball.
- Builds and pushes a multi-arch **Docker image** (`ghcr.io/kilo-org/kilocode`) to GitHub Container Registry (linux/amd64 + linux/arm64).
- Builds and pushes the image's **OpenShell variant** (`ghcr.io/kilo-org/kilocode:<version>-openshell` and `:latest-openshell`) from the Dockerfile's `openshell` stage, for the same platforms.
- Writes the npm and container SBOM evidence and hands it to the next jobs as the artifact `publish-build` (the stage file and the evidence, whose stage file's sha256 it records), and the tarballs as `publish-tarballs`, which only `publish` downloads.

### 7. GitHub Release (`release-undraft`)

With the job token (`contents: write`) and nothing installed: checks that the evidence of `publish-build` is the distribution manifest, its checksum file and exactly the sidecars the manifest's entries name, with those entries, each sidecar with the sha256 its entry records and the checksum file the one those entries give, before anything is uploaded; deletes distribution evidence an earlier attempt left on the draft; uploads the npm and container evidence; checks the complete draft again (every expected asset, each with its recorded digest, nothing else) and only then publishes the GitHub Release with its notes, from the changelogs of the tag. No asset is uploaded after this, so the published release never changes.

### 8. Publish (`publish`)

Checks out the pushed tag, in the `release` environment, with read access to the repository and OIDC only, and publishes in this order:

- **CLI**: the packed tarballs to **npm**, each with the sha256 `publish-build` recorded: the platform packages, then `@kilocode/cli`. The installer and `kilo upgrade` take the version from npm and download the archives from the GitHub Release, so npm gets the version only once the release is public.
- **SDK** (`@kilocode/sdk`): builds and publishes the TypeScript SDK to **npm**.
- **Plugin** (`@kilocode/plugin`): builds and publishes the plugin interface package to **npm**.
- **VS Code Extension**: publishes platform-specific VSIX packages to the **VS Code Marketplace** via `vsce publish --oidc`. The `publish` job runs in the `release` GitHub Actions environment, and the `kilocode` publisher trusts `Kilo-Org/kilocode`'s `publish.yml` workflow in that environment, so no Marketplace token is stored. It publishes the same packages to **Open VSX** via `ovsx publish --trusted-publishing`, using GitHub Actions OIDC instead of a PAT.

The user-visible order is unchanged: the release commit and tag, the images, the GitHub Release, npm (CLI, SDK, plugin), the VS Code Marketplace and Open VSX, then, in parallel, AUR and Homebrew (stable releases only) and the JetBrains pin pull request.

### 9. AUR and Homebrew (`package-managers`, stable releases only)

Runs after `publish`, once the release is public, in the `release-keys` environment. It installs no packages and runs only `script/kilocode/package-managers.ts` on Node. It reads the AUR key and the kilo-maintainer app key from the STS bundle of `ci-kilocode-release` (see `.github/actions/kilo-credentials/README.md`), and takes the archive digests from the CLI evidence manifest `build-cli` recorded, after checking that manifest's digest.

- **AUR (Arch Linux)**: Clones `kilo-bin` from the AUR over SSH (host keys pinned in the script), writes the `PKGBUILD` and `.SRCINFO` with the new version and SHA256 checksums, and pushes.
- **Homebrew**: Clones `Kilo-Org/homebrew-tap` with an app token that may write only that repository, updates the `kilo.rb` formula with the new version, download URLs, and SHA256 checksums, and pushes.

Each update is retried from a new clone up to three times. A repository that already has the files of this version is left unchanged, so the job can be re-run on its own (**Re-run failed jobs**). A repository that already publishes a newer version is left alone, in one of three ways:

- A re-run of an older release skips the update with a warning, because the recipe already has the newer release.
- When the release being published is the latest one, the job fails instead: the recipe is then ahead of a release it should have, so it needs a hand edit.
- When the latest release cannot be read from the GitHub API, the update is skipped with a warning as well; an API outage must not fail a release. The latest release is read with the job's read-only token.

The job publishes final releases only; a pre-release version is refused.

A failure fails the job but does not touch the release or the npm packages.

### 10. JetBrains CLI Pin (`jetbrains-pin`)

Runs after `publish` in the `release-keys` environment and installs nothing. With a kilo-maintainer app token (the key comes from the STS bundle of `ci-kilocode-release`), `.kilo/skills/release-jetbrains/script/set-pin.ts` opens or updates the pull request that bumps the JetBrains CLI pin to this release. A pull request opened with the job token would start no checks. The pin accepts CLI versions of the form `x.y.z` and `x.y.z-rc.n` only. A failure leaves the release as it is and reports a warning; the job stays green.

### Job Permissions

| Job | Repository token | Other |
|---|---|---|
| `release-draft` | `contents: write` | none |
| `smoke-cli` | `contents: write` | none |
| `smoke-test` | `contents: read` | the smoke test's secrets |
| `release-commit` | `contents: read`, `pull-requests: read` | none |
| `release-push` | `contents: read` | `id-token: write`, environment `release-keys` (kilo-maintainer app key from STS) |
| `release-assets` | `contents: write` | none |
| `publish-build` | `contents: read` | `packages: write` (GHCR) |
| `release-undraft` | `contents: write` | none |
| `publish` | `contents: read` | `id-token: write`, environment `release` (npm, VS Code Marketplace and Open VSX trusted publishing) |
| `package-managers`, `jetbrains-pin` | `contents: read` | `id-token: write`, environment `release-keys` (AUR key and app key from STS) |

### Refusals at `release-commit` or `release-push`

A refused release commit cannot be fixed by a re-run: the re-run checks the same bundle again. Examples: `bun.lock` on `main` not in Bun's canonical form; a changelog on `main` that changesets reformats when it adds the new section (it runs prettier over the whole file); a change outside the allowed version and changelog lines. The draft release `release-draft` created is then an orphan. Fix the cause on `main` (merge the `bun install` output, or format the changelog with prettier), then dispatch again: the bump counts the orphan draft and moves to the next version. To reuse the orphan's version instead, delete the orphan draft first and dispatch again (with the same `bump`, or with that `version`).

### Recovering from a Failed Job

Re-run the failed job (**Re-run failed jobs**); the build jobs, their recorded digests and the artifacts of the jobs that succeeded are reused. `release-commit` and `release-push` do not run again once they succeeded, so a re-run publishes from the same pushed tag. If `release-push` itself failed, its re-run checks the same bundle again; if the tag is already on origin at the release commit, it pushes nothing. Never re-run `release-draft` or `release-commit` on its own after `release-push` succeeded (their outputs feed the jobs after it); re-run `publish-build` instead.

- **`publish-build` or `release-undraft` failed**: the GitHub Release is still a draft. The Docker images may already be pushed. A re-run of `publish-build` packs and describes the npm packages again and rebuilds and pushes the images; `release-undraft` then uploads the evidence (replacing assets of the same name that an earlier attempt left), checks the draft and publishes it. npm has nothing yet: packages are published only after the release.
- **`publish` failed** (for example an npm publish): the release is public. The re-run publishes the tarballs `publish-build` packed, each with its recorded sha256, and skips npm packages that are already published. AUR and Homebrew are updated only after a `publish` run succeeds: the `package-managers` job runs after the successful re-run.
- **`release-undraft` re-run after the release was published**: it uploads nothing, checks the published assets (the CLI and VS Code assets against their recorded digests, the distribution evidence against its own manifest) and checks that the npm tarballs are the ones the published evidence names.

### Fixing a Bad Release

Immutable releases are turned on for this repository: once a GitHub Release is published, its tag and assets can no longer be changed or deleted. A bad release is fixed by publishing a new version (for example a patch bump), not by editing or replacing the published release. Drafts stay editable until they are published, which is why every asset is uploaded and checked before the release is published.

## Prerequisites and Permissions

### Repository Access

- The workflow only runs in the `Kilo-Org/kilocode` repository (guarded by `if: github.repository == 'Kilo-Org/kilocode'`).
- You must have **write access** to the repository to trigger a `workflow_dispatch` event.

### Workflow Permissions

The workflow requires these GitHub token permissions:

- `id-token: write` -- for VS Code Marketplace and Open VSX Trusted Publishing, npm provenance attestation, and the STS bundle (`ci-kilocode-release`) that `release-push`, `package-managers` and `jetbrains-pin` read
- `contents: write` -- for the draft release in `release-assets` and `release-undraft` (uploads, checks, publishing); the release commit and tag are pushed with the kilo-maintainer app token
- `packages: write` -- for publishing Docker images to GHCR

### Open VSX Trusted Publishing

Before publishing the stable extension `kilocode.kilo-code`, configure its Open VSX trusted publisher registration to match the `publish` job:

- Repository: `Kilo-Org/kilocode`
- Workflow filename: `publish.yml`
- Environment name: `release`

The `publish` job inherits the workflow's `id-token: write` permission. The Open VSX client is installed from `bun.lock` and uses `--trusted-publishing` to authenticate without a PAT. The shared GitHub secret `OVSX_TOKEN` and its registry token are retained for other consumers; this workflow no longer uses them.

### Required Secrets

The following secrets must be configured in the repository. The VS Code Marketplace needs no secret (see [Checking Marketplace Trusted Publishing](#checking-marketplace-trusted-publishing)). The AUR key and the kilo-maintainer app key come from Kilo STS, not from GitHub secrets; no job reads `KILO_MAINTAINER_APP_SECRET`.

| Secret | Purpose |
|---|---|
| `KILO_API_KEY` | Kilo Gateway key for the pre-publish smoke test (`smoke-test.yml`) |
| `KILO_ORG_ID` | Kilo organization ID for the pre-publish smoke test |
| `BENCH_GITHUB_TOKEN` | Read access to `Kilo-Org/kilo-bench` for the pre-publish smoke test |
| `NPM_TOKEN` | npm authentication token for publishing packages |

The repository variable `KILO_MAINTAINER_APP_ID` holds the kilo-maintainer app id, which is public.

### Environments

| Environment | Jobs | Purpose |
|---|---|---|
| `release` | `publish`, `oidc-check` | npm, VS Code Marketplace and Open VSX trusted publishing |
| `release-keys` | `release-push`, `package-managers`, `jetbrains-pin` | The only environment the STS policy `ci-kilocode-release` accepts; no job of the workflow that installs packages may use it (see `.github/actions/kilo-credentials/README.md`) |

Both allow only `main`.

### Concurrency

The workflow's concurrency group is `<workflow>-<ref>-<version or bump>`, so a second run for the same branch and version or bump waits for the first instead of running in parallel (a newer waiting run replaces an older one).
A trusted publishing check (`oidc_check`) uses `<workflow>-<ref>-oidc-check`, so it never queues behind or cancels a release.

### Checking Marketplace Trusted Publishing

The VS Code Marketplace publisher `kilocode` has a trusted publishing policy for the `Kilo-Org/kilocode` repository, the `publish.yml` workflow, and the `release` environment. If you rename the workflow file or the environment, update the policy in the Marketplace publisher management page first.

To check the policy without building or publishing anything, run the `publish` workflow on `main` with **`oidc_check`** enabled. Only the `oidc-check` job runs: it exchanges the GitHub OIDC token for a short-lived Marketplace credential, the same way `vsce publish --oidc` does, and asks the Marketplace for that credential's roles on `kilocode` (the request `vsce verify-pat kilocode` makes). It uses only `curl` and `jq` from the runner image. All other jobs are skipped.

A green check proves that the trust policy matches this repository, workflow, and environment, and that the Marketplace accepts the credential for `kilocode`. It does not prove upload rights, because the role check passes for any role on the publisher. The first real release proves the upload.
