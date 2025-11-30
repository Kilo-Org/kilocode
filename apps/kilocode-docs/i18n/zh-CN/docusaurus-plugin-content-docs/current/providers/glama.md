---
sidebar_label: Glama
---

# 使用 Glama 与 Kilo Code

Glama 通过统一的 API 提供了对多种语言模型的访问，包括来自 Anthropic、OpenAI 和其他提供商的模型。它提供了诸如提示缓存和成本跟踪等功能。

**网站：** [https://glama.ai/](https://glama.ai/)

## 获取 API 密钥

1. **注册/登录：** 前往 [Glama 注册页面](https://glama.ai/sign-up)。使用您的 Google 账户或姓名/电子邮件/密码注册。
2. **获取 API 密钥：** 注册后，导航到 [API 密钥](https://glama.ai/settings/gateway/api-keys) 页面以获取 API 密钥。
3. **复制密钥：** 复制显示的 API 密钥。

## 支持的模型

Kilo Code 会自动尝试从 Glama API 获取可用模型的列表。通常通过 Glama 提供的一些模型包括：

- **Anthropic Claude 模型：** （例如，`anthropic/claude-3-5-sonnet`）这些通常推荐用于与 Kilo Code 的最佳性能。
- **OpenAI 模型：** （例如，`openai/o3-mini-high`）
- **其他提供商和开源模型**

请参阅 [Glama 文档](https://glama.ai/models) 获取最新支持的模型列表。

## 在 Kilo Code 中配置

1. **打开 Kilo Code 设置：** 点击 Kilo Code 面板中的齿轮图标 (<Codicon name="gear" />)。
2. **选择提供商：** 从 "API 提供商" 下拉菜单中选择 "Glama"。
3. **输入 API 密钥：** 将您的 Glama API 密钥粘贴到 "Glama API 密钥" 字段中。
4. **选择模型：** 从 "模型" 下拉菜单中选择您想要的模型。

## 提示和注意事项

- **定价：** Glama 采用按使用量计费的模式。根据您选择的模型，定价会有所不同。
- **提示缓存：** Glama 支持提示缓存，这可以显著降低成本并提高重复提示的性能。
