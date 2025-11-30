---
sidebar_label: OpenAI
---

# 在 Kilo Code 中使用 OpenAI

Kilo Code 支持通过官方 OpenAI API 直接访问模型。

**官方网站:** [https://openai.com/](https://openai.com/)

## 获取 API 密钥

1. **注册/登录:** 访问 [OpenAI 平台](https://platform.openai.com/)。创建账户或登录
2. **导航到 API 密钥:** 前往 [API keys](https://platform.openai.com/api-keys) 页面
3. **创建密钥:** 点击 "Create new secret key"。为密钥起一个描述性名称（如 "Kilo Code"）
4. **复制密钥:** **重要:** 立即复制 API 密钥。之后将无法再次查看。请安全存储

## 支持的模型

Kilo Code 支持多种 OpenAI 模型，包括：

- `o3-mini` (中等推理能力)
- `o3-mini-high` (高推理能力)
- `o3-mini-low` (低推理能力)
- `o1`
- `o1-preview`
- `o1-mini`
- `gpt-4.5-preview`
- `gpt-4o`
- `gpt-4o-mini`

请参考 [OpenAI 模型文档](https://platform.openai.com/docs/models) 获取最新的模型列表和能力说明。

## 在 Kilo Code 中配置

1. **打开 Kilo Code 设置:** 点击 Kilo Code 面板中的齿轮图标 (<Codicon name="gear" />)
2. **选择提供商:** 从 "API Provider" 下拉菜单中选择 "OpenAI"
3. **输入 API 密钥:** 将你的 OpenAI API 密钥粘贴到 "OpenAI API Key" 字段
4. **选择模型:** 从 "Model" 下拉菜单中选择你需要的模型

## 提示和注意事项

- **定价:** 请参考 [OpenAI 定价](https://openai.com/pricing) 页面了解模型成本详情
- **Azure OpenAI 服务:** 如需使用 Azure OpenAI 服务，请参阅我们的 [OpenAI 兼容](/providers/openai-compatible) 提供商章节
