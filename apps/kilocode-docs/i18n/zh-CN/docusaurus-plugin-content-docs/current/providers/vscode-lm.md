---
sidebar_label: VS Code 语言模型 API
---

# 在 Kilo Code 中使用 VS Code 语言模型 API

Kilo Code 包含对 [VS Code 语言模型 API](https://code.visualstudio.com/api/language-extensions/language-model-access) 的*实验性*支持。该 API 允许扩展直接在 VS Code 中提供对语言模型的访问。这意味着您可以潜在使用以下模型：

- **GitHub Copilot:** 如果您有 Copilot 订阅并安装了该扩展。
- **其他 VS Code 扩展:** 任何实现语言模型 API 的扩展。

**重要提示:** 此集成是高度实验性的，可能无法按预期工作。它依赖于其他扩展正确实现 VS Code 语言模型 API。

## 先决条件

- **VS Code:** 语言模型 API 通过 VS Code 提供（目前不支持 Cursor）。
- **语言模型提供者扩展:** 您需要一个提供语言模型的扩展。示例包括：
    - **GitHub Copilot:** 如果您有 Copilot 订阅，GitHub Copilot 和 GitHub Copilot Chat 扩展可以提供模型。
    - **其他扩展:** 在 VS Code 市场搜索提到 "Language Model API" 或 "lm" 的扩展。可能会有其他实验性扩展可用。

## 配置

1.  **打开 Kilo Code 设置:** 点击 Kilo Code 面板中的齿轮图标 (<Codicon name="gear" />)。
2.  **选择提供商:** 从 "API 提供商" 下拉菜单中选择 "VS Code LM API"。
3.  **选择模型:** "语言模型" 下拉菜单将（最终）列出可用模型。格式为 `供应商/系列`。例如，如果您有 Copilot，您可能会看到以下选项：
    - `copilot - claude-3.5-sonnet`
    - `copilot - o3-mini`
    - `copilot - o1-ga`
    - `copilot - gemini-2.0-flash`

## 限制

- **实验性 API:** VS Code 语言模型 API 仍在开发中。预计会有变化和潜在的不稳定性。
- **依赖扩展:** 此功能完全依赖其他扩展提供模型。Kilo Code 无法直接控制哪些模型可用。
- **功能有限:** VS Code 语言模型 API 可能不支持其他 API 提供商的所有功能（例如，图像输入、流式传输、详细使用信息）。
- **无法直接控制成本:** 您将受提供模型的扩展的定价和条款约束。Kilo Code 无法直接跟踪或限制成本。
- **GitHub Copilot 速率限制:** 使用 VS Code LM API 与 GitHub Copilot 时，请注意 GitHub 可能会对 Copilot 使用施加速率限制。这些限制由 GitHub 控制，而非 Kilo Code。

## 故障排除

- **没有模型出现:**
    - 确保已安装 VS Code。
    - 确保已安装并启用了语言模型提供者扩展（例如，GitHub Copilot, GitHub Copilot Chat）。
    - 如果使用 Copilot，请确保您已使用您想要使用的模型发送了 Copilot Chat 消息。
- **意外行为:** 如果遇到意外行为，很可能是底层语言模型 API 或提供者扩展的问题。请考虑向提供者扩展的开发人员报告问题。
