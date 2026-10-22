# Releasing Kilo Code

Kilo Code uses a fully automated CI pipeline triggered via GitHub Actions `workflow_dispatch`. A single workflow handles version bumping, building all artifacts, publishing to every distribution channel, and updating package registries.

## How to Trigger a Release

1. Go to the [`publish` workflow](https://github.com/Kilo-Org/kilocode/actions/workflows/publish.yml) in GitHub Actions.
2. Click **"Run workflow"**.
3. Select the branch (typically `main`).
4. Fill in the inputs:
   - **`bump`** (choice): `patch`, `minor`, or `major`. Determines how the version number is incremented.
   - **`version`** (string, optional): Override the version explicitly instead of using `bump`. Leave empty to use the bump-based calculation.

   > **⚠️ Do not fill in `version` unless you have a specific reason to.**
   > The default behavior — leaving `version` empty and selecting a `bump` level — is almost always what you want. The automated bump logic computes the correct next version from the current state of the repo. Only use the `version` override for exceptional cases like skipping versions or publishing a pre-release (e.g. `1.5.0-beta.1`).

5. Click **"Run workflow"** to start the release.

## What Happens During a Release

The `publish.yml` workflow runs four jobs sequentially:

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
- Creates platform archives (`.tar.gz` for Linux, `.zip` for macOS/Windows) and uploads them to the draft GitHub Release.
- Uploads the `dist/` directory as a workflow artifact (`kilo-cli`) for subsequent jobs.

### 3. Build VS Code Extension (`build-vscode`)

- Downloads the CLI artifacts from the previous job.
- Runs `packages/kilo-vscode/script/build.ts` to build VSIX packages for all target platforms:
  - `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`
- Each VSIX bundles the platform-specific CLI binary.
- Uploads the VSIX files as a workflow artifact (`kilo-vscode`).

### 4. Publish (`publish`)

Downloads all build artifacts and publishes to every distribution channel:

#### Version Commit and Tagging

- Updates the `version` field in all `package.json` files across the monorepo.
- Updates the Zed extension manifest (`extension.toml`) with the new version.
- Rebuilds the TypeScript SDK (`packages/sdk/js`).
- Commits the version bump, tags the commit, and pushes to the repo.
- Promotes the draft GitHub Release to a published release.

#### CLI (`@kilocode/cli`)

- Publishes platform-specific binary packages to **npm** (e.g. `@kilocode/cli-linux-x64`, `@kilocode/cli-darwin-arm64`, etc.).
- Publishes the main `@kilocode/cli` package to **npm** with optional dependencies on the binary packages.
- Builds and pushes a multi-arch **Docker image** (`ghcr.io/kilo-org/kilocode`) to GitHub Container Registry (linux/amd64 + linux/arm64).

#### SDK (`@kilocode/sdk`)

- Builds and publishes the TypeScript SDK to **npm**.

#### Plugin (`@kilocode/plugin`)

- Builds and publishes the plugin interface package to **npm**.

#### VS Code Extension

- Publishes platform-specific VSIX packages to the **VS Code Marketplace** via `vsce`.
- Uploads all VSIX files to the **GitHub Release** as assets.

#### Package Registries (stable releases only)

- **AUR (Arch Linux)**: Clones `kilo-bin` from the AUR, updates the `PKGBUILD` with new version and SHA256 checksums, and pushes.
- **Homebrew**: Clones `Kilo-Org/homebrew-tap`, updates the `kilo.rb` formula with new version, download URLs, and SHA256 checksums, and pushes.

## Prerequisites and Permissions

### Repository Access

- The workflow only runs in the `Kilo-Org/kilocode` repository (guarded by `if: github.repository == 'Kilo-Org/kilocode'`).
- You must have **write access** to the repository to trigger a `workflow_dispatch` event.

### Workflow Permissions

The workflow requires these GitHub token permissions:

- `id-token: write` -- for npm provenance attestation
- `contents: write` -- for creating releases, pushing tags, and uploading assets
- `packages: write` -- for publishing Docker images to GHCR

### Required Secrets

The following secrets must be configured in the repository:

| Secret | Purpose |
|---|---|
| `KILO_API_KEY` | Kilo API key used during version computation |
| `KILO_ORG_ID` | Kilo organization ID |
| `KILO_MAINTAINER_APP_ID` | GitHub App ID for the kilo-maintainer bot (used for git commits) |
| `KILO_MAINTAINER_APP_SECRET` | GitHub App secret for the kilo-maintainer bot |
| `NPM_TOKEN` | npm authentication token for publishing packages |
| `VSCE_TOKEN` | VS Code Marketplace personal access token |
| `OVSX_TOKEN` | Open VSX Registry token (currently unused but configured) |
| `AUR_KEY` | SSH private key for pushing to the AUR |

### Concurrency

The workflow uses concurrency control (`workflow-ref-bump/version`) to prevent parallel releases from conflicting.
