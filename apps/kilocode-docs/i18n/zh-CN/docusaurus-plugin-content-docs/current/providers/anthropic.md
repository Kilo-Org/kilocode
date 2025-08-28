---
sidebar_label: Anthropic
---

# 在 Kilo Code 中使用 Anthropic

Anthropic 是一家专注于 AI 安全和研究的公司，致力于构建可靠、可解释且可控的 AI 系统。他们的 Claude 模型以强大的推理能力、实用性和诚实性著称。

**官网:** [https://www.anthropic.com/](https://www.anthropic.com/)

## 获取 API 密钥

1. **注册/登录:** 访问 [Anthropic 控制台](https://console.anthropic.com/)。创建账户或登录现有账户
2. **导航至 API 密钥:** 进入 [API keys](https://console.anthropic.com/settings/keys) 页面
3. **创建密钥:** 点击 "Create Key"。为密钥命名（如 "Kilo Code"）
4. **复制密钥:** **重要:** 立即复制 API 密钥，之后将无法再次查看。请妥善保存

## 支持的模型

Kilo Code 支持以下 Anthropic Claude 模型：

- `claude-3-7-sonnet-20250219` (推荐)
- `claude-3-7-sonnet-20250219:thinking` (扩展思考版)
- `claude-3-5-sonnet-20241022`
- `claude-3-5-haiku-20241022`
- `claude-3-opus-20240229`
- `claude-3-haiku-20240307`

查看 [Anthropic 模型文档](https://docs.anthropic.com/en/docs/about-claude/models) 获取各模型能力的详细信息

## 在 Kilo Code 中配置

1. **打开 Kilo Code 设置:** 点击 Kilo Code 面板中的齿轮图标 (<Codicon name="gear" />)
2. **选择提供商:** 在 "API Provider" 下拉菜单中选择 "Anthropic"
3. **输入 API 密钥:** 将 Anthropic API 密钥粘贴到 "Anthropic API Key" 字段
4. **选择模型:** 从 "Model" 下拉列表中选择所需的 Claude 模型
5. **(可选) 自定义基础 URL:** 如需使用自定义 Anthropic API 基础 URL，勾选 "Use custom base URL" 并输入 URL。大多数用户无需修改此项

## 提示与注意事项

- **提示缓存:** Claude 3 模型支持 [提示缓存](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)，可显著降低重复提示的成本和延迟
- **上下文窗口:** Claude 模型具有大容量上下文窗口 (200,000 tokens)，可在提示中包含大量代码和上下文
- **定价:** 参考 [Anthropic 定价](https://www.anthropic.com/pricing) 页面获取最新价格信息
- **速率限制:** Anthropic 根据 [使用层级](https://docs.anthropic.com/en/api/rate-limits#requirements-to-advance-tier) 设有严格速率限制。如频繁遇到限制，请联系 Anthropic 销售或通过 [OpenRouter](/providers/openrouter) 等其它提供商访问 Claude
