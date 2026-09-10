# Kilo Code — v2 backend port

This package uses the original Kilo Code sidebar, composer, settings, Agent
Manager, and editor webviews. The earlier upstream-app wrapper has been removed.
The backend port is still in progress; building the extension does not imply
that every original workflow is implemented.

## Run locally

From the repository root, run `bun run extension`. This builds the original
Kilo extension and opens a VS Code development window. It uses a dedicated
development profile and extension directory at a short checkout-specific temporary path so the
installed stable Kilo extension cannot duplicate its commands or toolbar. Your
normal VS Code profile and other windows are unaffected.

The local v2 daemon starts automatically through the shared connection manager.
Development uses this checkout's CLI; `kilo2.cliPath` can select an executable.
Set `VSCODE_BIN` to an existing VS Code CLI executable if it is not on PATH.

## Package

Run `bun run build` then `bun run package` from this directory. Packaging uses
locally installed `vsce` and never downloads it. The package retains the ID
`kilocode.kilo-code-v2-preview` so installing the resulting VSIX replaces the
previous wrapper. Its visible sidebar is **Kilo Code**, with the original UI.
Disable the stable Kilo extension in the same window when using this preview.

## Validation and limitations

Headless connection, adapter, transport, parser, and packaging tests are in
`test/`. The desktop activation runner is `bun run test:native`; it refuses to
launch unless `KILO_TEST_ALLOW_DESKTOP=1` is explicitly set. Desktop validation
is currently paused at the user's request. No automatic VS Code launch is part
of build or packaging.

See `../../kilocode/baseline/existing-vscode-port.md` for tested slices and
remaining backend gaps. Full typechecking and complete original workflow parity
remain unfinished. No marketplace publication or external acceptance is claimed.
