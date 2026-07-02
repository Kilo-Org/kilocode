---
title: "Development Environment"
description: "Set up your development environment for contributing"
---

# Development Environment

{% callout type="info" %}
**New versions of the VS Code extension and CLI are being developed in [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode)** (extension at `packages/kilo-vscode`, CLI at `packages/opencode`). For extension and CLI development, please head over to that repository.
{% /callout %}

This document will help you set up your development environment and understand how to work with the codebase. Whether you're fixing bugs, adding features, or just exploring the code, this guide will get you started.

## Prerequisites

Before you begin, make sure you have the following installed:

1. **Git** - For version control
2. **Bun 1.3.14+** - Required for installing dependencies and running scripts
3. **Visual Studio Code** - Our recommended IDE for development
4. **Java 21** - Required only when running JetBrains plugin checks or repo-level checks that include `@kilocode/kilo-jetbrains`

## Getting Started

### Installation

1. **Fork and Clone the Repository**:
   - **Fork the Repository**:
     - Visit the [Kilo Code GitHub repository](https://github.com/Kilo-Org/kilocode)
     - Click the "Fork" button in the top-right corner to create your own copy.
   - **Clone Your Fork**:
     ```bash
     git clone https://github.com/[YOUR-USERNAME]/kilocode.git
     cd kilocode
     ```
     Replace `[YOUR-USERNAME]` with your actual GitHub username.

1. **Install dependencies**:

   ```bash
   bun install
   ```

   This command will install dependencies for all workspace packages.

1. **Install VSCode Extensions**:
   - **Required**: [ESBuild Problem Matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) - Helps display build errors correctly.

While not strictly necessary for running the extension, these extensions are recommended for development:

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) - Integrates ESLint into VS Code.
- [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) - Integrates Prettier into VS Code.

The full list of recommended extensions is in `.vscode/extensions.json`

### Using AI and Coding Agents

AI and coding agents are allowed in this repo. If you use one, start it from the repository root so the root `AGENTS.md` is available, then check package-specific guidance when your change touches a package with its own `AGENTS.md` or contributor docs.

You remain responsible for the submitted work. Before opening a PR, personally review the diff, test the change, make sure you can explain it, and understand how it interacts with the affected package and the rest of the repo. Do not use agents to submit batches of agent-generated, untested, or weakly reviewed PRs. Keep concurrent PRs limited, generally no more than three at a time, and prioritize high-impact issues first. Do not use automation or agents to mass-create issues without human review and prioritization.

Kilo has bug bounties. To be eligible, make sure your GitHub account is connected in your Kilo account.

### Project Structure

The project is organized into several key packages:

- **`packages/opencode/`** - Kilo CLI, agent runtime, local HTTP server, session management, and TUI
- **`packages/kilo-vscode/`** - VS Code extension, webview UI, Agent Manager, and extension packaging
- **`packages/sdk/js/`** - Generated TypeScript SDK for the local server API
- **`packages/kilo-docs/`** - Documentation site
- **`packages/kilo-jetbrains/`** - JetBrains plugin

## Development Workflow

### Running the CLI

To run the CLI from the repo root:

```bash
bun dev
```

`bun dev` and `bun run dev` are equivalent. Both run the local source in `packages/opencode/`; they do not use a globally installed `kilo` binary.

### Backend/API Validation

