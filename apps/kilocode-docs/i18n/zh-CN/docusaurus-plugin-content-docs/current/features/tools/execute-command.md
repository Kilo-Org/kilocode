# execute_command

`execute_command`工具用于在用户系统上执行CLI命令。它允许Kilo Code执行系统操作、安装依赖、构建项目、启动服务器以及执行其他基于终端的任务，以实现用户目标。

## 参数

该工具接受以下参数：

- `command`（必填）：要执行的CLI命令。必须对用户的操作系统有效。
- `cwd`（可选）：执行命令的工作目录。如果未提供，则使用当前工作目录。

## 功能

该工具直接在用户系统上执行终端命令，支持从文件操作到运行开发服务器等多种操作。命令在托管的终端实例中运行，并实时捕获输出，与VS Code的终端系统集成，以实现最佳性能和安全性。

## 使用场景

- 安装项目依赖（npm install, pip install等）
- 构建或编译代码（make, npm run build等）
- 启动开发服务器或运行应用程序
- 初始化新项目（git init, npm init等）
- 执行超出其他工具功能的文件操作
- 运行测试或lint操作
- 需要为特定技术执行专用命令

## 关键特性

- 与VS Code shell API集成，实现可靠的终端执行
- 通过注册表系统尽可能重用终端实例
- 实时捕获命令输出
- 支持在后台持续运行的长时间命令
- 允许指定自定义工作目录
- 跨命令执行维护终端历史记录和状态
- 处理适合用户shell的复杂命令链
- 提供详细的命令完成状态和退出代码解释
- 支持需要用户反馈的交互式终端应用
- 执行期间显示终端以确保透明度
- 使用shell-quote解析验证命令安全性
- 阻止潜在危险的子shell执行模式
- 与KiloCodeIgnore系统集成，控制文件访问权限
- 处理终端转义序列以保持输出整洁

## 限制

- 命令访问可能受KiloCodeIgnore规则和安全验证限制
- 需要提升权限的命令可能需要用户配置
- 某些命令的行为可能因操作系统而异
- 长时间运行的命令可能需要特殊处理
- 文件路径应根据OS shell规则正确转义
- 在远程开发场景中，并非所有终端功能都可用

## 工作原理

当调用`execute_command`工具时，它遵循以下流程：

1. **命令验证和安全检查**：

    - 使用shell-quote解析命令以识别组件
    - 根据安全限制（子shell使用、受限文件）进行验证
    - 检查KiloCodeIgnore规则以确定文件访问权限
    - 确保命令符合系统安全要求

2. **终端管理**：

    - 通过TerminalRegistry获取或创建终端
    - 设置工作目录上下文
    - 准备输出捕获的事件监听器
    - 显示终端以便用户可见

3. **命令执行和监控**：

    - 通过VS Code的shellIntegration API执行
    - 捕获并处理转义序列的输出
    - 限制输出处理间隔（100ms）
    - 监控命令完成或错误
    - 检测"热"进程（如编译器）以进行特殊处理

4. **结果处理**：
    - 去除ANSI/VS Code转义序列以保持输出整洁
    - 解释退出代码并提供详细的信号信息
    - 如果命令改变了工作目录，则更新跟踪
    - 提供带有适当上下文的命令状态

## 终端实现细节

该工具使用复杂的终端管理系统：

1. **优先复用终端**：

    - TerminalRegistry尽可能复用现有终端
    - 减少终端实例数量并提高性能
    - 跨命令执行保留终端状态（工作目录、历史记录）

2. **安全验证**：

    - 使用shell-quote解析命令以进行组件分析
    - 阻止`$(...)`和反引号等危险模式
    - 根据KiloCodeIgnore规则检查命令的文件访问控制
    - 使用前缀允许列表系统验证命令模式

3. **性能优化**：

    - 以100ms节流间隔处理输出，防止UI过载
    - 使用基于索引的零拷贝缓冲区管理以提高效率
    - 对编译和"热"进程进行特殊处理
    - 针对Windows PowerShell进行平台特定优化

4. **错误和信号处理**：
    - 将退出代码映射到详细的信号信息（SIGTERM, SIGKILL等）
    - 检测核心转储以识别关键故障
    - 自动跟踪和处理工作目录变更
    - 从终端断开连接场景中优雅恢复

## 使用示例

- 设置新项目时，Kilo Code运行初始化命令，如`npm init -y`，然后安装依赖。
- 构建Web应用时，Kilo Code执行构建命令，如`npm run build`以编译资源。
- 部署代码时，Kilo Code运行git命令以提交和推送更改到仓库。
- 故障排除时，Kilo Code执行诊断命令以收集系统信息。
- 启动开发服务器时，Kilo Code运行适当的服务器命令（如`npm start`）。
- 运行测试时，Kilo Code执行项目测试框架的测试运行命令。

## 用法示例

在当前目录中运行简单命令：

```
<execute_command>
<command>npm run dev</command>
</execute_command>
```

安装项目依赖：

```
<execute_command>
<command>npm install express mongodb mongoose dotenv</command>
</execute_command>
```

依次运行多个命令：

```
<execute_command>
<command>mkdir -p src/components && touch src/components/App.js</command>
</execute_command>
```

在特定目录中执行命令：

```
<execute_command>
<command>git status</command>
<cwd>./my-project</cwd>
</execute_command>
```

构建并启动项目：

```
<execute_command>
<command>npm run build && npm start</command>
</execute_command>
```
