# 开发环境

<!-- 请参考主仓库中的 [DEVELOPMENT.md](https://github.com/Kilo-Org/kilocode/blob/main/DEVELOPMENT.md) 指南，获取详细的开发环境设置说明。 -->

本文档将帮助你设置开发环境，并了解如何与代码库一起工作。无论你是修复错误、添加功能，还是仅仅探索代码，本指南都将帮助你入门。

## 先决条件

在开始之前，请确保已安装以下内容：

1. **Git** - 用于版本控制
2. **Node.js**（建议使用 [v20.18.1](https://github.com/Kilo-Org/kilocode/blob/main/.nvmrc) 或更高版本）和 npm
3. **Visual Studio Code** - 我们推荐的开发 IDE

## 入门

### 安装

1. **Fork 并克隆仓库**：

    - **Fork 仓库**：
        - 访问 [Kilo Code GitHub 仓库](https://github.com/Kilo-Org/kilocode)
        - 点击右上角的 "Fork" 按钮，创建你自己的副本。
    - **克隆你的 Fork**：
        ```bash
        git clone https://github.com/[YOUR-USERNAME]/kilocode.git
        cd kilocode
        ```
        将 `[YOUR-USERNAME]` 替换为你的 GitHub 用户名。

2. **安装依赖项**：

    ```bash
    npm run install:all
    ```

    此命令将为主扩展、Webview UI 和 e2e 测试安装依赖项。

3. **安装 VSCode 扩展**：
    - **必需**：[ESBuild Problem Matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) - 帮助正确显示构建错误。

虽然不是运行扩展所必需的，但以下扩展建议用于开发：

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) - 将 ESLint 集成到 VS Code 中。
- [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) - 将 Prettier 集成到 VS Code 中。

推荐的扩展完整列表在[这里](https://github.com/Kilo-Org/kilocode/blob/main/.vscode/extensions.json)

### 项目结构

项目组织为以下几个关键目录：

- **`src/`** - 核心扩展代码
    - **`core/`** - 核心功能和工具
    - **`services/`** - 服务实现
- **`webview-ui/`** - 前端 UI 代码
- **`e2e/`** - 端到端测试
- **`scripts/`** - 实用脚本
- **`assets/`** - 静态资源，如图片和图标

## 开发工作流

### 构建扩展

要构建扩展：

```bash
npm run build
```

这将：

1. 构建 Webview UI
2. 编译 TypeScript
3. 打包扩展
4. 在 `bin/` 目录下创建 `.vsix` 文件

### 运行扩展

要在开发模式下运行扩展：

1. 在 VSCode 中按 `F5`（或选择 **Run** → **Start Debugging**）
2. 这将打开一个新的 VSCode 窗口，并加载 Kilo Code

### 热重载

- **Webview UI 变更**：Webview UI 的变更会立即生效，无需重启
- **核心扩展变更**：核心扩展代码的变更会自动重新加载扩展主机

在开发模式下（NODE_ENV="development"），更改核心代码将触发 `workbench.action.reloadWindow` 命令，因此不再需要手动启动/停止调试器和任务。

> **重要提示**：在生产构建中，更改核心扩展代码时，你需要：
>
> 1. 停止调试过程
> 2. 终止任何在后台运行的 npm 任务（见下图）
> 3. 重新开始调试

<img width="600" alt="Stopping background tasks" src="https://github.com/user-attachments/assets/466fb76e-664d-4066-a3f2-0df4d57dd9a4" />

### 安装构建的扩展

要安装你构建的扩展：

```bash
code --install-extension "$(ls -1v bin/kilo-code-*.vsix | tail -n1)"
```

将 `[version]` 替换为当前版本号。

## 测试

Kilo Code 使用多种测试来确保质量：

### 单元测试

运行单元测试：

```bash
npm test
```

这将运行扩展和 Webview 测试。

要运行特定测试套件：

```bash
npm run test:extension  # 仅运行扩展测试
npm run test:webview    # 仅运行 Webview 测试
```

### 端到端测试

E2E 测试验证扩展在 VSCode 中是否正确工作：

1. 在根目录下创建 `.env.local` 文件，包含所需的 API 密钥：

    ```
    OPENROUTER_API_KEY=sk-or-v1-...
    ```

2. 运行集成测试：
    ```bash
    npm run test:integration
    ```

有关 E2E 测试的更多详细信息，请参阅 [e2e/VSCODE_INTEGRATION_TESTS.md](https://github.com/Kilo-Org/kilocode/blob/main/e2e/VSCODE_INTEGRATION_TESTS.md)。

## 代码检查和类型检查

确保你的代码符合我们的质量标准：

```bash
npm run lint          # 运行 ESLint
npm run check-types   # 运行 TypeScript 类型检查
```

## Git 钩子

该项目使用 [Husky](https://typicode.github.io/husky/) 来管理 Git 钩子，这些钩子会在提交和推送之前自动执行某些检查。钩子位于 `.husky/` 目录中。

### 预提交钩子

在提交完成之前，`.husky/pre-commit` 钩子会运行：

1.  **分支检查**：防止直接提交到 `main` 分支。
2.  **类型生成**：运行 `npm run generate-types`。
3.  **类型文件检查**：确保类型生成对 `src/exports/roo-code.d.ts` 的更改已暂存。
4.  **代码检查**：运行 `lint-staged` 以检查和格式化暂存的文件。

### 预推送钩子

在将更改推送到远程仓库之前，`.husky/pre-push` 钩子会运行：

1.  **分支检查**：防止直接推送到 `main` 分支。
2.  **编译**：运行 `npm run compile` 以确保项目成功构建。
3.  **变更集检查**：检查 `.changeset/` 中是否存在变更集文件，并提醒你使用 `npm run changeset` 创建一个。

这些钩子有助于保持代码质量和一致性。如果遇到提交或推送问题，请检查这些钩子的输出以获取错误信息。

## 故障排除

### 常见问题

1. **扩展未加载**：检查 VSCode 开发者工具（Help > Toggle Developer Tools）中的错误
2. **Webview 未更新**：尝试重新加载窗口（Developer: Reload Window）
3. **构建错误**：确保所有依赖项都已通过 `npm run install:all` 安装

### 调试技巧

- 在代码中使用 `console.log()` 语句进行调试
- 检查 VSCode 中的输出面板（View > Output）并从下拉菜单中选择 "Kilo Code"
- 对于 Webview 问题，请在 Webview 中使用浏览器开发者工具（右键点击 > "Inspect Element"）
