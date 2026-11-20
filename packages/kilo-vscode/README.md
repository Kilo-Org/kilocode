# Kilo Code (v2 preview)

This is the preview build of Kilo Code on the Kilo v2 server.

## Install

Install the pre-release build from the command line:

```sh
code --install-extension kilocode.kilo-code-v2 --pre-release
```

You can also install it from the Extensions view: open the extension, select the gear menu, then select **Install Pre-Release Version**.

The preview requires VS Code 1.95 or later.

## Extension product and local profile

The extension keeps its separate product ID, `kilocode.kilo-code-v2`. Its bundled `kilo` CLI uses the same local profile as the npm CLI: `kilo.db`, `kilo.json` or `kilo.jsonc`, and project `.kilo/` directories. The npm distribution remains `@kilocode/cli@kilo-v2`. Installing the extension does not replace the v1 extension or a CLI on `PATH`.

When the selected database is v1, the extension shows the migration plan before starting its server. **Not now** leaves the v1 profile in place and stops activation; reload to reconsider. Close all clients sharing this profile before accepting. Do not reopen the converted store in v1, including the current JetBrains plugin. Other participating windows observe progress. Fresh and native v2 profiles start without a conversion prompt.

`KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1` builds a privately staged VSIX and verifies its matching CLI. It does not change profile selection or grant migration consent.

## Updates

When extension auto-update is enabled, VS Code updates gallery-installed extensions automatically. After an update, reload the window or restart the extension host when VS Code asks. Install the pre-release version with `--pre-release` or **Install Pre-Release Version**, and VS Code keeps updating it on the pre-release channel. To install or update it from a terminal:

```sh
code --install-extension kilocode.kilo-code-v2 --pre-release --force
```

The extension includes the matching `kilo` server binary for its platform. It starts that private binary and does not use a `kilo` from `PATH`, npm, or a separately downloaded installer, so updating the extension also updates its server. The npm CLI and the alpha installer are separate installations.

A VSIX installed with **Install from VSIX** or `code --install-extension <file>.vsix` is not updated automatically by default. Install a newer VSIX or the gallery version to update it.

## Webview accessibility checks

From `packages/kilo-vscode`, run `bun run playwright-core install --no-shell chromium` once, then `bun run test:accessibility`. The CI gate runs the Agent Manager sidebar search in Chromium with the production webview component and styles. It fails on axe WCAG violations or broken keyboard selection and dismissal. It does not require VS Code, a server, or an account.

## Feedback

Report problems at https://github.com/Kilo-Org/kilocode/issues.
