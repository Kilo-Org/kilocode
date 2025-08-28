---
sidebar_label: Suggested Responses
---

import Codicon from '@site/src/components/Codicon';

# 建议回复

当 Kilo Code 需要更多信息来完成任务时，它会使用 [`ask_followup_question` 工具](/features/tools/ask-followup-question)。为了使回复更轻松、更快捷，Kilo Code 通常会在问题旁边提供建议答案。

## 概述

建议回复以可点击按钮的形式直接显示在 Kilo Code 问题下方，位于聊天界面中。它们提供与问题相关的预设答案，帮助您快速提供输入。

<img src="/docs/img/suggested-responses/suggested-responses.png" alt="Kilo Code 提问并显示建议回复按钮的示例" width="500" />

## 工作原理

1.  **问题出现**：Kilo Code 使用 `ask_followup_question` 工具提问。
2.  **显示建议**：如果 Kilo Code 提供了建议，它们将作为按钮显示在问题下方。
3.  **交互**：您可以通过两种方式与这些建议进行交互。

## 与建议交互

您有两种使用建议回复的选项：

1.  **直接选择**：

    - **操作**：只需单击包含您要提供的答案的按钮。
    - **结果**：选定的答案会立即作为您的回复发送回 Kilo Code。如果其中一个建议完全符合您的意图，这是最快的回复方式。

2.  **发送前编辑**：
    - **操作**：
        - 按住 `Shift` 并单击建议按钮。
        - _或者_，将鼠标悬停在建议按钮上，然后单击出现的铅笔图标（<Codicon name="edit" />）。
    - **结果**：建议的文本被复制到聊天输入框中。您可以在按 Enter 键发送自定义回复之前根据需要修改文本。当建议接近但需要微调时，这很有用。

<img src="/docs/img/suggested-responses/suggested-responses-1.png" alt="聊天输入框显示从建议回复中复制的文本，准备编辑" width="600" />

## 优点

- **速度**：无需输入完整答案即可快速回复。
- **清晰度**：建议通常会阐明 Kilo Code 需要的信息类型。
- **灵活性**：根据需要编辑建议以提供精确、自定义的答案。

此功能简化了 Kilo Code 需要澄清时的交互，让您能够以最少的精力有效指导任务。
