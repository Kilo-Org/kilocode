<p align="center">
  English | <a href="translations/README.zh.md">简体中文</a> | <a href="translations/README.zht.md">繁體中文</a> | <a href="translations/README.ko.md">한국어</a> | <a href="translations/README.de.md">Deutsch</a> | <a href="translations/README.es.md">Español</a> | <a href="translations/README.fr.md">Français</a> | <a href="translations/README.it.md">Italiano</a> | <a href="translations/README.da.md">Dansk</a> | <a href="translations/README.ja.md">日本語</a> | <a href="translations/README.pl.md">Polski</a> | <a href="translations/README.ru.md">Русский</a> | <a href="translations/README.bs.md">Bosanski</a> | <a href="translations/README.ar.md">العربية</a> | <a href="translations/README.no.md">Norsk</a> | <a href="translations/README.br.md">Português (Brasil)</a> | <a href="translations/README.th.md">ไทย</a> | <a href="translations/README.tr.md">Türkçe</a> | <a href="translations/README.uk.md">Українська</a> | <a href="translations/README.bn.md">বাংলা</a> | <a href="translations/README.gr.md">Ελληνικά</a> | <a href="translations/README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">The open source coding agent for building with AI in VS Code, JetBrains, or the CLI.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code"><img src="https://raster.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace" height="20"></a>
  <a href="https://www.npmjs.com/package/@kilocode/cli"><img alt="npm" src="https://raster.shields.io/npm/v/@kilocode/cli?style=flat" height="20" /></a>
  <a href="https://x.com/kilocode"><img src="https://raster.shields.io/badge/kilocode-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="20"></a>
  <a href="https://blog.kilo.ai"><img src="https://raster.shields.io/badge/Blog-555?style=flat&logo=substack&logoColor=white" alt="Blog" height="20"></a>
  <a href="https://kilo.ai/discord"><img src="https://raster.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="20"></a>
  <a href="https://www.reddit.com/r/kilocode/"><img src="https://raster.shields.io/badge/Join%20r%2Fkilocode-D84315?style=flat&logo=reddit&logoColor=white" alt="Reddit" height="20"></a>
</p>

![Kilo-in-VS-Code-and-CLI](https://github.com/user-attachments/assets/0536ca59-ed81-4512-9e05-d186187a1b52)

---

Kilo Code is an AI coding agent that meets you everywhere you work: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native), and the [CLI](https://kilo.ai/cli). It's open source with open pricing. You pick from 500+ models, switch between them mid-task, and pay the model provider's rate with zero markup. No API keys required to start.

### Installation

Pick where you want to run Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Install the [Kilo Code extension](vscode:extension/kilocode.kilo-code) directly, or grab it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Create an account and you'll have access to 500+ models including GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6, and Gemini 3.1 Pro Preview, all at provider pricing.

</details>

<details open>
<summary><strong>CLI</strong></summary>

<br>

```bash
# npm
npm install -g @kilocode/cli

# curl
curl -fsSL https://kilo.ai/cli/install | bash

# pnpm
pnpm add -g @kilocode/cli

# bun
bun add -g @kilocode/cli

# Homebrew (macOS / Linux)
brew install Kilo-Org/tap/kilo

# Arch Linux (AUR)
paru -S kilo-bin
```

Then run `kilo` in any project directory to start.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Install the [Kilo Code plugin](https://plugins.jetbrains.com/plugin/28350-kilo-code) from the JetBrains Marketplace, or search "Kilo Code" in `Settings → Plugins` inside any JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Run Kilo from the web, no local machine needed, at [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Set up automated AI code reviews on your pull requests at [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Spin up your always-on AI agent at [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Install the CLI from GitHub Releases (binaries)</summary>

Download the latest binary from the [Releases page](https://github.com/Kilo-Org/kilocode/releases).

| Platform | Asset |
|---|---|
| Windows (most PCs) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Notes: `x64-baseline` is a compatibility build for older CPUs without AVX. `musl` is the statically linked build for Alpine or minimal Docker images without glibc. `kilo-vscode-*.vsix` is the VS Code extension package, not the CLI. `Source code` archives are for building from source.

</details>

### Agents

Kilo ships with specialized agents you switch between depending on the task. You can also build your own custom agents.

- **Code** - The default. Implements and edits code from natural language.
- **Plan** - Designs architecture and writes implementation plans before any code gets written.
- **Ask** - Answers questions about your codebase without touching any files.
- **Debug** - Troubleshoots and traces issues.
- **Review** - Reviews your changes and surfaces issues across performance, security, style, and test coverage.

Learn more about [agents and custom agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### What it does

- **Code generation** from natural language, across multiple files.
- **Inline autocomplete** with ghost-text suggestions and tab to accept.
- **Self-checking** so the agent reviews and corrects its own work.
- **Terminal and browser control** to run commands and automate the web.
- **MCP marketplace** to find and wire up MCP servers that extend what the agent can do.
- **500+ models** with mid-task switching, so you can match latency, cost, and reasoning to the job.

### Autonomous Mode (CI/CD)

Run `kilo run` with `--auto` for fully autonomous operation with no prompts, built for CI/CD pipelines:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` disables all permission prompts and lets the agent execute any action without confirmation. Only use it in trusted environments.

### Documentation

For configuration and everything else, [head over to the docs](https://kilo.ai/docs).

### Contributing

Contributions are welcome from developers, writers, and everyone in between. Start with the [Contributing Guide](/CONTRIBUTING.md) for environment setup, coding standards, and how to open a pull request. See [RELEASING.md](RELEASING.md) for the VS Code extension and CLI release process, and [packages/kilo-jetbrains/RELEASING.md](packages/kilo-jetbrains/RELEASING.md) for the JetBrains plugin.

Please review our [Code of Conduct](/CODE_OF_CONDUCT.md) before getting involved.

### License

MIT. You're free to use, modify, and distribute this code, including commercially, as long as you keep the attribution and license notices. See [License](/LICENSE).

### FAQ

<details>
<summary>Where did Kilo CLI come from?</summary>

Kilo CLI is a fork of [OpenCode](https://github.com/anomalyco/opencode), enhanced to work within the Kilo agentic engineering platform.

</details>

---

**Join the community** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
