---
sidebar_label: Claude Code
---

# 在 Kilo Code 中使用 Claude Code

Claude Code 是 Anthropic 的官方 CLI，它提供从终端直接访问 Claude 模型的功能。在 Kilo Code 中使用 Claude Code 可以让您利用现有的 CLI 设置，而无需单独的 API 密钥。

**网站：** [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)

## 安装和设置 Claude Code

1.  **安装 Claude Code：** 按照 [Anthropic 的 Claude Code 文档](https://docs.anthropic.com/en/docs/claude-code/setup)中的安装说明进行操作。
2.  **身份验证：** 在终端中运行 `claude`。Claude Code 提供多种身份验证选项，包括 Anthropic Console（默认）、带有 Pro/Max 计划的 Claude App 以及 Amazon Bedrock 或 Google Vertex AI 等企业平台。有关完整详细信息，请参阅 [Anthropic 的身份验证文档](https://docs.anthropic.com/en/docs/claude-code/setup)。
3.  **验证安装：** 在终端中运行 `claude --version` 以测试一切是否正常。

## 支持的模型

Kilo Code 通过 Claude Code 支持以下 Claude 模型：

*   `claude-sonnet-4`（推荐）
*   `claude-4-opus`

可用的特定模型取决于您的 Claude 订阅和计划。有关每个模型功能的更多详细信息，请参阅 [Anthropic 的模型文档](https://docs.anthropic.com/en/docs/about-claude/models)。

## Kilo Code 中的配置

1.  **打开 Kilo Code 设置：** 单击 Kilo Code 面板中的齿轮图标（<Codicon name="gear" />）。
2.  **选择提供商：** 从“API 提供商”下拉菜单中选择“Claude Code”。
3.  **选择模型：** 从“模型”下拉菜单中选择您想要的 Claude 模型。
4.  **（可选）自定义 CLI 路径：** 如果您将 Claude Code 安装到默认 `claude` 命令以外的位置，请在“Claude Code 路径”字段中输入 Claude 可执行文件的完整路径。大多数用户不需要更改此项。

## 提示和注意事项

*   **无需 API 密钥：** Claude Code 使用您现有的 CLI 身份验证，因此您无需管理单独的 API 密钥。
*   **成本透明：** 使用成本由 Claude CLI 直接报告，让您清楚地了解您的支出。
*   **高级推理：** 完全支持 Claude 的思考模式和推理功能（如果可用）。
*   **上下文窗口：** Claude 模型具有大型上下文窗口，允许您在提示中包含大量代码和上下文。
*   **增强提示功能：** 完全兼容 Kilo Code 的增强提示功能，允许您在将提示发送到 Claude 之前自动改进和优化提示。
*   **自定义路径：** 如果您将 Claude Code 安装在非标准位置，您可以在设置中指定完整路径。示例：
    *   Windows：`C:\tools\claude\claude.exe`
    *   macOS/Linux：`/usr/local/bin/claude` 或 `~/bin/claude`

## 故障排除

*   **“Claude Code 进程退出并出现错误”：** 验证 Claude Code 是否已安装（`claude --version`）并已通过身份验证（`claude auth login`）。确保您的订阅包含所选模型。
*   **自定义路径不起作用：** 使用 Claude 可执行文件的完整绝对路径，并验证文件是否存在且可执行。在 Windows 上，包含 `.exe` 扩展名。
