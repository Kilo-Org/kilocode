---
sidebar_label: Unbound
---

# 在 Kilo Code 中使用 Unbound

Kilo Code 支持通过 [Unbound](https://getunbound.ai/) 访问模型，该平台专注于提供安全可靠的多种大型语言模型 (LLMs) 访问。Unbound 充当网关，允许您使用来自 Anthropic 和 OpenAI 等提供商的模型，而无需直接管理多个 API 密钥和配置。他们强调企业级的安全和合规功能。

**网站:** [https://getunbound.ai/](https://getunbound.ai/)

## 创建账户

1. **注册/登录:** 访问 [Unbound 网关](https://gateway.getunbound.ai)。创建账户或登录。
2. **创建应用程序:** 转到 [应用程序](https://gateway.getunbound.ai/ai-gateway-applications) 页面并点击 "创建应用程序" 按钮。
3. **复制 API 密钥:** 将 API 密钥复制到剪贴板。

## 支持的模型

Unbound 允许您在应用程序中配置支持的模型列表，Kilo Code 会自动从 Unbound API 获取可用模型列表。

## 在 Kilo Code 中配置

1. **打开 Kilo Code 设置:** 点击 Kilo Code 面板中的齿轮图标 (<Codicon name="gear" />)。
2. **选择提供商:** 从 "API 提供商" 下拉菜单中选择 "Unbound"。
3. **输入 API 密钥:** 将您的 Unbound API 密钥粘贴到 "Unbound API 密钥" 字段中。
4. **选择模型:** 从 "模型" 下拉菜单中选择您想要的模型。

## 提示和注意事项

- **安全重点:** Unbound 强调企业级的安全功能。如果您的组织对 AI 使用有严格的安全要求，Unbound 可能是一个不错的选择。
