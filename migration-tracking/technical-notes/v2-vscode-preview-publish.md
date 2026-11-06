# VS Code v2 preview publishing

The `publish-vscode` job in `.github/workflows/kilo-v2-publish.yml` publishes `kilocode.kilo-code-v2` as a pre-release on the VS Code Marketplace and Open VSX.

- The extension id is separate from v1 (`kilocode.kilo-code`), so both extensions can stay installed. The v2 server keeps its data in the separate `kilo2` directory.
- The version is `0.1.<run number>`. The Marketplace accepts only `major.minor.patch` and rejects the CLI's `0.0.0-v2-<number>` version.
- Initial targets: `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`, `linux-arm64`. Add `alpine-x64`, `alpine-arm64` and `win32-arm64` after the first preview.
- Secrets: `VSCE_TOKEN` for the VS Code Marketplace and `OVSX_TOKEN` for Open VSX.
- The job runs the lockfile-installed `@vscode/vsce` and `ovsx`, passes the Open VSX token through `OVSX_PAT`, and runs the extension typecheck and lint before packaging.
- Pull requests that change the publish flow package and upload the VSIXs without publishing.

## Verify before the first publish

- Run the packaged VSIX self-test on macOS, Linux and Windows. Check that the bundled `kilo2` starts, the panels load, and the Linux sandbox helpers are present.
- v1 copied the CLI tree-sitter resources into the extension. The v2 build does not copy `dist/tree-sitter`, and `tree-sitter-wasms` is not a dependency. Verify autocomplete in the packaged VSIX and port the resource copy if it is needed.

## Deferred

- Windows EV code signing of the bundled `kilo2.exe`.
- macOS signing of the bundled CLI.
- CRA SBOM evidence for the VSIX files. v1 blocks publishing until its evidence verifies.

## Later channel mapping

The v2 extension can later take the pre-release channel of `kilocode.kilo-code` while v1 stays on stable. That needs the same extension id, v1 set to stable-only, a version order that keeps the v2 pre-release above v1 stable, an audit of the shared extension storage, and a request to the VS Code team to migrate the separate preview listing.
