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

### Get started

- **VS Code:** Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code).
- **JetBrains:** Install from the [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/28350-kilo-code).
- **Cloud:** Use the [Cloud Agent](https://app.kilo.ai/cloud), set up [Code Reviews](https://app.kilo.ai/code-reviews), or launch an always-on [KiloClaw](https://app.kilo.ai/claw).
- **CLI:** Install with your preferred package manager:

```bash
npm install -g @kilocode/cli
```

Then run `kilo` in a project directory. See the [CLI docs](https://kilo.ai/cli) for other package managers and [GitHub Releases](https://github.com/Kilo-Org/kilocode/releases) for binaries.

### Highlights

- Generate and edit code across multiple files from natural language.
- Use inline autocomplete, terminal and browser control, and MCP servers.
- Choose from specialized Code, Plan, Ask, Debug, and Review agents—or [create your own](https://kilo.ai/docs/code-with-ai/agents/using-agents).
- Switch between 500+ models during a task.

### Autonomous Mode (CI/CD)

Use `--auto` to run without permission prompts in trusted CI/CD environments:

```bash
kilo run --auto "run tests and fix any failures"
```

### Learn more

- [Documentation](https://kilo.ai/docs)
- [Contributing guide](/CONTRIBUTING.md) and [Code of Conduct](/CODE_OF_CONDUCT.md)
- [Release process](RELEASING.md) ([JetBrains](packages/kilo-jetbrains/RELEASING.md))
- [MIT License](/LICENSE)

Kilo CLI is a fork of [OpenCode](https://github.com/anomalyco/opencode), enhanced for the Kilo agentic engineering platform.

---

**Join the community** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
