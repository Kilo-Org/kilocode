---
sidebar_label: Mistral AI
---

# 在 Kilo Code 中使用 Mistral AI

Kilo Code 支持通过 Mistral AI API 访问模型，包括标准 Mistral 模型和代码专用 Codestral 模型。

**网站：** [https://mistral.ai/](https://mistral.ai/)

## 获取 API 密钥

1.  **注册/登录：** 访问 [Mistral 平台](https://console.mistral.ai/)。创建帐户或登录。您可能需要通过验证过程。
2.  **创建 API 密钥：**
    - [La Plateforme API 密钥](https://console.mistral.ai/api-keys/)和/或
    - [Codestral API 密钥](https://console.mistral.ai/codestral)

## 支持的模型

Kilo Code 支持以下 Mistral 模型：

| 模型 ID              | 模型默认温度 | 函数调用 | 视觉/图像支持 |
| -------------------- | ------------ | -------- | ------------- |
| codestral-latest     | 0.3          | ✅       | ❌            |
| devstral             | 0.3          | ✅       | ❌            |
| mistral-large-latest | 0.7          | ✅       | ❌            |
| ministral-8b-latest  | 0.3          | ✅       | ❌            |
| ministral-3b-latest  | 0.3          | ✅       | ❌            |
| mistral-small-latest | 0.3          | ✅       | ❌            |
| pixtral-large-latest | 0.7          | ✅       | ✅            |

Kilo Code中的默认模型温度为0.0，因此您应该考虑尝试[调整温度](/features/model-temperature)！

**注意:** 模型的可用性和规格可能会发生变化。
请参考[Mistral AI文档](https://docs.mistral.ai/api/)和[Mistral模型概述](https://docs.mistral.ai/getting-started/models/models_overview/)获取最新信息。

## 在Kilo Code中配置

1. **打开Kilo Code设置:** 点击Kilo Code面板中的齿轮图标(<Codicon name="gear" />)。
2. **选择提供商:** 从"API提供商"下拉菜单中选择"Mistral"。
3. **输入API密钥:** 如果您使用`mistral`模型，请将Mistral API密钥粘贴到"Mistral API密钥"字段中。如果您打算使用`codestral-latest`，请参阅下面的"Codestral"部分。
4. **选择模型:** 从"模型"下拉菜单中选择所需的模型。

## 使用Codestral

[Codestral](https://docs.mistral.ai/capabilities/code_generation/)是一个专门用于代码生成和交互的模型。
只有Codestral可以使用不同的端点(默认: codestral.mistral.ai)。
对于La Platforme API密钥，请将**Codestral基础URL**更改为: https://api.mistral.ai

要使用Codestral:

1. **选择"Mistral"作为API提供商。**
2. **选择Codestral模型**
3. **输入您的Codestral (codestral.mistral.ai)或La Plateforme (api.mistral.ai) API密钥。**
