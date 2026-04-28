# Contributing to Kilo CLI

See [the Documentation for details on contributing](https://kilo.ai/docs/contributing).

## TL;DR

There are lots of ways to contribute to the project:

- **Code Contributions:** Implement new features or fix bugs
- **Documentation:** Improve existing docs or create new guides
- **Bug Reports:** Report issues you encounter
- **Feature Requests:** Suggest new features or improvements
- **Community Support:** Help other users in the community

The Kilo Community is [on Discord](https://kilo.ai/discord).

## Developing Kilo CLI

- **Requirements:** Bun 1.3.10+
- Install dependencies and start the dev server from the repo root:

  ```bash
  bun install
  bun dev
  ```

### Developing the VS Code Extension

Build and launch the extension in an isolated VS Code instance:

```bash
bun run extension        # Build + launch in dev mode
```

This auto-detects VS Code on macOS, Linux, and Windows. Override with `--app-path PATH` or `VSCODE_EXEC_PATH`. Use `--insiders` to prefer Insiders, `--workspace PATH` to open a specific folder, or `--clean` to reset cached state.

### Running against a different directory

By default, `bun dev` runs Kilo CLI in the `packages/opencode` directory. To run it against a different directory or repository:

```bash
bun dev <directory>
```

To run Kilo CLI in the root of the repo itself:

```bash
bun dev .
```

### Running Kilo CLI from any folder

`bin/kilodev` is a self-locating launcher that runs this checkout from wherever you invoke it. Running it with no arguments launches the TUI pointed at the caller's directory; any arguments are forwarded to the CLI unchanged.

One-shot install (recommended). From the repo root:

```bash
./bin/kilodev dev-setup
```

This detects your shell, shows exactly what it will add, asks for confirmation, writes an idempotent block to your rc file, and saves a timestamped backup of the original. Re-running is safe — it only rewrites when the snippet has changed.

Useful flags:

- `--yes` — skip the confirmation prompt (good for CI/containers).
- `--print` — just print the snippet, don't touch any file (pipe-friendly).
- `--dry-run` — show what would change without writing.
- `--shell <zsh|bash|fish|powershell>` — override shell detection.
- `--rc <path>` — override the rc file.

Manual alternatives (equivalent, no CLI invocation needed):

- Unix: add `alias kilodev='/path/to/kilocode/bin/kilodev'` to `~/.zshrc` / `~/.bashrc`, or `fish_add_path /path/to/kilocode/bin`.
- Windows: add `C:\path\to\kilocode\bin` to PATH (System Environment Variables), or add `function kilodev { & "C:\path\to\kilocode\bin\kilodev.cmd" @args }` to `$PROFILE`.

Then from anywhere:

```bash
cd ~/some/project
kilodev                      # opens TUI with project = ~/some/project
kilodev dev-setup --print    # prints the alias line (scripting)
kilodev run --dir "$PWD" "…" # subcommands pass through; use --dir for run/serve
```

### Building a "local" binary

To compile a standalone executable:

```bash
./packages/opencode/script/build.ts --single
```

Then run it with:

```bash
./packages/opencode/dist/@kilocode/cli-<platform>/bin/kilo
```

Replace `<platform>` with your platform (e.g., `darwin-arm64`, `linux-x64`).

### Understanding bun dev vs kilo

During development, `bun dev` is the local equivalent of the built `kilo` command. Both run the same CLI interface:

```bash
# Development (from project root)
bun dev --help           # Show all available commands
bun dev serve            # Start headless API server

# Production
kilo --help          # Show all available commands
kilo serve           # Start headless API server
```

### Testing with a local backend

To point the CLI at a local backend (e.g., a locally running Kilo API server on port 3000), set the `KILO_API_URL` environment variable:

```bash
KILO_API_URL=http://localhost:3000 bun dev
```

This redirects all gateway traffic (auth, model listing, provider routing, profile, etc.) to your local server. The default is `https://api.kilo.ai`.

There are also optional overrides for other services:

| Variable                  | Default                          | Purpose                                   |
| ------------------------- | -------------------------------- | ----------------------------------------- |
| `KILO_API_URL`            | `https://api.kilo.ai`            | Kilo API (gateway, auth, models, profile) |
| `KILO_SESSION_INGEST_URL` | `https://ingest.kilosessions.ai` | Session export / cloud sync               |
| `KILO_MODELS_URL`         | `https://models.dev`             | Model metadata                            |

> **VS Code:** The repo includes a "VSCode - Run Extension (Local Backend)" launch config in `.vscode/launch.json` that sets `KILO_API_URL=http://localhost:3000` automatically.

### Pull Request Expectations

- **Issue First Policy:** All PRs must reference an existing issue.
- **UI Changes:** Include screenshots or videos (before/after).
- **Logic Changes:** Explain how you verified it works.
- **PR Titles:** Follow conventional commit standards (`feat:`, `fix:`, `docs:`, etc.).

### Issue and PR Lifecycle

To keep our backlog manageable, we automatically close inactive issues and PRs after a period of inactivity. This isn't a judgment on quality — older items tend to lose context over time and we'd rather start fresh if they're still relevant. Feel free to reopen or create a new issue/PR if you're still working on something!

### Style Preferences

- **Functions:** Keep logic within a single function unless breaking it out adds clear reuse.
- **Destructuring:** Avoid unnecessary destructuring.
- **Control flow:** Avoid `else` statements; prefer early returns.
- **Types:** Avoid `any`.
- **Variables:** Prefer `const`.
- **Naming:** Concise single-word identifiers when descriptive.
- **Runtime APIs:** Use Bun helpers (e.g., `Bun.file()`).
