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

## Webview accessibility checks

From `packages/kilo-vscode`, run `bun run playwright-core install --no-shell chromium` once, then `bun run test:accessibility`. The CI gate runs the Agent Manager sidebar search in Chromium with the production webview component and styles. It fails on axe WCAG violations or broken keyboard selection and dismissal. It does not require VS Code, a server, or an account.

## Feedback

Report problems at https://github.com/Kilo-Org/kilocode/issues.
