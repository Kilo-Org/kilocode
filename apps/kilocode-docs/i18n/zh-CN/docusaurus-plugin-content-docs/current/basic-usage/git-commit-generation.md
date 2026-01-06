# 生成提交信息

根据您暂存的 git 更改自动生成描述性提交信息。Kilo Code 会分析您暂存的文件并创建遵循最佳实践的约定式提交信息。

:::info
此功能仅分析**暂存的更改**。在生成提交信息之前，请务必使用 `git add` 或通过 `VS Code` 界面暂存您的文件。
:::

## 工作原理

git 提交信息生成器：

- 仅分析您的**暂存更改**（未暂存或未跟踪的文件）
- 使用 AI 理解更改的上下文和目的
- 创建描述性提交信息，解释更改了什么以及为什么，遵循[约定式提交](https://www.conventionalcommits.org/)规范（默认情况下，可自定义）

## 使用功能

### 生成提交信息

1.  使用 `git add` 或 VS Code git 界面暂存您的更改
2.  在 VS Code 源代码管理面板中，查找提交信息字段旁边的 `Kilo Code` 徽标
3.  单击徽标以生成提交信息

生成的信息将出现在提交信息字段中，您可以根据需要进行审查和修改。

<img src="/docs/img/git-commit-generation/git-commit-1.png" alt="生成的提交信息示例" width="600" />

### 约定式提交格式

默认情况下，生成的信息遵循约定式提交规范：

```
<type>(<scope>): <description>

<body>
```

常见类型包括：

- `feat`：新功能
- `fix`：错误修复
- `docs`：文档更改
- `style`：代码样式更改（格式等）
- `refactor`：代码重构
- `test`：添加或更新测试
- `chore`：维护任务

## 配置

### 自定义提交模板

您可以通过修改提示模板来自定义提交信息的生成方式：

1. 点击齿轮图标 <Codicon name="gear" /> 打开设置 → `Prompts`
2. 找到“提交信息生成”部分
3. 编辑 `Prompt` 模板以匹配您项目的规范

<img src="/docs/img/git-commit-generation/git-commit-2.png" alt="提交信息生成设置" width="600" />

默认模板创建约定式提交信息，但您可以修改它以：

- 使用不同的提交信息格式
- 包含与您的项目相关的特定信息
- 遵循您团队的提交信息规范
- 为 AI 添加自定义指令

### API 配置

您可以配置用于提交信息生成的 API 配置文件：

1.  在 `Prompts` 设置中，滚动到“API 配置”
2.  选择特定配置文件或使用当前选定的配置文件

:::tip
考虑创建一个专用的 [API 配置配置文件](/features/api-configuration-profiles)，其中包含更快、更具成本效益的模型，专门用于提交信息生成。
:::

## 最佳实践

### 暂存策略

- 将相关更改一起暂存，以获得更连贯的提交信息
- 避免在单个提交中暂存不相关的更改
- 需要时使用 `git add -p` 进行部分文件暂存

### 消息审查

- 始终在提交前审查生成的信息
- 编辑信息以添加 AI 可能遗漏的上下文
- 确保信息准确描述更改

### 自定义模板

- 根据您的项目需求定制提示模板
- 包含项目特定的术语或约定
- 添加处理特定类型更改的说明

## 生成的示例信息

以下是该功能可能生成的信息示例：

```
feat(auth): add OAuth2 integration with Google

Implement Google OAuth2 authentication flow including:
- OAuth2 client configuration
- User profile retrieval
- Token refresh mechanism
```

```
fix(api): resolve race condition in user data fetching

Add proper error handling and retry logic to prevent
concurrent requests from causing data inconsistency
```

```
docs(readme): update installation instructions

Add missing dependency requirements and clarify
setup steps for new contributors
```

## 故障排除

### 没有暂存的更改

如果按钮未出现或生成失败，请确保您已暂存更改：

```bash
git add <files>
# 或暂存所有更改
git add .
```

### 信息质量差

如果生成的信息没有帮助：

- 审查您的暂存策略 - 不要将不相关的更改一起暂存
- 使用更具体的指令自定义提示模板
- 通过 API 配置尝试不同的 AI 模型

### 集成问题

该功能与 VS Code 的内置 git 功能集成。如果您遇到问题：

- 确保您的存储库已正确初始化
- 检查 VS Code 是否可以访问您的 git 存储库
- 验证 git 是否已安装并可从 VS Code 访问

## 相关功能

- [API 配置配置文件](/features/api-configuration-profiles) - 使用不同的模型进行提交信息生成
- [设置管理](/basic-usage/settings-management) - 管理您的所有 Kilo Code 首选项
