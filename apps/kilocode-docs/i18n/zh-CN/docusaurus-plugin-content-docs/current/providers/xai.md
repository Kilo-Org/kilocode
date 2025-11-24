---
sidebar_label: xAI (Grok)
---

# 在 Kilo Code 中使用 xAI (Grok)

xAI 是 Grok 背后的公司，Grok 是一种大型语言模型，以其对话能力和大型上下文窗口而闻名。Grok 模型旨在提供有用、信息丰富且与上下文相关的响应。

**网站：** [https://x.ai/](https://x.ai/)

## 获取 API 密钥

1.  **注册/登录：** 访问 [xAI 控制台](https://console.x.ai/)。创建帐户或登录。
2.  **导航到 API 密钥：** 转到仪表板中的 API 密钥部分。
3.  **创建密钥：** 单击以创建新的 API 密钥。为您的密钥指定一个描述性名称（例如，“Kilo Code”）。
4.  **复制密钥：** **重要提示：** 立即复制 API 密钥。您将无法再次看到它。请妥善保管。

## 支持的模型

Kilo Code 支持以下 xAI Grok 模型：

### Grok-3 模型

- `grok-3-beta`（默认）- xAI 的 Grok-3 beta 模型，具有 131K 上下文窗口
- `grok-3-fast-beta` - xAI 的 Grok-3 快速 beta 模型，具有 131K 上下文窗口
- `grok-3-mini-beta` - xAI 的 Grok-3 mini beta 模型，具有 131K 上下文窗口
- `grok-3-mini-fast-beta` - xAI 的 Grok-3 mini 快速 beta 模型，具有 131K 上下文窗口

### Grok-2 模型

- `grok-2-latest` - xAI 的 Grok-2 模型 - 最新版本，具有 131K 上下文窗口
- `grok-2` - xAI 的 Grok-2 模型，具有 131K 上下文窗口
- `grok-2-1212` - xAI 的 Grok-2 模型（版本 1212），具有 131K 上下文窗口

### Grok 视觉模型

- `grok-2-vision-latest` - xAI 的 Grok-2 视觉模型 - 最新版本，支持图像，具有 32K 上下文窗口
- `grok-2-vision` - xAI 的 Grok-2 视觉模型，支持图像，具有 32K 上下窗口
- `grok-2-vision-1212` - xAI 的 Grok-2 视觉模型（版本 1212），支持图像，具有 32K 上下文窗口
- `grok-vision-beta` - xAI 的 Grok 视觉 Beta 模型，支持图像，具有 8K 上下文窗口

### 遗留模型

- `grok-beta` - xAI 的 Grok Beta 模型（遗留），具有 131K 上下文窗口

## Kilo Code 中的配置

1.  **打开 Kilo Code 设置：** 单击 Kilo Code 面板中的齿轮图标（<Codicon name="gear" />）。
2.  **选择提供商：** 从“API 提供商”下拉菜单中选择“xAI”。
3.  **输入 API 密钥：** 将您的 xAI API 密钥粘贴到“xAI API 密钥”字段中。
4.  **选择模型：** 从“模型”下拉菜单中选择您想要的 Grok 模型。

## 推理能力

Grok 3 Mini 模型具有专业的推理能力，允许它们“在响应前思考”——这对于复杂的解决问题任务特别有用。

### 启用推理的模型

推理仅受以下模型支持：

- `grok-3-mini-beta`
- `grok-3-mini-fast-beta`

Grok 3 模型 `grok-3-beta` 和 `grok-3-fast-beta` 不支持推理。

### 控制推理工作量

使用启用推理的模型时，您可以使用 `reasoning_effort` 参数控制模型思考的努力程度：

- `low`：最小思考时间，使用更少的 token 以实现快速响应
- `high`：最大思考时间，利用更多 token 解决复杂问题

对于应快速完成的简单查询，选择 `low`；对于响应延迟不那么重要的更难问题，选择 `high`。

### 主要功能

- **分步解决问题**：模型在提供答案之前有条不紊地思考问题
- **数学和定量能力**：擅长数字挑战和逻辑谜题
- **推理跟踪访问**：模型的思考过程可通过响应完成对象中的 `reasoning_content` 字段获取

## 提示和注意事项

- **上下文窗口：** 大多数 Grok 模型具有大型上下文窗口（高达 131K token），允许您在提示中包含大量代码和上下文。
- **视觉功能：** 当您需要处理或分析图像时，选择启用视觉的模型（`grok-2-vision-latest`、`grok-2-vision` 等）。
- **定价：** 定价因模型而异，输入成本从每百万 token 0.3 美元到 5.0 美元不等，输出成本从每百万 token 0.5 美元到 25.0 美元不等。有关最新定价信息，请参阅 xAI 文档。
- **性能权衡：** “快速”变体通常提供更快的响应时间，但成本可能更高，而“迷你”变体更经济，但功能可能有所降低。
