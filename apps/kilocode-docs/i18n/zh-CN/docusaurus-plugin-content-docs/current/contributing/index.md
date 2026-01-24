# 为 Kilo Code 做贡献

Kilo Code 是一个开源项目，欢迎所有技能水平的开发者贡献代码。本指南将帮助你开始为 Kilo Code 做出贡献，无论是修复错误、添加功能、改进文档还是分享自定义模式。

## 贡献方式

有多种方式可以为 Kilo Code 做出贡献：

1. **代码贡献**：实现新功能或修复错误
2. **文档**：改进现有文档或创建新指南
3. **市场贡献**：通过 [Kilo Marketplace](https://github.com/Kilo-Org/kilo-marketplace) 创建并分享自定义模式、技能和 MCP 服务器
4. **错误报告**：报告你遇到的问题
5. **功能请求**：建议新功能或改进
6. **社区支持**：在社区中帮助其他用户

## 设置开发环境

设置开发环境的详细说明请参阅[此页面](/extending/development-environment.md)

## 开发工作流

### 分支策略

- 为每个功能或错误修复创建一个新分支
- 使用描述性的分支名称（例如 `feature/new-tool-support` 或 `fix/browser-action-bug`）

```bash
git checkout -b your-branch-name
```

### 编码标准

- 遵循现有的代码风格和模式
- 新代码使用 TypeScript
- 为新功能包含适当的测试
- 更新文档以反映任何面向用户的更改

### 提交指南

- 编写清晰、简洁的提交信息
- 在适用时引用问题编号
- 保持每次提交专注于单一更改

### 测试你的更改

- 运行测试套件：
    ```bash
    npm test
    ```
- 在开发扩展中手动测试你的更改

### 创建拉取请求

1. 将你的更改推送到你的 fork：

    ```bash
    git push origin your-branch-name
    ```

2. 前往 [Kilo Code 仓库](https://github.com/Kilo-Org/kilocode)

3. 点击 "New Pull Request" 并选择 "compare across forks"

4. 选择你的 fork 和分支

5. 填写 PR 模板，包括：
    - 更改的清晰描述
    - 任何相关问题
    - 测试步骤
    - 截图（如适用）

## 为 Kilo Marketplace 做贡献

[Kilo Marketplace](https://github.com/Kilo-Org/kilo-marketplace) 是一个社区驱动的代理工具仓库，用于扩展 Kilo Code 的功能。你可以贡献：

- **技能（Skills）**：模块化的工作流程和领域专业知识，教代理如何执行特定任务
- **MCP 服务器**：标准化的集成，将代理连接到外部工具和服务
- **模式（Modes）**：具有定制工具访问权限的自定义代理个性和行为

贡献方式：

1. 按照 [自定义模式](/agent-behavior/custom-modes)、[技能](/agent-behavior/skills) 或 [MCP 服务器](/features/mcp/overview) 的文档创建你的资源

2. 彻底测试你的贡献

3. 向 [Kilo Marketplace 仓库](https://github.com/Kilo-Org/kilo-marketplace) 提交拉取请求

## 文档贡献

文档改进是非常有价值的贡献：

1. 遵循文档风格指南：

    - 使用清晰、简洁的语言
    - 在适当时包含示例
    - 使用以 `/docs/` 开头的绝对路径作为内部链接
    - 不要在链接中包含 `.md` 扩展名

2. 通过本地运行文档站点测试你的文档更改：

    ```bash
    cd docs
    npm install
    npm start
    ```

3. 提交包含文档更改的 PR

## 社区准则

参与 Kilo Code 社区时：

- 保持尊重和包容
- 提供建设性的反馈
- 帮助新手入门
- 遵守 [行为准则](https://github.com/Kilo-Org/kilocode/blob/main/CODE_OF_CONDUCT.md)

## 获取帮助

如果你需要帮助：

- 加入我们的 [Discord 社区](https://kilo.ai/discord) 获取实时支持
- 在 [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions) 上提问
- 访问我们的 [Reddit 社区](https://www.reddit.com/r/KiloCode)

## 致谢

所有贡献者都是 Kilo Code 社区的重要成员。贡献者将在以下地方获得认可：

- 发布说明
- 项目的 README
- GitHub 上的贡献者列表

感谢你为 Kilo Code 做出贡献，帮助让 AI 驱动的编码辅助对每个人更好！
