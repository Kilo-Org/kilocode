# Memory Bank

## 概述

<figure style={{ float: 'right', width: '40%', maxWidth: '350px', margin: '0 0 10px 20px' }}>
  <img src="/docs/img/memory-bank/at-work.png" alt="使用 Memory Bank 执行任务" style={{ border: '1px solid grey', borderRadius: '5px', width: '100%' }} />
  <figcaption style={{ fontSize: '0.9rem', color: '#666', marginTop: '8px', textAlign: 'center' }}>
    启用 Memory Bank 后，Kilo Code 可以更高效地工作，立即理解项目上下文和技术栈。
  </figcaption>
</figure>

### 问题：AI 记忆丢失

像 Kilo Code 这样的 AI 助手面临一个根本性的限制：它们会在会话之间完全重置。这种“记忆丢失”意味着每次开始新的对话时，都需要重新解释项目的架构、目标、技术和当前状态。这造成了一个关键效率困境：AI 模型要么在没有正确理解项目的情况下进行编辑（导致错误和解决方案不一致），要么必须在每个会话中花费大量时间和资源分析整个代码库（对于大型项目来说，这既昂贵又缓慢）。

如果没有解决这个记忆问题，AI 助手仍然是强大但无状态的工具，无法真正作为持续的开发伙伴。

### 解决方案：Memory Bank

Memory Bank 是一个结构化文档系统，使 Kilo Code 能够**更好地理解你的项目**并**在编码会话之间保持上下文**。它将你的 AI 助手从无状态工具转变为具有完美项目记忆的持续开发伙伴。Kilo Code 会在每次开始新会话时自动读取你的 Memory Bank 文件，以重建对项目的理解。

当 Memory Bank 处于活动状态时，Kilo Code 会在每个任务的开始处显示 `[Memory Bank: Active]`，并简要总结你的项目上下文，确保在不重复解释的情况下保持一致性。

## 主要优点

- **语言无关**：适用于任何编程语言或框架
- **高效的项目理解**：帮助 Kilo Code 理解项目的用途和技术栈
- **上下文保留**：在会话之间维护项目知识，而无需在每个新会话中扫描文件
- **更快的启动**：Kilo Code 在开始新会话时立即理解你的项目上下文
- **自我记录项目**：作为副产品创建有价值的文档

## Memory Bank 的工作原理

Memory Bank 基于 Kilo Code 的 [自定义规则](/agent-behavior/custom-rules) 功能构建，为项目文档提供了一个专门的框架。Memory Bank 文件是存储在项目仓库 `.kilocode/rules/memory-bank` 文件夹中的标准 Markdown 文件。它们不是隐藏或专有的——它们是你和 Kilo Code 都可以访问的常规文档文件。

在每个任务开始时，Kilo Code 会读取所有 Memory Bank 文件，以构建对项目的全面理解。这是自动进行的，不需要你采取任何操作。Kilo Code 然后会在其响应的开头显示 `[Memory Bank: Active]`，表示 Memory Bank 已成功激活，并简要总结其对项目的理解。

文件按层次结构组织，构建项目的完整视图：

## 核心 Memory Bank 文件

### brief.md

_此文件由你手动创建和维护_

- 项目的基础
- 项目的高级概述
- 核心需求和目标

示例：_"构建一个带有条形码扫描功能的 React 库存管理系统。该系统需要支持多个仓库并与我们现有的 ERP 系统集成。"_

注意：Kilo Code 不会直接编辑此文件，但如果发现可以改进项目摘要的方式，可能会提出建议。

### product.md

- 解释项目存在的原因
- 描述正在解决的问题
- 概述产品应如何工作
- 用户体验目标

示例：_"库存系统需要支持多个仓库和实时更新。它通过提供条形码扫描来解决库存差异问题，确保准确的库存计数。"_

### context.md

- 更新最频繁的文件
- 包含当前工作重点和最近的变化
- 跟踪活动决策和考虑事项
- 开发的下一步

示例：_"当前正在实施条形码扫描组件；上次会话完成了 API 集成。下一步包括为网络故障添加错误处理。"_

### architecture.md

- 记录系统架构
- 记录关键技术决策
- 列出正在使用的设计模式
- 解释组件关系
- 关键实现路径

示例：_"使用 Redux 进行状态管理，采用规范化的存储结构。应用程序遵循模块化架构，API 通信、状态管理和 UI 组件分别位于不同的服务中。"_

### tech.md

- 列出使用的技术和框架
- 描述开发设置
- 记录技术约束
- 记录依赖项和工具配置
- 工具使用模式

示例：_"React 18、TypeScript、Firebase、Jest 用于测试。开发需要 Node.js 16+ 并使用 Vite 作为构建工具。"_

## 其他上下文文件

根据需要创建其他文件以组织：

