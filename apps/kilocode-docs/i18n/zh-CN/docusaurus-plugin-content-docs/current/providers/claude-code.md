---
sidebar_label: Claude Code
---

# 在 Kilo Code 中使用 Claude Code

Claude Code 是 Anthropic 的官方 CLI，它提供从终端直接访问 Claude 模型的功能。在 Kilo Code 中使用 Claude Code 可以让你利用现有的 CLI 设置，而无需单独的 API 密钥。

**网站：** [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)

## 安装和设置 Claude Code

1. **安装 Claude Code：** 请按照 [Anthropic 的 Claude Code 文档](https://docs.anthropic.com/en/docs/claude-code/setup)中的安装说明进行操作。
2. **认证：** 在终端中运行 `claude`。Claude Code 提供多种认证选项，包括 Anthropic 控制台（默认）、Claude 应用程序（Pro/Max 计划）以及 Amazon Bedrock 或 Google Vertex AI 等企业平台。完整详情请参见 [Anthropic 的认证文档](https://docs.anthropic.com/en/docs/claude-code/setup)。
3. **验证安装：** 通过在终端中运行 `claude --version` 来测试是否一切正常工作。

:::warning 环境变量使用
`claude` 命令行工具与其他 Anthropic SDK 一样，可以使用 `ANTHROPIC_API_KEY` 环境变量进行身份验证。这是在非交互式环境中授权 CLI 工具的常见方法。

如果此环境变量在您的系统中已设置，`claude` 工具可能会使用它进行身份验证，而不是使用交互式的 `/login` 方法。当 Kilo Code 执行该工具时，它将准确反映正在使用 API 密钥，因为这是 `claude` CLI 本身的底层行为。
:::

**Website:** [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)

## 支持的模型

Kilo Code 通过 Claude Code 支持以下 Claude 模型：

- **Claude Opus 4.1**（能力最强）
- **Claude Opus 4**
- **Claude Sonnet 4**（最新，推荐）
- **Claude 3.7 Sonnet**
- **Claude 3.5 Sonnet**
- **Claude 3.5 Haiku**（快速响应）

可用的特定模型取决于你的 Claude 订阅和计划。有关每个模型功能的更多详细信息，请参阅 [Anthropic 的模型文档](https://docs.anthropic.com/en/docs/about-claude/models)。

## Kilo Code 中的配置

1.  **打开 Kilo Code 设置：** 单击 Kilo Code 面板中的齿轮图标（<Codicon name="gear" />）。
2.  **选择提供商：** 从“API 提供商”下拉菜单中选择“Claude Code”。
3.  **选择模型：** 从“模型”下拉菜单中选择你想要的 Claude 模型。
4.  **（可选）自定义 CLI 路径：** 如果你将 Claude Code 安装到默认 `claude` 命令以外的位置，请在“Claude Code 路径”字段中输入 Claude 可执行文件的完整路径。大多数用户不需要更改此项。

## 提示和注意事项

- **No API Keys Required:** Claude Code uses your existing CLI authentication, so you don't need to manage separate API keys.
- **成本透明:** 使用成本由 Claude CLI 直接报告，让你清楚了解支出情况。
- **高级推理:** 完全支持 Claude 的思维模式和推理能力（当可用时）。
- **上下文窗口:** Claude 模型具有大上下文窗口，允许你在提示中包含大量代码和上下文。
- **增强提示功能:** 与 Kilo Code 的增强提示功能完全兼容，允许你在将提示发送给 Claude 之前自动改进和优化提示。
- **自定义路径:** 如果你将 Claude Code 安装在非默认位置，可以在设置中指定完整路径。例如：
    - Windows: `C:\tools\claude\claude.exe`
    - macOS/Linux: `/usr/local/bin/claude` 或 `~/bin/claude`

## 故障排除

- **"Claude Code process exited with error":** 验证 Claude Code 是否已安装 (`claude --version`) 和已认证 (`claude auth login`)。确保你的订阅包含所选模型。
- **自定义路径不工作:** 使用指向 Claude 可执行文件的完整绝对路径，并验证文件存在且可执行。在 Windows 上，包含 `.exe` 扩展名。