For backend and API validation, use the root [TESTING.md](https://github.com/Kilo-Org/kilocode/blob/main/TESTING.md) guide. It covers starting the local backend with:

```bash
bun dev serve
```

and validating behavior with `curl` requests against the local server.

If you change server endpoints in `packages/opencode/src/server/`, regenerate the SDK from the repo root:

```bash
./script/generate.ts
```

### Running the Extension

To run the extension in development mode:

```bash
bun run extension
```

This will build and launch the extension in an isolated VS Code instance.

The command auto-detects VS Code on macOS, Linux, and Windows. Use these options when the default launch target is not the one you need:

| Option | Use |
|---|---|
| `--no-build` | Launch the extension host without rebuilding first |
| `--app-path <path>` | Point to a specific VS Code executable |
| `VSCODE_EXEC_PATH` | Set the VS Code executable through the current shell environment |
| `--insiders` | Prefer VS Code Insiders |
| `--workspace <path>` | Open a specific workspace folder |
| `--clean` | Reset cached extension state before launch |

For example, to test the extension against a sample workspace:

```bash
bun run extension --workspace ../sample-project
```

To set the executable through an environment variable, use the syntax for your shell:

```bash
VSCODE_EXEC_PATH=/usr/local/bin/code bun run extension
```

```powershell
$env:VSCODE_EXEC_PATH = "C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe"
bun run extension
```

When the Extension Development Host opens, check the Kilo Code output channel and the Developer Tools console for startup or webview errors.

### Building the Extension

From `packages/kilo-vscode/`:

```bash
bun run compile
bun run package
```

Use `bun run compile` when you need a development build and `bun run package` when you need a production extension bundle.

## Testing

Kilo Code uses several types of tests to ensure quality:

### Repo-Level Checks

From the repo root:

```bash
bun install
bun run lint
bun run typecheck
```

`bun run typecheck` wraps `bun turbo typecheck`. Use `bun turbo typecheck --force` if you need to bypass the Turbo cache.

Do **not** run `bun test` from the repo root. The root test script intentionally exits with failure to prevent accidentally running tests from the wrong package.

### CLI Checks

From `packages/opencode/`:

```bash
bun run typecheck
bun test
bun test ./path/to/file.test.ts
```

Use the root [TESTING.md](https://github.com/Kilo-Org/kilocode/blob/main/TESTING.md) guide for backend/API checks that require `bun dev serve` and `curl`-based requests.

### VS Code Extension Checks

From `packages/kilo-vscode/`:

```bash
bun run typecheck
bun run lint
bun run test:unit
bun run test
bun run compile
bun run package
```

### Documentation Checks

From the repo root:

```bash
bun run --filter @kilocode/kilo-docs test
bun run --filter @kilocode/kilo-docs build
bun run --filter @kilocode/kilo-docs dev
```

For manual documentation validation, run the docs site locally, preview the affected page, and check the changed links and rendered content.

### Testing Evidence for Pull Requests

Every PR marked ready for review must include testing evidence. A bare `Not tested` or `N/A` answer is not sufficient.

Choose checks that match the files touched. Docs-only, config-only, and similar changes may satisfy this rule with concrete manual verification or a relevant command check.

For CLI and extension changes, useful evidence can include:

- The relevant command checks from the package you changed
- Manual/local verification of the changed behavior in the CLI or extension
- Screenshots or videos for visual changes, such as a settings page update or changed CLI/extension behavior

For docs changes, useful evidence can include:

- `bun run script/check-md-table-padding.ts --fix`
- `bun run --filter @kilocode/kilo-docs test`
- Previewing the changed docs page locally, as described in [Documentation Contributions](/docs/contributing#documentation-contributions)

If you cannot complete a relevant command, include all of the following in the PR:

- The command you attempted or would normally run
- The blocker or failure that prevented completion
- The substitute verification you performed instead

Agent limitations, local resource constraints, OOM constraints, or an agent prompt that says to skip tests do not waive this requirement. Draft PRs may be incomplete until they are marked ready for review. Maintainers may still defer or close review at their discretion.

## Guardrails

- User-facing changes usually need a changeset. Run `bunx changeset add` or add a file under `.changeset/`.
- After changing server endpoints, run `./script/generate.ts` from the repo root to regenerate `packages/sdk/js/`.
- After adding or changing guarded URLs in `packages/kilo-vscode/`, `packages/kilo-vscode/webview-ui/`, or `packages/opencode/src/`, run `bun run script/extract-source-links.ts` from the repo root.
- When editing shared `packages/opencode/` files, keep changes small and mark Kilo-only edits with `// kilocode_change` for a single line or `// kilocode_change start` / `// kilocode_change end` for a block. Do not add these markers inside `kilocode`-named paths.

## Git Hooks

This project uses [Husky](https://typicode.github.io/husky/) to manage Git hooks. The current pre-push hook checks the Bun version against root `package.json` and runs the repo-level typecheck. The JetBrains typecheck runs only when the pushed changes can affect the JetBrains plugin, so VS Code-only, docs-only, and changeset-only pushes do not require Java.

## Troubleshooting

### Common Issues

1. **Extension not loading**: Check the VSCode Developer Tools (Help > Toggle Developer Tools) for errors
2. **Webview not updating**: Try reloading the window (Developer: Reload Window)
3. **Build errors**: Make sure all dependencies are installed with `bun install`
4. **Root tests fail immediately**: This is expected. Run package-level tests instead of root `bun test`

### Debugging Tips

- Use `console.log()` statements in your code for debugging
- Check the Output panel in VSCode (View > Output) and select "Kilo Code" from the dropdown
- For webview issues, use the browser developer tools in the webview (right-click > "Inspect Element")
