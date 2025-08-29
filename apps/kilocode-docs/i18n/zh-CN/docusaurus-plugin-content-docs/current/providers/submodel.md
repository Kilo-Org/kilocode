---
sidebar_label: Submodel
---

# 在 Kilo Code 中使用 Submodel

Submodel 是一个 AI 模型服务平台，通过其 InstaGen 推理集群服务提供对多种先进语言模型的访问。该平台采用按使用量计费的模式，并为某些模型提供免费的每日配额。

**网站：** [https://submodel.ai](https://submodel.ai)

## 获取 Access 密钥

1. **注册/登录：** 访问 [Submodel 登录页面](https://submodel.ai/#/login?redirect=%2Fmodelservice%2Fmodels) 进行账户注册或登录。
2. **获取 Access 密钥：** 登录成功后，在控制面板中找到 Access 密钥管理页面。
3. **复制密钥：** 复制显示的 Access 密钥。

## 支持的模型

Kilo Code 会自动从 Submodel API 获取可用模型列表。Submodel 通过 InstaGen 服务提供多种先进的语言模型。

请参考 [Submodel 官方文档](https://submodel.gitbook.io/docs/instagen/overview) 获取最新的支持模型列表和详细信息。

## 在 Kilo Code 中配置

1. **打开 Kilo Code 设置：** 点击 Kilo Code 面板中的齿轮图标 (<Codicon name="gear" />)。
2. **选择提供商：** 从 "API 提供商" 下拉菜单中选择 "Submodel"。
3. **输入 API 密钥：** 将您的 Submodel API 密钥粘贴到 "Submodel Access Key" 字段中。
4. **选择模型：** 从 "模型" 下拉菜单中选择您想要使用的模型。

## 提示和注意事项

- **定价：** Submodel 采用按使用量计费的模式，根据实际使用情况收费。
- **免费配额：** 针对某些模型，Submodel 提供免费的每日配额。具体的免费额度和适用模型请参考官网信息。
- **性能：** InstaGen 推理集群服务提供高性能的模型推理能力，确保快速响应时间。
- **文档参考：** 如需了解更多技术细节和使用指南，请参阅 [Submodel 官方文档](https://submodel.gitbook.io/docs/instagen/overview)。
- **模型选择：** 建议根据您的具体需求选择合适的模型，平衡性能和成本。
