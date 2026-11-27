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

## Updates

When extension auto-update is enabled, VS Code updates gallery-installed extensions automatically. After an update, reload the window or restart the extension host when VS Code asks. Install the pre-release version with `--pre-release` or **Install Pre-Release Version**, and VS Code keeps updating it on the pre-release channel. To install or update it from a terminal:

```sh
code --install-extension kilocode.kilo-code-v2 --pre-release --force
```

The extension includes the matching `kilo2` server binary for its platform. It starts that private binary and does not use a `kilo2` from `PATH`, npm, or a separately downloaded installer, so updating the extension also updates its server. The npm CLI and the alpha installer are separate installations.

A VSIX installed with **Install from VSIX** or `code --install-extension <file>.vsix` is not updated automatically by default. Install a newer VSIX or the gallery version to update it.

## High-refresh Integrated Browser

The Integrated Browser streams at a paced 60 fps in both the editor tab and the Agent Manager browser panel. When hardware H.264 encode/decode and loopback WebSockets are available, a split-incognito tab-capture helper streams hardware-encoded H.264 frames and wheel input directly between Chrome, a dedicated Node worker, and the webview, bypassing Extension Host IPC. When hardware video or loopback WebSockets are unavailable (for example on remote hosts or systems without a hardware encoder), it falls back automatically to JPEG frames over the worker or Extension Host. Actual frame delivery depends on the page, Chrome, the webview, and the display.

## Webview accessibility checks

From `packages/kilo-vscode`, run `bun run playwright-core install --no-shell chromium` once, then `bun run test:accessibility`. The CI gate runs the Agent Manager sidebar search in Chromium with the production webview component and styles. It fails on axe WCAG violations or broken keyboard selection and dismissal. It does not require VS Code, a server, or an account.

## Feedback

Report problems at https://github.com/Kilo-Org/kilocode/issues.
