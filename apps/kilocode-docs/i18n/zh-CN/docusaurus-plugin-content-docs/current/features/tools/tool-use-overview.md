# 工具使用概述

Kilo Code 实现了一个复杂的工具系统，允许 AI 模型以受控和安全的方式与你的开发环境交互。本文档解释了工具的工作原理、调用时机和管理方式。

## 核心概念

### 工具分组

工具根据功能分为逻辑组：

| 类别         | 用途               | 工具                                                                                                                                                                                                       | 常见用途                   |
| ------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **读取组**   | 文件系统读取和搜索 | [read_file](/features/tools/read-file), [search_files](/features/tools/search-files), [list_files](/features/tools/list-files), [list_code_definition_names](/features/tools/list-code-definition-names)   | 代码探索和分析             |
| **编辑组**   | 文件系统修改       | [apply_diff](/features/tools/apply-diff), [write_to_file](/features/tools/write-to-file)                                                                                                                   | 代码更改和文件操作         |
| **浏览器组** | 网页自动化         | [browser_action](/features/tools/browser-action)                                                                                                                                                           | 网页测试和交互             |
| **命令组**   | 系统命令执行       | [execute_command](/features/tools/execute-command)                                                                                                                                                         | 运行脚本、构建项目         |
| **MCP组**    | 外部工具集成       | [use_mcp_tool](/features/tools/use-mcp-tool), [access_mcp_resource](/features/tools/access-mcp-resource)                                                                                                   | 通过外部服务器实现专门功能 |
| **工作流组** | 模式和任务管理     | [switch_mode](/features/tools/switch-mode), [new_task](/features/tools/new-task), [ask_followup_question](/features/tools/ask-followup-question), [attempt_completion](/features/tools/attempt-completion) | 上下文切换和任务组织       |

### 始终可用的工具

某些工具在任何模式下都可访问：

- [ask_followup_question](/features/tools/ask-followup-question)：从用户处收集额外信息
- [attempt_completion](/features/tools/attempt-completion)：标记任务完成
- [switch_mode](/features/tools/switch-mode)：更改操作模式
- [new_task](/features/tools/new-task)：创建子任务
- [update_todo_list](/features/tools/update-todo-list)：管理分步任务跟踪

## 可用工具

### 读取工具

这些工具帮助 Kilo Code 理解你的代码和项目：

- [read_file](/features/tools/read-file) - 检查文件内容
- [search_files](/features/tools/search-files) - 跨多个文件查找模式
- [list_files](/features/tools/list-files) - 映射项目文件结构
- [list_code_definition_names](/features/tools/list-code-definition-names) - 创建代码结构图

### 编辑工具

这些工具帮助 Kilo Code 修改你的代码：

- [apply_diff](/features/tools/apply-diff) - 对代码进行精确修改
- [write_to_file](/features/tools/write-to-file) - 创建新文件或完全重写现有文件

### 浏览器工具

这些工具帮助 Kilo Code 与网页应用交互：

- [browser_action](/features/tools/browser-action) - 自动化浏览器交互

### 命令工具

这些工具帮助 Kilo Code 执行命令：

- [execute_command](/features/tools/execute-command) - 运行系统命令和程序

### MCP工具

这些工具帮助 Kilo Code 连接外部服务：

- [use_mcp_tool](/features/tools/use-mcp-tool) - 使用专门的外部工具
- [access_mcp_resource](/features/tools/access-mcp-resource) - 访问外部数据源

### 工作流工具

这些工具帮助管理对话和任务流：

- [ask_followup_question](/features/tools/ask-followup-question) - 从你那里获取额外信息
- [attempt_completion](/features/tools/attempt-completion) - 呈现最终结果
- [switch_mode](/features/tools/switch-mode) - 切换到不同模式以执行专门任务
- [new_task](/features/tools/new-task) - 创建新子任务
- [update_todo_list](/features/tools/update-todo-list) - 通过分步清单跟踪任务进度

## 工具调用机制

