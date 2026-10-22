# Kilo Code CLI

The AI coding agent built for the terminal. Generate code from natural language, automate tasks, and run terminal commands -- powered by 500+ AI models.

![Kilo CLI showing code edits in a terminal](https://raw.githubusercontent.com/Kilo-Org/kilocode/main/packages/kilo-docs/public/img/npm-package-readme/kilo-cli.png)

Kilo is the all-in-one agentic engineering platform. Build, ship, and iterate faster with the most popular open source coding agent.

[Website](https://kilo.ai) · [Install](https://kilo.ai/install) · [IDE](https://kilo.ai/landing/vs-code) · [CLI](https://kilo.ai/cli) · [Docs](https://kilo.ai/docs) · [Models](https://kilo.ai/leaderboard) · [Gateway](https://kilo.ai/gateway) · [Pricing](https://kilo.ai/pricing) · [Kilo Pass](https://kilo.ai/pricing/kilo-pass)

[500+ models](https://kilo.ai/leaderboard). One open source agent in [VS Code](https://kilo.ai/vscode-marketplace), [JetBrains](https://plugins.jetbrains.com/plugin/27133-kilo-code), [CLI](https://www.npmjs.com/package/@kilocode/cli), [Slack](https://kilo.ai/slack), and [Cloud](https://kilo.ai/cloud).

## Install

```bash
npm install -g @kilocode/cli
```

Or run directly with npx:

```bash
npx --package @kilocode/cli kilo
```

## Getting Started

Run `kilo` in any project directory to launch the interactive TUI:

```bash
kilo
```

Run a one-off task:

```bash
kilo run "add input validation to the signup form"
```

## Features

- **Code generation** -- describe what you want in natural language
- **Terminal commands** -- the agent can run shell commands on your behalf
- **500+ AI models** -- use models from OpenAI, Anthropic, Google, and more
- **MCP servers** -- extend agent capabilities with the Model Context Protocol
- **Multiple modes** -- Plan with Architect, code with Coder, debug with Debugger, or create your own
- **Sessions** -- resume previous conversations and export transcripts
- **API keys optional** -- bring your own keys or use Kilo credits

## Commands

| Command               | Description                |
| --------------------- | -------------------------- |
| `kilo`                | Launch interactive TUI     |
| `kilo run "<task>"`   | Run a one-off task         |
| `kilo auth`           | Manage authentication      |
| `kilo models`         | List available models      |
| `kilo mcp`            | Manage MCP servers         |
| `kilo session list`   | List sessions              |
| `kilo session delete` | Delete a session           |
| `kilo export`         | Export session transcripts |

Run `kilo --help` for the full list.

## Alternative Installation

### Homebrew (macOS/Linux)

```bash
brew install Kilo-Org/tap/kilo
```

### GitHub Releases

Download pre-built binaries from the [Releases page](https://github.com/Kilo-Org/kilocode/releases).

## Documentation

- [Docs](https://kilo.ai/docs)
- [Getting Started](https://kilo.ai/docs/getting-started)

## Links

- [GitHub](https://github.com/Kilo-Org/kilocode)
- [Discord](https://kilo.ai/discord)
- [VS Code Extension](https://kilo.ai/vscode-marketplace)
- [Website](https://kilo.ai)

## License

MIT
