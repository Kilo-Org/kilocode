---
---

import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import { DISCORD_URL } from '@site/src/constants.ts'

# 常见问题解答

本页面解答关于Kilo Code的一些常见问题。

## 一般问题

### 什么是Kilo Code？

Kilo Code是一个开源的Visual Studio Code扩展，它通过生成代码、自动化任务和提供建议来帮助你更高效地编写代码。

### Kilo Code如何工作？

Kilo Code使用大型语言模型（LLMs）来理解你的请求并将其转化为行动。它可以：

- 读取和写入项目中的文件
- 在VS Code终端中执行命令
- 进行网页浏览（如果启用）
- 通过模型上下文协议（MCP）使用外部工具

你通过聊天界面与Kilo Code交互，在其中提供指令并审查/批准其提出的操作。

### Kilo Code能做什么？

Kilo Code可以帮助完成各种编码任务，包括：

- 根据自然语言描述生成代码
- 重构现有代码
- 修复bug
- 编写文档
- 解释代码
- 回答有关代码库的问题
- 自动化重复性任务
- 创建新文件和项目

### Kilo Code是免费的吗？

Kilo Code扩展本身是免费开源的。

之后，你可以添加信用卡购买更多tokens（通过Stripe安全处理）。我们的定价与Anthropic的API费率完全一致。我们不会从每个token或每次充值中抽取任何费用。未来我们将添加更多LLM提供商。

或者，你可以"自带API"（如[Anthropic](providers/anthropic)、[OpenAI](providers/openai)、[OpenRouter](providers/openrouter)、[Requesty](providers/requesty)等）来使用其AI功能。这些提供商通常根据处理的tokens数量收取API使用费用。你需要创建账户并从所选提供商处获取API密钥。详情请参见[设置首个AI提供商](getting-started/connecting-api-provider)。

### 使用Kilo Code有哪些风险？

Kilo Code是一个强大的工具，使用时需要负责任。以下是一些需要注意的事项：

- **Kilo Code可能会出错。** 在批准Kilo Code的更改之前，请仔细审查。
- **Kilo Code可以执行命令。** 在允许Kilo Code运行命令时要非常谨慎，尤其是在使用自动批准时。
- **Kilo Code可以访问互联网。** 如果你使用的提供商支持网页浏览，请注意Kilo Code可能会访问敏感信息。

## 设置与安装

### 如何安装Kilo Code？

请参阅[安装指南](/getting-started/installing)获取详细说明。

### 支持哪些API提供商？

Kilo Code支持多种API提供商，包括：

- [Anthropic (Claude)](/providers/kilocode)
- [Anthropic (Claude)](/providers/anthropic)
- [OpenAI](/providers/openai)
- [OpenRouter](/providers/openrouter)
- [Google Gemini](/providers/gemini)
- [Glama](/providers/glama)
- [AWS Bedrock](/providers/bedrock)
- [GCP Vertex AI](/providers/vertex)
- [Ollama](/providers/ollama)
- [LM Studio](/providers/lmstudio)
- [DeepSeek](/providers/deepseek)
- [Mistral](/providers/mistral)
- [Unbound](/providers/unbound)
- [Requesty](/providers/requesty)
- [VS Code Language Model API](/providers/vscode-lm)

### 如何获取API密钥？

每个API提供商都有自己的API密钥获取流程。请参阅[设置首个AI提供商](/getting-started/connecting-api-provider)获取各提供商的相关文档链接。

### 可以使用本地模型吗？

是的，Kilo Code支持使用[Ollama](/providers/ollama)和[LM Studio](/providers/lmstudio)运行本地模型。请参阅[使用本地模型](/advanced-usage/local-models)获取说明。

## 使用

### 如何开始新任务？

打开Kilo Code面板（<img src="/docs/img/kilo-v1.svg" width="12" />）并在聊天框中输入你的任务。请清晰具体地描述你希望Kilo Code完成的工作。请参阅[输入你的请求](/)获取最佳实践。

### Kilo Code有哪些模式？

