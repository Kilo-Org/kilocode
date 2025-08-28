---
sidebar_label: Google Gemini
---

# 在Kilo Code中使用Google Gemini

Kilo Code通过Google AI Gemini API支持Google的Gemini系列模型。

**官网:** [https://ai.google.dev/](https://ai.google.dev/)

## 获取API密钥

1. **访问Google AI Studio:** 打开[https://ai.google.dev/](https://ai.google.dev/)
2. **登录:** 使用Google账号登录
3. **创建API密钥:** 点击左侧菜单中的"Create API key"
4. **复制API密钥:** 复制生成的API密钥

## 支持的模型

Kilo Code支持以下Gemini模型：

### 聊天模型

- `gemini-2.5-pro-exp-03-25`
- `gemini-2.0-flash-001`
- `gemini-2.0-flash-lite-preview-02-05`
- `gemini-2.0-pro-exp-02-05`
- `gemini-2.0-flash-thinking-exp-01-21`
- `gemini-2.0-flash-thinking-exp-1219`
- `gemini-2.0-flash-exp`
- `gemini-1.5-flash-002`
- `gemini-1.5-flash-exp-0827`
- `gemini-1.5-flash-8b-exp-0827`
- `gemini-1.5-pro-002`
- `gemini-1.5-pro-exp-0827`
- `gemini-exp-1206`

### 嵌入模型

- `gemini-embedding-001` - 针对代码库索引和语义搜索进行了优化

有关每个模型的更多详细信息，请参阅 [Gemini 文档](https://ai.google.dev/models/gemini)。

## 在Kilo Code中的配置

1. **打开Kilo Code设置:** 点击Kilo Code面板中的齿轮图标(<Codicon name="gear" />)
2. **选择提供商:** 在"API Provider"下拉菜单中选择"Google Gemini"
3. **输入API密钥:** 将Gemini API密钥粘贴到"Gemini API Key"字段
4. **选择模型:** 从"Model"下拉菜单中选择所需的Gemini模型

## 提示与注意事项

- **定价:** Gemini API使用根据输入和输出的token计费。参考[Gemini定价页面](https://ai.google.dev/pricing)获取详细信息。
- **代码库索引：** `gemini-embedding-001` 模型专门支持[代码库索引](/features/codebase-indexing)，为语义代码搜索提供高质量嵌入。
