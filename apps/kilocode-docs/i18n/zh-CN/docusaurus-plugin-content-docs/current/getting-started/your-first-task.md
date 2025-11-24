---
sidebar_label: 第一个任务
---

# 开始你的第一个Kilo Code任务

本快速教程将展示 Kilo Code 如何从头到尾处理一个简单的请求。

完成[初始设置](/getting-started/setting-up)后，请按照以下步骤操作：

## 第一步：打开Kilo Code面板

点击VS Code主侧边栏（窗口侧边的垂直栏）中的Kilo Code图标（<img src="/docs/img/kilo-v1.svg" width="12" />）打开聊天界面。如果看不到图标，请确认扩展已[安装](/getting-started/installing)并启用。

<img src="/docs/img/your-first-task/your-first-task.png" alt="VS Code主侧边栏中的Kilo Code图标" width="800" />
*主侧边栏中的Kilo Code图标可打开聊天界面*

## 第二步：输入你的任务

在面板底部的聊天框中，清晰简洁地描述你希望Kilo Code完成的操作。有效任务的示例：

- "创建名为`hello.txt`的文件，内容为'Hello, world!'"
- "编写一个两数相加的Python函数"
- "创建一个标题为'Kilo测试'的简单网站HTML文件"

无需特殊命令或语法——使用普通英语即可。

<img src="/docs/img/your-first-task/your-first-task-6.png" alt="在Kilo Code聊天界面中输入任务" width="500" />
*用自然语言输入任务 - 无需特殊语法*

## 第三步：发送任务

按Enter键或点击输入框右侧的发送图标（<Codicon name="send" />）。

## 第四步：审核并批准操作

Kilo Code分析你的请求后会提出具体操作建议，可能包括：

- **读取文件**：显示需要访问的文件内容
- **写入文件**：展示变更差异（绿色为新增行，红色为删除行）
- **执行命令**：显示将在终端运行的精确命令
- **使用浏览器**：概述浏览器操作（点击、输入等）
- **提问澄清**：需要时请求更多信息以继续

<img src="/docs/img/your-first-task/your-first-task-7.png" alt="审核文件创建操作建议" width="400" />
*Kilo Code明确显示将要执行的操作并等待你的批准*

- 在**Code**模式下，默认启用许多代码编写功能
- 在**Architect**和**Ask**模式下，代理不会编写任何代码

:::tip
自主程度可配置，你可以让代理更自主或更受限。

了解更多关于[使用模式](/basic-usage/using-modes)和[自动批准操作](/features/auto-approving-actions)。
:::

## 第五步：迭代操作

Kilo Code以迭代方式工作。每个操作后都会等待你的反馈，然后再提出下一步建议。持续这个"审核-批准"循环直到任务完成。

<img src="/docs/img/your-first-task/your-first-task-8.png" alt="展示迭代过程的最终任务结果" width="500" />
*任务完成后，Kilo Code显示最终结果并等待下一条指令*

## 总结

你已完成第一个Kilo Code任务！通过这个过程，你已了解：

- 如何使用自然语言与Kilo Code交互
- 让你保持控制的基于批准的工作流
- Kilo Code用于逐步解决问题的迭代方法

这种迭代的、基于批准的工作流是Kilo Code的核心——让AI处理编码的繁琐部分，同时你保持完全监督。现在你已掌握基础知识，可以尝试更复杂的任务，探索不同的[模式](/basic-usage/using-modes)进行专门的工作流，或试用[自动批准功能](/features/auto-approving-actions)来加速重复性任务。
