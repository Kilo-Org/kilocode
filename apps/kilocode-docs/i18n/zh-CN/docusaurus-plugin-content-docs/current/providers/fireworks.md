---
sidebar_label: Fireworks AI
---

# 在 Kilo Code 中使用 Fireworks AI

Fireworks AI 是一个高性能的 AI 模型运行平台，可以快速访问各种开源和专有语言模型。它专为速度和可靠性而构建，提供无服务器和专用部署选项，并兼容 OpenAI API。

**网站：** [https://fireworks.ai/](https://fireworks.ai/)

---

## 获取 API 密钥

1. **注册/登录：** 前往 [Fireworks AI](https://fireworks.ai/) 创建账户或登录。
2. **导航到 API 密钥：** 登录后，在账户设置中进入 [API Keys 页面](https://app.fireworks.ai/settings/users/api-keys)。
3. **创建密钥：** 点击 "Create API key" 并为您的密钥输入一个描述性名称（例如 "Kilo Code"）。
4. **复制密钥：** _立即_ 复制 API 密钥并安全存储。您将无法再次查看它。

---

## 支持的模型

Kilo Code 支持以下 Fireworks AI 模型：

- `accounts/fireworks/models/kimi-k2-instruct` - Kimi K2 指令调优模型
- `accounts/fireworks/models/qwen3-235b-a22b-instruct-2507` - Qwen 3 235B 指令调优模型
- `accounts/fireworks/models/qwen3-coder-480b-a35b-instruct` - Qwen 3 Coder 480B 代码生成模型
- `accounts/fireworks/models/deepseek-r1-0528` - DeepSeek R1 推理模型
- `accounts/fireworks/models/deepseek-v3` - DeepSeek V3 最新一代模型

---

## 在 Kilo Code 中配置

1. **打开 Kilo Code 设置：** 在 Kilo Code 面板中点击齿轮图标 (<Codicon name="gear" />)。
2. **选择提供商：** 从 "API Provider" 下拉菜单中选择 "Fireworks AI"。
3. **输入 API 密钥：** 将您的 Fireworks AI API 密钥粘贴到 "Fireworks AI API Key" 字段中。
4. **选择模型：** 从 "Model" 下拉菜单中选择您想要的模型。

---

## 提示和注意事项

- **性能：** Fireworks AI 针对速度进行了优化，在聊天和完成任务方面都提供出色的性能。
- **定价：** 请参考 [Fireworks AI 定价](https://fireworks.ai/pricing) 页面了解当前定价信息。
- **速率限制：** Fireworks AI 有基于使用量的速率限制。请在控制台中监控您的使用情况，如有需要请考虑升级您的计划。
