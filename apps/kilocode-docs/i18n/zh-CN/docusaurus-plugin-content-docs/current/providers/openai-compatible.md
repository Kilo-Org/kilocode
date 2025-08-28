---
sidebar_label: OpenAI 兼容
---

# 使用 OpenAI 兼容的提供商与 Kilo Code

Kilo Code 支持多种提供 OpenAI API 标准兼容的 AI 模型提供商。这意味着你可以使用 _除了_ OpenAI 之外的其他提供商的模型，同时仍然使用熟悉的 API 接口。这包括以下提供商：

- **本地模型** 通过 Ollama 和 LM Studio 等工具运行（在单独的部分中介绍）。
- **云提供商** 如 Perplexity、Together AI、Anyscale 等。
- **任何其他** 提供 OpenAI 兼容 API 端点的提供商。

本文档重点介绍 _除了_ 官方 OpenAI API 之外的提供商的设置（官方 OpenAI API 有[专门的配置页面](/providers/openai)）。

## 通用配置

使用 OpenAI 兼容提供商的关键是配置两个主要设置：

1.  **基础 URL:** 这是提供商的 API 端点。它 _不会_ 是 `https://api.openai.com/v1`（这是官方 OpenAI API 的地址）。
2.  **API 密钥:** 这是你从提供商处获取的密钥。
3.  **模型 ID:** 这是特定模型的名称。

你可以在 Kilo Code 设置面板中找到这些设置（点击 <Codicon name="gear" /> 图标）：

- **API 提供商:** 选择 "OpenAI 兼容"。
- **基础 URL:** 输入你选择的提供商提供的基础 URL。**这非常关键。**
- **API 密钥:** 输入你的 API 密钥。
- **模型:** 选择一个模型。
- **模型配置:** 这允许你为模型自定义高级配置
    - 最大输出 tokens
    - 上下文窗口
    - 图像支持
    - 计算机使用
    - 输入价格
    - 输出价格

### 完整端点 URL 支持

Kilo Code 支持在基本 URL 字段中输入完整端点 URL，为提供商配置提供更大的灵活性：

**标准基本 URL 格式：**

```
https://api.provider.com/v1
```

**完整端点 URL 格式：**

```
https://api.provider.com/v1/chat/completions
https://custom-endpoint.provider.com/api/v2/models/chat
```

此增强功能允许您：

- 连接到具有非标准端点结构的提供商
- 使用自定义 API 网关或代理服务
- 与需要特定端点路径的提供商合作
- 与企业或自托管 API 部署集成

**注意：** 使用完整端点 URL 时，请确保 URL 指向您的提供商的正确聊天完成端点。

## 支持的模型（适用于 OpenAI 原生端点）

虽然此提供商类型允许连接到各种端点，但如果你直接连接到官方 OpenAI API（或完全镜像它的端点），Kilo Code 会根据其源代码中的 `openAiNativeModels` 定义识别以下模型 ID：

- `o3-mini`
- `o3-mini-high`
- `o3-mini-low`
- `o1`
- `o1-preview`
- `o1-mini`
- `gpt-4.5-preview`
- `gpt-4o`
- `gpt-4o-mini`

**注意:** 如果你使用其他 OpenAI 兼容的提供商（如 Together AI、Anyscale 等），可用的模型 ID 会有所不同。请始终参考你特定提供商的文档以获取支持的模型名称。

## 故障排除

- **"无效的 API 密钥":** 请仔细检查你是否正确输入了 API 密钥。
- **"未找到模型":** 确保你使用的模型 ID 对你选择的提供商有效。
- **连接错误:** 验证基础 URL 是否正确，以及你的提供商 API 是否可访问。
- **意外结果:** 如果你得到意外的结果，请尝试使用不同的模型。

通过使用 OpenAI 兼容的提供商，你可以利用 Kilo Code 的灵活性与更广泛的 AI 模型。请始终参考你提供商的文档以获取最准确和最新的信息。
