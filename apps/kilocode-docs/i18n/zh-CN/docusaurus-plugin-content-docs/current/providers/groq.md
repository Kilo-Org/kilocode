---
sidebar_label: Groq
---

# 在 Kilo Code 中使用 Groq

Groq 通过其高性能基础设施为各种 AI 模型提供超快速推理。Kilo Code 支持通过 Groq API 访问模型。

**网站：** [https://groq.com/](https://groq.com/)

## 获取 API 密钥

要将 Groq 与 Kilo Code 一起使用，您需要从 [GroqCloud 控制台](https://console.groq.com/)获取 API 密钥。注册或登录后，导航到仪表板的 API 密钥部分以创建和复制您的密钥。

## 支持的模型

Kilo Code 将尝试从 Groq API 获取可用模型列表。通过 Groq 通常可用的模型包括：

- `llama3-8b-8192`
- `llama3-70b-8192`
- `mixtral-8x7b-32768`
- `gemma-7b-it`
- `moonshotai/kimi-k2-instruct` (Kimi K2 模型)

**注意：** 模型可用性和规格可能会发生变化。请参阅 [Groq 文档](https://console.groq.com/docs/models)以获取最新支持的模型列表及其功能。

## Kilo Code 中的配置

1.  **打开 Kilo Code 设置：** 单击 Kilo Code 面板中的齿轮图标（<Codicon name="gear" />）。
2.  **选择提供商：** 从“API 提供商”下拉菜单中选择“Groq”。
3.  **输入 API 密钥：** 将您的 Groq API 密钥粘贴到“Groq API 密钥”字段中。
4.  **选择模型：** 从“模型”下拉菜单中选择您想要的模型。

## 提示和注意事项

- **高速推理：** Groq 的 LPU 提供异常快速的响应时间，使其成为交互式开发工作流的理想选择。
- **Token 限制：** 某些模型具有特定的 `max_tokens` 限制，Kilo Code 会自动处理（例如，`moonshotai/kimi-k2-instruct` 模型）。
- **成本效益：** 高性能推理具有竞争力的定价。
- **模型选择：** 根据您的特定需求选择模型 - 对于复杂推理任务，选择 `llama3-70b-8192` 等大型模型，或者对于更快、更简单的操作，选择 `llama3-8b-8192` 等小型模型。

## 支持的模型

Kilo Code 通过 Groq 支持以下模型：

| Model ID                      | Provider    | Context Window | Notes                        |
| ----------------------------- | ----------- | -------------- | ---------------------------- |
| `moonshotai/kimi-k2-instruct` | Moonshot AI | 128K tokens    | 已配置优化 `max_tokens` 限制 |
| `llama-3.3-70b-versatile`     | Meta        | 128K tokens    | 高性能 Llama 模型            |
| `llama-3.1-70b-versatile`     | Meta        | 128K tokens    | 通用推理能力                 |
| `llama-3.1-8b-instant`        | Meta        | 128K tokens    | 快速推理，适用于快速任务     |
| `mixtral-8x7b-32768`          | Mistral AI  | 32K tokens     | 专家混合架构                 |

**注意：** 模型可用性可能会发生变化。请参阅 [Groq 文档](https://console.groq.com/docs/models)以获取最新的模型列表和规格。

## Kilo Code 中的配置

1.  **打开 Kilo Code 设置：** 单击 Kilo Code 面板中的齿轮图标（<Codicon name="gear" />）。
2.  **选择提供商：** 从“API 提供商”下拉菜单中选择“Groq”。
3.  **输入 API 密钥：** 将您的 Groq API 密钥粘贴到“Groq API 密钥”字段中。
4.  **选择模型：** 从“模型”下拉菜单中选择您想要的模型。

## 模型特定功能

### Kimi K2 模型

`moonshotai/kimi-k2-instruct` 模型包含优化配置：

- **最大 Token 限制：** 自动配置适当的限制以获得最佳性能
- **上下文理解：** 非常适合复杂推理和长上下文任务
- **多语言支持：** 在多种语言中表现出色

## 提示和注意事项

- **超快速推理：** Groq 的硬件加速提供异常快速的响应时间
- **成本效益：** 高性能推理具有竞争力的定价
- **速率限制：** 请注意根据您的 Groq 计划的 API 速率限制
- **模型选择：** 根据您的特定用例选择模型：
    - **Kimi K2**：最适合复杂推理和多语言任务
    - **Llama 3.3 70B**：出色的通用性能
    - **Llama 3.1 8B Instant**：最快的响应，适用于简单任务
    - **Mixtral**：性能和效率的良好平衡

## 故障排除

- **“无效 API 密钥”：** 验证您的 API 密钥在 Groq 控制台中是否正确且处于活动状态
- **“模型不可用”：** 检查所选模型在您所在区域是否可用
- **速率限制错误：** 在 Groq 控制台中监视您的使用情况并考虑升级您的计划
- **连接问题：** 确保您有稳定的互联网连接并且 Groq 服务正常运行

## 定价

Groq 根据输入和输出 token 提供有竞争力的定价。访问 [Groq 定价页面](https://groq.com/pricing/)以获取当前费率和计划选项。
