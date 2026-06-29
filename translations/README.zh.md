<p align="center">
  <a href="../README.md">English</a> | 简体中文 | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">用于在 VS Code、JetBrains 或 CLI 中借助 AI 构建的开源编码代理。</p>

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

Kilo Code 是一个 AI 编码代理，可以在你工作的任何地方使用：[VS Code](https://kilo.ai/landing/vs-code)、[JetBrains](https://kilo.ai/features/jetbrains-native) 和 [CLI](https://kilo.ai/cli)。它是开源的，并采用开放定价。你可以从 500 多个模型中选择，在任务中途切换模型，并按模型提供商的价格付费，没有加价。开始使用无需 API 密钥。

### 安装

选择你想运行 Kilo 的位置。

<details open>
<summary><strong>VS Code</strong></summary>

<br>

直接安装 [Kilo Code 扩展](vscode:extension/kilocode.kilo-code)，或从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) 获取。创建账户后，你可以按提供商价格访问 500 多个模型，包括 GPT-5.5、Claude Opus 4.7、Claude Sonnet 4.6 和 Gemini 3.1 Pro Preview。

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

然后在任意项目目录中运行 `kilo` 即可开始。

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

从 JetBrains Marketplace 安装 [Kilo Code 插件](https://plugins.jetbrains.com/plugin/28350-kilo-code)，或在任意 JetBrains IDE 的 `Settings → Plugins` 中搜索 "Kilo Code"。

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

无需本地机器，在 Web 上通过 [app.kilo.ai/cloud](https://app.kilo.ai/cloud) 运行 Kilo。

</details>

<details>
<summary><strong>代码审查</strong></summary>

<br>

在 [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews) 为你的 Pull Request 设置自动 AI 代码审查。

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

在 [app.kilo.ai/claw](https://app.kilo.ai/claw) 启动你的常驻 AI 代理。

</details>

<details>
<summary>从 GitHub Releases 安装 CLI（二进制文件）</summary>

从 [Releases 页面](https://github.com/Kilo-Org/kilocode/releases) 下载最新二进制文件。

| 平台 | 资源 |
|---|---|
| Windows（大多数 PC） | `kilo-windows-x64.zip` |
| macOS（Apple Silicon） | `kilo-darwin-arm64.zip` |
| macOS（Intel） | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

说明：`x64-baseline` 是面向不支持 AVX 的旧 CPU 的兼容构建。`musl` 是面向 Alpine 或无 glibc 的极简 Docker 镜像的静态链接构建。`kilo-vscode-*.vsix` 是 VS Code 扩展包，不是 CLI。`Source code` 压缩包用于从源码构建。

</details>

### Agents

Kilo 内置了可按任务切换的专用 Agents。你也可以构建自己的自定义 Agents。

- **Code** - 默认模式。根据自然语言实现和编辑代码。
- **Plan** - 在编写任何代码之前设计架构并编写实现计划。
- **Ask** - 回答有关代码库的问题，不修改任何文件。
- **Debug** - 排查并追踪问题。
- **Review** - 审查你的更改，并从性能、安全、风格和测试覆盖率等方面发现问题。

了解更多关于 [agents 和自定义 agents](https://kilo.ai/docs/code-with-ai/agents/using-agents) 的信息。

### 功能

- **代码生成**：基于自然语言跨多个文件生成代码。
- **内联自动补全**：提供 ghost-text 建议，按 Tab 接受。
- **自检**：让代理审查并修正自己的工作。
- **终端和浏览器控制**：运行命令并自动化网页操作。
- **MCP 市场**：查找并连接 MCP 服务器，扩展代理能力。
- **500 多个模型**：支持任务中途切换，让你根据延迟、成本和推理能力匹配任务。

### 自主模式（CI/CD）

使用 `--auto` 运行 `kilo run`，可在 CI/CD 流水线中实现无提示的完全自主操作：

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` 会禁用所有权限提示，并允许代理在无需确认的情况下执行任何操作。仅在可信环境中使用。

### 文档

关于配置和其他内容，请查看[文档](https://kilo.ai/docs)。

### 贡献

欢迎开发者、写作者以及所有人参与贡献。请先阅读 [Contributing Guide](/CONTRIBUTING.md)，了解环境设置、编码标准以及如何创建 Pull Request。VS Code 扩展和 CLI 的发布流程请参阅 [RELEASING.md](../RELEASING.md)，JetBrains 插件请参阅 [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md)。

参与前请阅读我们的 [Code of Conduct](/CODE_OF_CONDUCT.md)。

### 许可证

MIT。你可以使用、修改和分发此代码，包括商业用途，只要保留署名和许可证声明。参见 [License](/LICENSE)。

### FAQ

<details>
<summary>Kilo CLI 从哪里来？</summary>

Kilo CLI 是 [OpenCode](https://github.com/Kilo-Org/kilocode) 的一个 fork，并增强为可在 Kilo agentic engineering 平台中使用。

</details>

---

**加入社区** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
