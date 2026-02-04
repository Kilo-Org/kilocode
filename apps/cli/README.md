# @roo-code/cli

Command Line Interface for Roo Code - Run the Roo Code agent from the terminal without VSCode.

## Overview

This CLI uses the `@roo-code/vscode-shim` package to provide a VSCode API compatibility layer, allowing the main Roo Code extension to run in a Node.js environment.

## Installation

### Quick Install (Recommended)

Install the Roo Code CLI with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
```

**Requirements:**

- Node.js 20 or higher
- macOS Apple Silicon (M1/M2/M3/M4) or Linux x64

**Custom installation directory:**

```bash
ROO_INSTALL_DIR=/opt/roo-code ROO_BIN_DIR=/usr/local/bin curl -fsSL ... | sh
```

**Install a specific version:**

```bash
ROO_VERSION=0.1.0 curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
```

### Updating

Re-run the install script to update to the latest version:

```bash
curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
```

### Uninstalling

```bash
rm -rf ~/.roo/cli ~/.local/bin/roo
```

### Development Installation

For contributing or development:

```bash
# From the monorepo root.
pnpm install

# Build the main extension first.
pnpm --filter roo-cline bundle

# Build the cli.
pnpm --filter @roo-code/cli build
```

## Usage

### Interactive Mode (Default)

By default, the CLI prompts for approval before executing actions:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...

roo "What is this project?"  -w ~/Documents/my-project
```

You can also run without a prompt and enter it interactively in TUI mode:

```bash
roo -w ~/Documents/my-project
```

In interactive mode:

- Tool executions prompt for yes/no approval
- Commands prompt for yes/no approval
- Followup questions show suggestions and wait for user input
- Browser and MCP actions prompt for approval

### Non-Interactive Mode (`-y`)

For automation and scripts, use `-y` to auto-approve all actions:

```bash
roo "Refactor the utils.ts file" -y -w ~/Documents/my-project
```

In non-interactive mode:

- Tool, command, browser, and MCP actions are auto-approved
- Followup questions show a 60-second timeout, then auto-select the first suggestion
- Typing any key cancels the timeout and allows manual input

### Roo Code Cloud Authentication

To use Roo Code Cloud features (like the provider proxy), you need to authenticate:

```bash
# Log in to Roo Code Cloud (opens browser)
roo auth login

# Check authentication status
roo auth status

# Log out
roo auth logout
```

The `auth login` command:

1. Opens your browser to authenticate with Roo Code Cloud
2. Receives a secure token via localhost callback
3. Stores the token in `~/.config/roo/credentials.json`

Tokens are valid for 90 days. The CLI will prompt you to re-authenticate when your token expires.

**Authentication Flow:**

```
┌──────┐         ┌─────────┐         ┌───────────────┐
│  CLI │         │ Browser │         │ Roo Code Cloud│
└──┬───┘         └────┬────┘         └───────┬───────┘
   │                  │                      │
   │ Open auth URL    │                      │
   │─────────────────>│                      │
   │                  │                      │
   │                  │ Authenticate         │
   │                  │─────────────────────>│
   │                  │                      │
   │                  │<─────────────────────│
   │                  │ Token via callback   │
   │<─────────────────│                      │
   │                  │                      │
   │ Store token      │                      │
   │                  │                      │
```

## Options

| Option                                      | Description                                                                             | Default                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| `[prompt]`                                  | Your prompt (positional argument, optional)                                             | None                                     |
| `--prompt-file <path>`                      | Read prompt from a file instead of command line argument                                | None                                     |
| `-w, --workspace <path>`                    | Workspace path to operate in                                                            | Current directory                        |
| `-p, --print`                               | Print response and exit (non-interactive mode)                                          | `false`                                  |
| `-e, --extension <path>`                    | Path to the extension bundle directory                                                  | Auto-detected                            |
| `-d, --debug`                               | Enable debug output (includes detailed debug information, prompts, paths, etc)          | `false`                                  |
| `-y, --yes, --dangerously-skip-permissions` | Auto-approve all actions (use with caution)                                             | `false`                                  |
| `-k, --api-key <key>`                       | API key for the LLM provider                                                            | From env var                             |
| `--provider <provider>`                     | API provider (roo, anthropic, openai, openrouter, etc.)                                 | `openrouter` (or `roo` if authenticated) |
| `-m, --model <model>`                       | Model to use                                                                            | `anthropic/claude-opus-4.5`              |
| `--mode <mode>`                             | Mode to start in (code, architect, ask, debug, etc.)                                    | `code`                                   |
| `-r, --reasoning-effort <effort>`           | Reasoning effort level (unspecified, disabled, none, minimal, low, medium, high, xhigh) | `medium`                                 |
| `--ephemeral`                               | Run without persisting state (uses temporary storage)                                   | `false`                                  |
| `--oneshot`                                 | Exit upon task completion                                                               | `false`                                  |
| `--output-format <format>`                  | Output format with `--print`: `text`, `json`, or `stream-json`                          | `text`                                   |

## Auth Commands

| Command           | Description                        |
| ----------------- | ---------------------------------- |
| `roo auth login`  | Authenticate with Roo Code Cloud   |
| `roo auth logout` | Clear stored authentication token  |
| `roo auth status` | Show current authentication status |

## Environment Variables

The CLI will look for API keys in environment variables if not provided via `--api-key`:

| Provider      | Environment Variable |
| ------------- | -------------------- |
| anthropic     | `ANTHROPIC_API_KEY`  |
| openai        | `OPENAI_API_KEY`     |
| openrouter    | `OPENROUTER_API_KEY` |
| google/gemini | `GOOGLE_API_KEY`     |
| ...           | ...                  |

**Authentication Environment Variables:**

| Variable          | Description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `ROO_WEB_APP_URL` | Override the Roo Code Cloud URL (default: `https://app.roocode.com`) |

## Architecture

```
┌─────────────────┐
│   CLI Entry     │
│   (index.ts)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ExtensionHost  │
│  (extension-    │
│   host.ts)      │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐  ┌──────────┐
│vscode │  │Extension │
│-shim  │  │ Bundle   │
└───────┘  └──────────┘
```

## How It Works

1. **CLI Entry Point** (`index.ts`): Parses command line arguments and initializes the ExtensionHost

2. **ExtensionHost** (`extension-host.ts`):

    - Creates a VSCode API mock using `@roo-code/vscode-shim`
    - Intercepts `require('vscode')` to return the mock
    - Loads and activates the extension bundle
    - Manages bidirectional message flow

3. **Message Flow**:
    - CLI → Extension: `emit("webviewMessage", {...})`
    - Extension → CLI: `emit("extensionWebviewMessage", {...})`

## Development

```bash
# Watch mode for development
pnpm dev

# Run tests
pnpm test

# Type checking
pnpm check-types

# Linting
pnpm lint
```

## Releasing

Official releases are created via the GitHub Actions workflow at `.github/workflows/cli-release.yml`.

To trigger a release:

1. Go to **Actions** → **CLI Release**
2. Click **Run workflow**
3. Optionally specify a version (defaults to `package.json` version)
4. Click **Run workflow**

The workflow will:

1. Build the CLI on all platforms (macOS Apple Silicon, Linux x64)
2. Create platform-specific tarballs with bundled ripgrep
3. Verify each tarball
4. Create a GitHub release with all tarballs attached

### Local Builds

For local development and testing, use the build script:

```bash
# Build tarball for your current platform
./apps/cli/scripts/build.sh

# Build and install locally
./apps/cli/scripts/build.sh --install

# Fast build (skip verification)
./apps/cli/scripts/build.sh --skip-verify
```
