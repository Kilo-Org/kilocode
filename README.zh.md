<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  简体中文 |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">开源 AI 编程智能体 — 基于 OpenCode v2 的 Kilo。</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> 此分支是开发预览版，不是已发布的 Kilo 产品，也不是 v1 的原地升级。它保留 Kilo 原有界面，并将运行时迁移至 v2。预览版使用独立的 `kilo2` 存储；导入必须明确执行，不会自动迁移现有 v1 数据。

---

### 安装

请使用 Bun 1.4 或更高版本。在此代码目录安装依赖后，选择下方的 CLI 或 VS Code 工作流。全新依赖安装及所有平台尚未完成发布验证。已发布的 npm 包和 Marketplace 版本不会安装此分支。

```sh
bun install
```

#### CLI

启动 Kilo 交互式 CLI。可通过参数指定项目目录，例如 `bun run dev /path/to/project`。

```sh
bun run dev
```

#### VS Code

构建并在独立的 VS Code 开发配置中打开原有 Kilo 扩展。请先安装 VS Code，并将 `code` 加入 PATH，或设置 `VSCODE_BIN`。扩展会自动启动本地服务器。扩展迁移仍未完成。

```sh
bun run extension
```

### 智能体

**Code** 实现代码变更。**Plan** 调查问题、质疑假设、保存计划，并提供转入实现阶段的选项。**Ask** 回答问题而不编辑文件。**Debug** 排查问题。仍可配置自定义智能体。可用工具和权限取决于配置。

### 功能

已实现的部分包括原生对话、工具与权限、Gateway 模型与账户集成、设置、记忆、索引、沙箱和终端适配器。完整的原有 VS Code 功能对等、JetBrains、自动补全/FIM、语音及部分云端流程仍待完成。分享、已部署服务验证、签名和跨平台分发仍有未完成的验收条件。存在源代码不代表已通过端到端验收。

### 文档

请查阅迁移计划和测试计划，了解此分支的状态。Kilo 通用文档介绍的是已发布产品，可能与此预览版不同。

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### 贡献

欢迎贡献。修改共享代码前，请阅读贡献指南和 v2 分支约定。尽可能将 Kilo 行为放在专属包中，验证受影响的包，并保留上游署名。

- [贡献](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### 许可证

[MIT](LICENSE)

### FAQ

<details>
<summary>Kilo CLI 从哪里来？</summary>

Kilo CLI 是 [OpenCode](https://github.com/anomalyco/opencode) 的一个 fork，并增强为可在 Kilo agentic engineering 平台中使用。

</details>
