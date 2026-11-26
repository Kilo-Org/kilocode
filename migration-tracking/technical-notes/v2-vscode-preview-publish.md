# VS Code v2 preview publishing

The `package-vscode` job in `.github/workflows/kilo-v2-publish.yml` packages and uploads the preview VSIXs. The `publish-vscode` job publishes them as a pre-release on the VS Code Marketplace and Open VSX.

- The extension id is separate from v1 (`kilocode.kilo-code`), so both extensions can stay installed. The v2 server keeps its data in the separate `kilo2` directory.
- The version is `0.1.<run number>`. The Marketplace accepts only `major.minor.patch` and rejects the CLI's `0.0.0-v2-<number>` version.
- Initial targets: `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`, `linux-arm64`. Add `alpine-x64`, `alpine-arm64` and `win32-arm64` after the first preview.
- Both registries use GitHub Actions OIDC. The Open VSX trusted publisher for `kilocode.kilo-code-v2` is `Kilo-Org/kilocode`, workflow `kilo-v2-publish.yml`, with no environment name, so it also trusts runs in an environment.
- The package job runs the extension typecheck and lint before packaging. The publish job uses `id-token: write` with the lockfile-installed `vsce publish --oidc` and `ovsx publish --trusted-publishing`.
- The publish jobs run in the `release-v2` environment, which accepts only the `v2` branch, and each checks the branch before it publishes.
- `gh workflow run kilo-v2-publish.yml --ref v2 -f oidc_check=true` checks the Marketplace trusted publishing policy from that environment with `vsce verify-pat kilocode`. It builds and publishes nothing.
- The publish job waits for `build`, `package-vscode`, `smoke` and `smoke-windows`.
- Pull requests that change the publish flow package and upload the VSIXs without publishing.

## Verify before the first publish

- Run the packaged VSIX self-test on macOS, Linux and Windows. Check that the bundled `kilo2` starts, the panels load, and the Linux sandbox helpers are present.
- Each VSIX includes the matching CLI's `bin/tree-sitter` resources. Packaging checks that the runtime WASM is present in the final archive; verify autocomplete in the packaged extension as part of the release smoke test.

## Deferred

- Windows EV code signing of the bundled `kilo2.exe`.
- macOS signing of the bundled CLI.
- CRA SBOM evidence for the VSIX files. v1 blocks publishing until its evidence verifies.

## Later channel mapping

The v2 extension can later take the pre-release channel of `kilocode.kilo-code` while v1 stays on stable. That needs the same extension id, v1 set to stable-only, a version order that keeps the v2 pre-release above v1 stable, an audit of the shared extension storage, and a request to the VS Code team to migrate the separate preview listing.