[模式](/basic-usage/using-modes)是Kilo Code可以采用的不同的角色，每个角色都有特定的关注点和能力。内置模式包括：

- **Code模式：** 用于通用编码任务
- **Architect模式：** 用于规划和技术领导
- **Ask模式：** 用于回答问题并提供信息
- **Debug模式：** 用于系统化问题诊断
  你还可以创建[自定义模式](/agent-behavior/custom-modes)。

### 如何在模式之间切换？

使用聊天输入区域的下拉菜单选择不同的模式，或者使用`/`命令切换到特定模式。

### 什么是工具，如何使用它们？

[工具](/basic-usage/how-tools-work)是Kilo Code与你的系统交互的方式。Kilo Code会自动选择并使用适当的工具来完成你的任务。你不需要直接调用工具。每次使用工具时，你都会被提示批准或拒绝。

### 什么是上下文提及？

[上下文提及](/basic-usage/context-mentions)是一种为Kilo Code提供项目特定信息的方式，例如文件、文件夹或问题。使用"@"符号后跟你想要提及的项目（例如`@/src/file.ts`，`@problems`）。

### Kilo Code可以访问互联网吗？

是的，如果你使用的提供商支持模型进行网页浏览。请注意允许此功能的安全隐患。

### Kilo Code可以在我的终端中运行命令吗？

是的，Kilo Code可以在你的VS Code终端中执行命令。除非你启用了命令的自动批准，否则在执行每个命令之前，你都会被提示批准。在自动批准命令时要格外小心。如果你在终端命令上遇到问题，请参阅[Shell集成指南](/features/shell-integration)进行故障排除。

### 如何向Kilo Code提供反馈？

你可以通过批准或拒绝Kilo Code的提议操作来提供反馈。你还可以使用反馈字段提供额外的反馈。

### 可以自定义Kilo Code的行为吗？

是的，你可以通过多种方式自定义Kilo Code：

- **自定义指令：** 提供适用于所有模式的通用指令，或特定模式的指令
- **自定义模式：** 创建具有定制提示和工具权限的自定义模式
- **`.clinerules`文件：** 在项目中创建`.clinerules`文件以提供额外的指导
- **设置：** 调整各种设置，如自动批准、差异编辑等

### Kilo Code有自动批准设置吗？

是的，Kilo Code有一些设置，启用后会自动批准操作。了解更多[这里](/features/auto-approving-actions)。

## 高级功能

### 可以离线使用Kilo Code吗？

是的，如果你使用[本地模型](/advanced-usage/local-models)。

### 什么是MCP（模型上下文协议）？

[MCP](/features/mcp/overview)是一种协议，允许Kilo Code与外部服务器通信，通过自定义工具和资源扩展其能力。

### 可以创建自己的MCP服务器吗？

是的，你可以创建自己的MCP服务器来为Kilo Code添加自定义功能。详情请参阅[MCP文档](https://github.com/modelcontextprotocol)。

## 故障排除

### Kilo Code没有响应。我该怎么办？

- 确保你的API密钥正确且未过期
- 检查你的互联网连接
- 检查你选择的API提供商的状态
- 尝试重启VS Code
- 如果问题仍然存在，请在[GitHub](https://github.com/Kilo-Org/kilocode/issues)或[Discord](https://kilo.ai/discord)上报告问题

### 我看到错误消息。这是什么意思？

错误消息应该会提供一些关于问题的信息。如果你不确定如何解决，请在社区论坛中寻求帮助。

### Kilo Code做了我不想要的更改。如何撤销？

Kilo Code使用VS Code内置的文件编辑功能。你可以使用标准的"撤销"命令（Ctrl/Cmd + Z）来还原更改。此外，如果启用了实验性检查点，Kilo可以还原对文件所做的更改。

### 如何报告bug或建议功能？

请在Kilo Code的[问题页面](https://github.com/Kilo-Org/kilocode/issues)和[功能请求页面](https://github.com/Kilo-Org/kilocode/discussions/categories/ideas)上报告bug或建议功能。
