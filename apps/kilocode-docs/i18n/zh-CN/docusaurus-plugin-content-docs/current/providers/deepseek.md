---
sidebar_label: DeepSeek
---

# 在Kilo Code中使用DeepSeek

Kilo Code支持通过DeepSeek API访问模型，包括`deepseek-chat`和`deepseek-reasoner`。

**官方网站:** [https://platform.deepseek.com/](https://platform.deepseek.com/)

## 获取API Key

1. **注册/登录:** 访问[DeepSeek平台](https://platform.deepseek.com/)。创建账号或登录。
2. **导航到API密钥:** 在平台的[API密钥](https://platform.deepseek.com/api_keys)部分找到你的API密钥。
3. **创建密钥:** 点击"Create new API key"。为密钥起一个描述性名称(例如"Kilo Code")。
4. **复制密钥:** **重要:** 立即复制API密钥，之后将无法再次查看。请安全存储。

## 支持的模型

Kilo Code支持以下DeepSeek模型：

- `deepseek-chat` (推荐用于编码任务)
- `deepseek-reasoner` (推荐用于推理任务)

## 在Kilo Code中配置

1. **打开Kilo Code设置:** 点击Kilo Code面板中的齿轮图标(<Codicon name="gear" />)
2. **选择提供商:** 从"API Provider"下拉菜单中选择"DeepSeek"
3. **输入API密钥:** 将DeepSeek API密钥粘贴到"DeepSeek API Key"字段
4. **选择模型:** 从"Model"下拉菜单中选择所需模型

## 提示和注意事项

- **价格:** 参考[DeepSeek定价](https://api-docs.deepseek.com/quick_start/pricing/)页面了解模型费用详情
