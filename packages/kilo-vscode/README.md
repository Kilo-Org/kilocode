# Kilo Code (v2 preview)

This is the preview build of Kilo Code on the Kilo v2 server.

## Install

Install the pre-release build from the command line:

```sh
code --install-extension kilocode.kilo-code-v2 --pre-release
```

You can also install it from the Extensions view: open the extension, select the gear menu, then select **Install Pre-Release Version**.

The preview requires VS Code 1.95 or later.

## Run it next to Kilo Code v1

The preview uses the separate extension id `kilocode.kilo-code-v2` and keeps its server data in a separate `kilo2` directory. You can install it next to Kilo Code v1 and switch between both.

The opt-in internal profile cutover (`KILO_INTERNAL_PROFILE_CUTOVER=1`) is an exception. At first launch the extension shows the selected CLI's migration plan before starting the server. **Not now** stops activation; reload the window to reconsider. If another window is migrating, the extension follows it via `migrate observe` when the CLI advertises that read-only operation. The extension does not poll or start a migration on the strength of a `running` status. The **Kilo Code (v2)** output channel records progress and the CLI exit status.

For private bundles, build both the extension host and its matching CLI with `KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1`. The resulting host enables the consent screen even when the IDE starts from the Dock. A public build does not enable it. The runtime `KILO_INTERNAL_PROFILE_CUTOVER=1` switch is for unbundled source testing. Keep the private VSIX out of public publish jobs.

## Webview accessibility checks

From `packages/kilo-vscode`, run `bun run playwright-core install --no-shell chromium` once, then `bun run test:accessibility`. The CI gate runs the Agent Manager sidebar search in Chromium with the production webview component and styles. It fails on axe WCAG violations or broken keyboard selection and dismissal. It does not require VS Code, a server, or an account.

## Feedback

Report problems at https://github.com/Kilo-Org/kilocode/issues.
