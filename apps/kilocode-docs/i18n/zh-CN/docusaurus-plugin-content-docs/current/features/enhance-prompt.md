# 增强提示

Kilo Code 中的“增强提示”功能可帮助您在将提示发送到 AI 模型之前提高其质量和有效性。通过单击聊天输入中的 <Codicon name="sparkle" /> 图标，您可以自动优化您的初始请求，使其更清晰、更具体，并更有可能产生所需的结果。

## 为什么要使用增强提示？

- **提高清晰度：** Kilo Code 可以重新措辞您的提示，使其更易于 AI 模型理解。
- **添加上下文：** 增强过程可以为您的提示添加相关上下文，例如当前文件路径或选定的代码。
- **更好的指令：** Kilo Code 可以添加指令来引导 AI 给出更有帮助的响应（例如，请求特定格式或特定详细程度）。
- **减少歧义：** 增强提示有助于消除歧义并确保 Kilo Code 理解您的意图。
- **一致性**：Kilo 将始终以相同的方式格式化提示给 AI。

### 之前和之后

<img src="/docs/img/enhance-prompt/before.png" alt="非常原始的提示" width="300" style={{display: 'inline-block', marginRight: '20px', verticalAlign: 'middle'}} />
<img src="/docs/img/enhance-prompt/after.png" alt="增强的提示" width="300" style={{display: 'inline-block', verticalAlign: 'middle'}} />

## 如何使用增强提示

1.  **输入您的初始提示：** 像往常一样在 Kilo Code 聊天输入框中输入您的请求。这可以是一个简单的问题、一个复杂的任务描述，或介于两者之间的任何内容。
2.  **单击 <Codicon name="sparkle" /> 图标：** 不要按 Enter 键，而是单击聊天输入框右下角的 <Codicon name="sparkle" /> 图标。
3.  **审查增强提示：** Kilo Code 将用增强版本替换您的原始提示。审查增强提示，确保它准确反映您的意图。您可以在发送之前进一步优化增强提示。
4.  **发送增强提示：** 按 Enter 键或单击发送图标（<Codicon name="send" />）将增强提示发送到 Kilo Code。

## 自定义增强过程

### 自定义模板

“增强提示”功能使用可自定义的提示模板。您可以修改此模板以根据您的特定需求调整增强过程。

1.  **打开“提示”选项卡：** 单击 Kilo Code 顶部菜单栏中的 <Codicon name="notebook" /> 图标。
2.  **选择“ENHANCE”选项卡：** 您应该会看到列出的支持提示，包括“ENHANCE”。单击此选项卡。
3.  **编辑提示模板：** 修改“提示”字段中的文本。

默认提示模板包含占位符 `${userInput}`，它将被您的原始提示替换。您可以修改它以适应模型的提示格式，并指示它如何增强您的请求。

### 自定义提供商

通过切换到更轻量级的 LLM 模型提供商（例如 GPT 4.1 Nano）来加快提示增强。这可以以更低的成本提供更快的结果，同时保持质量。

按照[API 配置配置文件指南](/features/api-configuration-profiles)为增强提示创建专用配置文件。

<img src="/docs/img/enhance-prompt/custom-enhance-profile.png" alt="增强提示功能的自定义配置文件配置" width="600" />

有关详细演练：https://youtu.be/R1nDnCK-xzw

## 限制和最佳实践

- **实验性功能：** 提示增强是一项实验性功能。增强提示的质量可能因您的请求的复杂性和底层模型的功能而异。
- **仔细审查：** 在发送之前务必仔细审查增强提示。Kilo Code 可能会进行与您的意图不符的更改。
- **迭代过程：** 您可以多次使用“增强提示”功能来迭代优化您的提示。
- **不能替代清晰的指令：** 尽管“增强提示”可以提供帮助，但从一开始就编写清晰具体的提示仍然很重要。

通过使用“增强提示”功能，您可以提高与 Kilo Code 交互的质量，并获得更准确和有用的响应。
