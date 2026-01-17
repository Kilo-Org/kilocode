# 工具工作原理

Kilo Code 通过工具与你的代码和环境进行交互。这些专业助手可以执行特定操作，如读取文件、编辑内容、运行命令或搜索代码库。工具为常见开发任务提供自动化能力，无需手动执行。

## 工具工作流程

用自然语言描述你想完成的任务，Kilo Code 将会：

1. 根据你的请求选择合适的工具
2. 展示工具及其参数供你审核
3. 执行已批准的工具并显示结果
4. 重复此过程直至任务完成

## 工具分类

| 类别   | 用途                   | 工具名称                                                                 |
| :----- | :--------------------- | :----------------------------------------------------------------------- |
| 读取   | 访问文件内容和代码结构 | `read_file`, `search_files`, `list_files`, `list_code_definition_names`  |
| 编辑   | 创建或修改文件和代码   | `write_to_file`, `apply_diff`                                            |
| 执行   | 运行命令和系统操作     | `execute_command`                                                        |
| 浏览器 | 与网页内容交互         | `browser_action`                                                         |
| 工作流 | 管理任务流程和上下文   | `ask_followup_question`, `attempt_completion`, `switch_mode`, `new_task` |

## 示例：工具使用

以下是典型的工具交互过程：

<img src="/docs/img/how-tools-work/how-tools-work.png" alt="工具审批界面显示保存和拒绝按钮以及自动批准复选框" width="600" />

_工具审批界面显示保存/拒绝按钮和自动批准选项。_

**用户：** 创建一个名为 `greeting.js` 的文件，用于输出问候消息

**Kilo Code：** (建议使用 `write_to_file` 工具，如上图所示)

```xml
<write_to_file>
<path>greeting.js</path>
<content>
function greet(name) {
  console.log(`Hello, ${name}!`);
}

greet('World');
</content>
<line_count>5</line_count>
</write_to_file>
```

**用户：** (点击界面中的"保存"按钮)

**Kilo Code：** (确认文件创建成功)

## 工具安全与审批

每次使用工具都需要你的明确批准。当 Kilo 建议使用工具时，你会看到：

- "保存"按钮 - 批准并执行工具
- "拒绝"按钮 - 拒绝建议的工具
- 可选的"自动批准"设置 - 用于信任的操作

此安全机制确保你能完全控制哪些文件被修改、执行哪些命令以及如何更改代码库。执行前请务必仔细审查工具建议。

## 核心工具参考

| 工具名称                     | 描述                         | 类别   |
| :--------------------------- | :--------------------------- | :----- |
| `read_file`                  | 读取带行号的文件内容         | 读取   |
| `search_files`               | 跨文件搜索文本或正则表达式   | 读取   |
| `list_files`                 | 列出指定位置的文件和目录     | 读取   |
| `list_code_definition_names` | 列出类/函数等代码定义        | 读取   |
| `write_to_file`              | 创建新文件或覆盖现有文件     | 编辑   |
| `apply_diff`                 | 对文件特定部分进行精确修改   | 编辑   |
| `execute_command`            | 在 VS Code 终端中运行命令    | 执行   |
| `browser_action`             | 在无头浏览器中执行操作       | 浏览器 |
| `ask_followup_question`      | 向你提出澄清问题             | 工作流 |
| `attempt_completion`         | 标记任务已完成               | 工作流 |
| `switch_mode`                | 切换到不同操作模式           | 工作流 |
| `new_task`                   | 创建具有特定启动模式的子任务 | 工作流 |

## 了解更多工具信息

有关每个工具的完整参数参考和高级用法，请参阅[工具使用概述](/features/tools/tool-use-overview)文档。
