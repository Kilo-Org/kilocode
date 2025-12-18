---
sidebar_label: 安装Kilo Code
---

# 安装Kilo Code

Kilo Code是一款VS Code扩展，可将AI编程助手直接集成到编辑器中。可通过以下方式安装：

- [**VS Code应用商店（推荐）**](#vs-code-marketplace) - VS Code用户最快捷的安装方式
- [**Cursor应用商店**](#cursor-marketplace) - Cursor用户的推荐安装方式
- [**Open VSX注册表**](#open-vsx-registry) - 适用于VSCodium/Windsurf等兼容VS Code的编辑器
- [**手动安装.vsix文件**](#manual-installation-from-vsix) - 从GitHub Release直接安装

## VS Code应用商店

:::tip

若已安装VS Code：[点击此处直接安装Kilo Code](vscode:extension/kilocode.Kilo-Code)

:::

或按以下步骤操作：

1. 打开VS Code
2. 进入扩展面板：点击侧边栏扩展图标 或按 `Ctrl+Shift+X`（Windows/Linux） / `Cmd+Shift+X`（macOS）
3. 搜索 "Kilo Code"
4. 选择Kilo Code发布的扩展并点击**安装**
5. 根据提示重新加载VS Code

安装完成后，在侧边栏找到Kilo Code图标（<img src="/docs/img/kilo-v1.svg" width="12" />）即可打开面板。

<img src="/docs/img/installing/installing.png" alt="VS Code应用商店中的Kilo Code扩展安装界面" width="400" />
*VS Code应用商店中的Kilo Code扩展安装界面*

## Cursor应用商店

:::tip

若已安装Cursor：[点击此处直接安装Kilo Code](cursor:extension/kilocode.Kilo-Code)

:::

或按以下步骤操作：

1. 打开Cursor
2. 进入扩展面板：点击侧边栏扩展图标 或按 `Ctrl+Shift+X`（Windows/Linux） / `Cmd+Shift+X`（macOS）
3. 搜索 "Kilo Code"
4. 选择Kilo Code发布的扩展并点击**安装**
5. 根据提示重新加载Cursor

安装完成后，在侧边栏找到Kilo Code图标（<img src="/docs/img/kilo-v1.svg" width="12" />）即可打开面板。

## Open VSX注册表

[Open VSX注册表](https://open-vsx.org/)是VS Code应用商店的开源替代方案，适用于因许可证限制无法访问官方商店的编辑器。

在VSCodium、Gitpod、Eclipse Theia、Windsurf等兼容编辑器中，可通过[Open VSX上的Kilo Code页面](https://open-vsx.org/extension/kilocode/Kilo-Code)直接安装。

1. 打开编辑器
2. 进入扩展视图（侧边栏图标或快捷键 `Ctrl+Shift-X` / `Cmd+Shift-X`）
3. 编辑器应已预配置Open VSX注册表
4. 搜索 "Kilo Code"
5. 选择扩展并点击**安装**
6. 根据提示重新加载编辑器

:::note
若编辑器未自动配置Open VSX，需在设置中手动配置扩展市场。具体操作请参考编辑器文档。
:::

## 手动安装VSIX文件

若需手动下载安装：

1. **下载VSIX文件：**

    - 在[Kilo Code GitHub Releases页面](https://github.com/Kilo-Org/kilocode/releases)查找正式版本
    - 从[最新版本](https://github.com/Kilo-Org/kilocode/releases/latest)下载`.vsix`文件

2. **在VS Code中安装：**
    - 打开VS Code
    - 进入扩展视图
    - 点击扩展视图右上角的"..."菜单
    - 选择"从VSIX安装..."
    - 选择已下载的`.vsix`文件

<img src="/docs/img/installing/installing-2.png" alt="VS Code的从VSIX安装对话框" width="400" />
*通过VS Code的"从VSIX安装"对话框进行安装*

## 故障排除

**扩展不可见**

- 重启VS Code
- 检查扩展列表确认Kilo Code已启用
- 尝试禁用后重新启用扩展
- 在输出面板查看错误日志（查看 → 输出，选择"Kilo Code"）

**安装问题**

- 确保网络连接稳定
- 确认VS Code版本≥1.84.0
- 若无法访问VS Code应用商店，尝试Open VSX方式

## 获取支持

若遇到其他问题：

- 加入[Discord社区](https://kilo.ai/discord)获取实时支持
- 在[GitHub](https://github.com/Kilo-Org/kilocode/issues)提交问题报告
- 访问[Reddit社区](https://www.reddit.com/r/KiloCode)
