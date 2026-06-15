# Phase 1 定制 VSIX 打包

## 前置

```bash
cd packages/kilo-vscode
bun script/local-bin.ts --force   # 捆绑 CLI
bun run compile
```

## 品牌

| 项 | 文件 |
|---|---|
| 扩展名 | `package.json` → `displayName`, `name`, `publisher` |
| 图标 | `assets/icons/` |
| 面板标题 | `kilo-code.new.enterprise.productName` |
| webview 主题 | `packages/kilo-ui` CSS 变量 |

## 打包

```bash
cd packages/kilo-vscode
bun run package
# 产出: *.vsix
```

## 安装（Microsoft VS Code）

VS Code → 扩展 → `...` → **从 VSIX 安装…**

或命令行：

```powershell
code --install-extension "路径\yoyo-code-7.3.10.vsix" --force
```

完整步骤：[PHASE1-VSCODE-TEST.md](./PHASE1-VSCODE-TEST.md)（**不要用 Cursor 测 MVP**）。

## 私有化配置分发

将 `PHASE1-DEPLOY.md` §5 的 `settings.json` 片段放入：

- 用户 `settings.json`（全局）
- 或工作区 `.vscode/settings.json`
- 或企业策略下发（GPO / Intune）

## 验收

- [ ] VSIX 安装后扩展激活无报错
- [ ] 关于命令显示 Apache 2.0 声明
- [ ] 企业私有化 Tab 可见
