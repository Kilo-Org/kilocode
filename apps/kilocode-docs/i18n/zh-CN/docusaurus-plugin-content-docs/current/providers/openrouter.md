---
sidebar_label: OpenRouter
---

# 在Kilo Code中使用OpenRouter

OpenRouter是一个AI平台，提供来自不同供应商的各种语言模型访问，所有功能都通过单一API实现。这可以简化设置并让你轻松尝试不同模型。

**网站:** [https://openrouter.ai/](https://openrouter.ai/)

## 获取API密钥

1. **注册/登录:** 访问[OpenRouter网站](https://openrouter.ai/)。使用你的Google或GitHub账号登录。
2. **获取API密钥:** 进入[密钥页面](https://openrouter.ai/keys)。你应该能看到列出的API密钥。如果没有，请创建新密钥。
3. **复制密钥:** 复制API密钥。

## 支持的模型

OpenRouter支持大量且不断增长的模型。Kilo Code会自动获取可用模型列表。请参考[OpenRouter模型页面](https://openrouter.ai/models)获取完整和最新的列表。

## 在Kilo Code中配置

1. **打开Kilo Code设置:** 点击Kilo Code面板中的齿轮图标(<Codicon name="gear" />)。
2. **选择供应商:** 从"API Provider"下拉菜单中选择"OpenRouter"。
3. **输入API密钥:** 将OpenRouter API密钥粘贴到"OpenRouter API Key"字段。
4. **选择模型:** 从"Model"下拉菜单中选择你需要的模型。
5. **(可选)自定义基础URL:** 如果需要为OpenRouter API使用自定义基础URL，请勾选"Use custom base URL"并输入URL。大多数用户应留空此项。

## 支持的转换

OpenRouter提供[可选的"middle-out"消息转换](https://openrouter.ai/docs/features/message-transforms)功能，帮助处理超过模型最大上下文大小的提示。你可以通过勾选"Compress prompts and message chains to the context size"框来启用它。

## 提示和注意事项

- **模型选择:** OpenRouter提供多种模型。尝试找到最适合你需求的模型。
- **定价:** OpenRouter根据基础模型的定价收费。详情请参阅[OpenRouter模型页面](https://openrouter.ai/models)。
- **提示缓存:** 部分供应商支持提示缓存。请参阅OpenRouter文档了解支持的模型。