### 工具调用时机

工具在特定条件下被调用：

1. **直接任务需求**

    - 当需要特定操作来完成 LLM 决定的任务时
    - 响应用户请求
    - 在自动化工作流中

2. **基于模式的可用性**

    - 不同模式启用不同的工具集
    - 模式切换可以触发工具可用性变化
    - 某些工具仅限于特定模式

3. **上下文相关调用**
    - 基于工作区的当前状态
    - 响应系统事件
    - 在错误处理和恢复期间

### 决策过程

系统使用多步骤流程确定工具可用性：

1. **模式验证**

    ```typescript
    isToolAllowedForMode(
        tool: string,
        modeSlug: string,
        customModes: ModeConfig[],
        toolRequirements?: Record<string, boolean>,
        toolParams?: Record<string, any>
    )
    ```

2. **需求检查**

    - 系统能力验证
    - 资源可用性
    - 权限验证

3. **参数验证**
    - 必需参数是否存在
    - 参数类型检查
    - 值验证

## 技术实现

### 工具调用处理

1. **初始化**

    - 验证工具名称和参数
    - 检查模式兼容性
    - 验证需求

2. **执行**

    ```typescript
    const toolCall = {
    	type: "tool_call",
    	name: chunk.name,
    	arguments: chunk.input,
    	callId: chunk.callId,
    }
    ```

3. **结果处理**
    - 确定成功/失败
    - 格式化结果
    - 错误处理

### 安全与权限

1. **访问控制**

    - 文件系统限制
    - 命令执行限制
    - 网络访问控制

2. **验证层**
    - 工具特定验证
    - 基于模式的限制
    - 系统级检查

## 模式集成

### 基于模式的工具访问

工具根据当前模式提供：

- **代码模式**：完全访问文件系统工具、代码编辑能力、命令执行
- **提问模式**：仅限于读取工具、信息收集能力，不能修改文件系统
- **架构模式**：设计导向工具、文档能力，有限的执行权限
- **自定义模式**：可配置特定工具访问以实现专门工作流

### 模式切换

1. **流程**

    - 保存当前模式状态
    - 更新工具可用性
    - 上下文切换

2. **对工具的影响**
    - 工具集变化
    - 权限调整
    - 上下文保存

## 最佳实践

### 工具使用指南

1. **效率**

    - 使用最适合任务的工具
    - 避免冗余工具调用
    - 尽可能批量操作

2. **安全**

    - 调用工具前验证输入
    - 使用最低必要权限
    - 遵循安全最佳实践

3. **错误处理**
    - 实施适当的错误检查
    - 提供有意义的错误信息
    - 优雅地处理失败

### 常见模式

1. **信息收集**

    ```
    [ask_followup_question](/features/tools/ask-followup-question) → [read_file](/features/tools/read-file) → [search_files](/features/tools/search-files)
    ```

2. **代码修改**

    ```
    [read_file](/features/tools/read-file) → [apply_diff](/features/tools/apply-diff) → [attempt_completion](/features/tools/attempt-completion)
    ```

3. **任务管理**

    ```
    [new_task](/features/tools/new-task) → [switch_mode](/features/tools/switch-mode) → [execute_command](/features/tools/execute-command)
    ```

4. **进度跟踪**
    ```
    [update_todo_list](/features/tools/update-todo-list) → [execute_command](/features/tools/execute-command) → [update_todo_list](/features/tools/update-todo-list)
    ```

## 错误处理与恢复

### 错误类型

1. **工具特定错误**

    - 参数验证失败
    - 执行错误
    - 资源访问问题

2. **系统错误**

    - 权限被拒绝
    - 资源不可用
    - 网络故障

3. **上下文错误**
    - 工具的模式无效
    - 缺少需求
    - 状态不一致

### 恢复策略

1. **自动恢复**

    - 重试机制
    - 回退选项
    - 状态恢复

2. **用户干预**
    - 错误通知
    - 恢复建议
    - 手动干预选项