- 复杂功能文档
- 集成规范
- API 文档
- 测试策略
- 部署程序

这些附加文件有助于组织不适合核心文件的更详细信息。

### tasks.md

_用于记录重复任务的可选文件_

- 存储遵循类似模式的任务的工作流程
- 记录需要修改的文件
- 记录分步程序
- 记录重要的注意事项和陷阱

示例：添加对新 AI 模型的支持、实现 API 端点或任何需要重复执行类似工作的任务。

## 开始使用 Memory Bank

### 首次设置

1. 在项目中创建 `.kilocode/rules/memory-bank/` 文件夹
2. 在 `.kilocode/rules/memory-bank/brief.md` 中编写基本的项目摘要
3. 创建文件 `.kilocode/rules/memory-bank-instructions.md` 并将 [此文档](pathname:///downloads/memory-bank.md) 粘贴到其中
4. 切换到 `Architect` 模式
5. 检查是否选择了最佳可用的 AI 模型，不要使用“轻量级”模型
6. 要求 Kilo Code “initialize memory bank”
7. 等待 Kilo Code 分析你的项目并初始化 Memory Bank 文件
8. 验证文件内容，确保项目描述正确。如有必要，更新文件。

### 项目摘要提示

- 从简单开始——它可以是你喜欢的任何详细程度或高级程度
- 专注于对你最重要的事情
- Kilo Code 将帮助填补空白并提出问题
- 你可以随着项目的发展更新它

提供合理摘要的示例提示：

```
提供此项目的简明而全面的描述，突出其主要目标、关键功能、使用的技术和重要性。然后，将此描述写入适当命名的文本文件中，以反映项目内容，确保写作的清晰性和专业性。保持简洁。
```

## 使用 Memory Bank

### 核心工作流程

#### Memory Bank 初始化

初始化步骤至关重要，因为它为所有未来的项目交互奠定了基础。当你使用命令 `initialize memory bank` 请求初始化时，Kilo Code 将：

1. 对你的项目进行详尽的分析，包括：
    - 所有源代码文件及其关系
    - 配置文件和构建系统设置
    - 项目结构和组织模式
    - 文档和注释
    - 依赖项和外部集成
    - 测试框架和模式
2. 在 `.kilocode/rules/memory-bank` 文件夹中创建全面的 Memory Bank 文件
3. 提供对其对项目的理解的详细摘要
4. 要求你验证生成文件的准确性

:::warning 重要
初始化后，请花时间仔细审查并更正生成的文件。此阶段的任何误解或缺失信息都会影响所有未来的交互。彻底的初始化将显著提高 Kilo Code 的有效性，而仓促或不完整的初始化将永久限制其有效协助你的能力。
:::

#### Memory Bank 更新

Memory Bank 更新发生在以下情况：

1. 发现新的项目模式
2. 实施重大更改后
3. 当你明确请求 `update memory bank` 时
4. 当上下文需要澄清时

要执行 Memory Bank 更新，Kilo Code 将：

1. 审查所有项目文件
2. 记录当前状态
3. 记录见解和模式
4. 根据需要更新所有 Memory Bank 文件

你可以使用类似 `update memory bank using information from @/Makefile` 的命令来指导 Kilo Code 专注于特定的信息源。

#### 常规任务执行

在每个任务开始时，Kilo Code：

1. 读取所有 Memory Bank 文件
2. 在其响应的开头包含 `[Memory Bank: Active]`
3. 提供其对项目理解的简要摘要
4. 继续执行请求的任务

在任务结束时，如果进行了重大更改，Kilo Code 可能会建议更新 Memory Bank，使用短语：“Would you like me to update memory bank to reflect these changes?”

#### 添加任务工作流程

当你完成一个重复的任务时，你可以将其记录下来以备将来参考。这对于遵循现有模式添加功能等任务特别有用。

要记录任务，请使用命令 `add task` 或 `store this as a task`。Kilo Code 将：

1. 创建或更新 Memory Bank 文件夹中的 `tasks.md` 文件
2. 使用当前上下文记录任务：
    - 任务名称和描述
    - 需要修改的文件列表
    - 分步工作流程
    - 重要的注意事项
    - 示例实现

当开始新任务时，Kilo Code 会检查它是否与任何记录的任务匹配，并遵循已建立的工作流程，以确保不会遗漏任何步骤。

### 关键命令

- `initialize memory bank` - 在开始新项目时使用
- `update memory bank` - 启动对当前任务的上下文文档的全面重新分析。**注意：**此操作资源密集，由于可能降低有效性，不建议用于“轻量级”模型。可以多次使用，可与特定指令很好地结合，例如 `update memory bank using information from @/Makefile`
- `add task` 或 `store this as a task` - 记录重复任务以备将来参考

### 状态指示器

Kilo Code 使用状态指示器来清楚地传达 Memory Bank 状态：

- `[Memory Bank: Active]` - 表示 Memory Bank 文件已成功读取并正在使用
- `[Memory Bank: Missing]` - 表示找不到 Memory Bank 文件或文件为空

这些指示器出现在 Kilo Code 响应的开头，提供 Memory Bank 状态的即时确认。

### 文档更新

Memory Bank 更新应自动发生在以下情况：

- 发现新的项目模式
- 实施重大更改后
- 当你明确请求 `update memory bank` 时
- 当上下文需要澄清时

## 上下文窗口管理

当你与 Kilo Code 一起工作时，你的上下文窗口最终会填满。当你注意到响应速度变慢或引用变得不那么准确时：

1. 要求 Kilo Code “update memory bank” 以记录当前状态
2. 开始新的对话/任务
3. Kilo Code 将在新对话中自动访问你的 Memory Bank

此过程确保在多个会话之间保持连续性，而不会丢失重要上下文。

## 处理不一致

如果 Kilo Code 检测到 Memory Bank 文件之间的不一致：

1. 它将优先考虑 `brief.md` 中的信息作为真相来源
2. 向你指出任何不一致之处
3. 继续使用最可靠的信息

这确保即使文档不完美，Kilo Code 仍然可以有效地工作。

## 常见问题解答

### Memory Bank 文件存储在哪里？

Memory Bank 文件是存储在项目仓库中的常规 Markdown 文件，通常在 `.kilocode/rules/memory-bank/` 文件夹中。它们不是隐藏的系统文件——它们旨在成为项目文档的一部分。

### 我应该多久更新一次 Memory Bank？

在重大里程碑或方向变化后更新 Memory Bank。对于活跃的开发，每隔几次会话更新一次会很有帮助。当你希望确保所有上下文都得到保留时，请使用“update memory bank”命令。

### 我可以手动编辑 Memory Bank 文件吗？

是的！虽然 Kilo Code 管理大多数文件，但你可以手动编辑其中任何文件。`brief.md` 文件专门设计为由你维护。Kilo Code 会尊重对其他文件的手动编辑。

### 如果 Memory Bank 文件丢失会发生什么？

如果 Memory Bank 文件丢失，Kilo Code 会在其响应的开头显示 `[Memory Bank: Missing]`，并建议初始化 Memory Bank。

### Memory Bank 是否适用于所有 AI 模型？

Memory Bank 适用于所有 AI 模型，但更强大的模型将创建更全面和准确的 Memory Bank 文件。轻量级模型可能难以处理分析和更新 Memory Bank 文件的资源密集型过程。

### 我可以在多个项目中使用 Memory Bank 吗？

是的！每个项目都有自己的 Memory Bank，位于其 `.kilocode/rules/memory-bank/` 文件夹中。Kilo Code 会自动为每个项目使用正确的 Memory Bank。

### Memory Bank 是否会占用我的上下文窗口？

是的，Memory Bank 在每个会话开始时确实会占用一些上下文窗口，因为它会加载所有 Memory Bank 文件。然而，这是一个战略性的权衡，可以显著提高整体效率。通过预先加载项目上下文：

- 你消除了重复解释，这些解释会随着时间的推移消耗更多的上下文
- 你可以通过更少的来回交流达到富有成效的结果
- 你在整个会话中保持一致性理解

测试表明，虽然 Memory Bank 最初使用了更多的 token，但它显著减少了实现结果所需的总交互次数。这意味着更少的时间解释和更多的时间构建。

## 最佳实践

### 开始使用

- 从基本项目摘要开始，让结构逐步发展
- 让 Kilo Code 帮助创建初始结构
- 根据需要审查和调整文件以匹配你的工作流程
- 初始化后验证生成文件的准确性

### 持续工作

- 让模式随着工作自然出现
- 不要强制文档更新——它们应该有机地发生
- 信任过程——价值会随着时间的推移而复合
- 在会话开始时注意上下文确认
- 使用状态指示器确认 Memory Bank 处于活动状态

### 文档流程

- `brief.md` 是你的基础
- `context.md` 变化最频繁
- 所有文件共同维护项目智能
- 在重大里程碑或方向变化后更新

### 优化 Memory Bank 性能

- 保持 Memory Bank 文件简洁且重点突出
- 使用附加文件进行详细文档记录
- 定期更新但不要过度
- 专注于特定方面时使用特定的更新命令

## 记住

Memory Bank 是 Kilo Code 与之前工作的唯一链接。其有效性完全依赖于在每个交互中维护清晰、准确的文档并确认上下文保留。当你在响应开头看到 `[Memory Bank: Active]` 时，你可以确信 Kilo Code 对你的项目有全面的理解。
