# Phase 1 — VS Code 测试指南

**约定：** MVP 与交付验收均在 **Microsoft VS Code** 中进行，不使用 Cursor。

相关：[PHASE1-MVP-DELIVERY.md](./PHASE1-MVP-DELIVERY.md) · [PHASE1-VSIX.md](./PHASE1-VSIX.md) · [PHASE1-E2E-LOCAL.md](./PHASE1-E2E-LOCAL.md)

---

## 1. 环境

| 项 | 要求 |
|---|---|
| VS Code | ≥ 1.105（与 `package.json` `engines.vscode` 一致） |
| 工作区 | 打开仓库根目录 `kilocode-main`（加载 `.vscode/settings.json`） |
| 后端 | **本机：** `local-dev.ps1` · **云：** SSH 隧道 → `127.0.0.1:9080/kilo`（见 [PHASE1-VSCODE-CLOUD-TUNNEL.md](./PHASE1-VSCODE-CLOUD-TUNNEL.md)） |

---

## 2. 安装 VSIX

```powershell
cd D:\ai\kilocode-main\packages\kilo-vscode
# 若 VSIX 不存在或需重建：
node esbuild.js --production
bunx vsce package --no-dependencies --skip-license
```

**图形界面：** VS Code → 扩展 → `...` → **从 VSIX 安装…** → 选择：

```text
packages/kilo-vscode/yoyo-code-7.3.10.vsix
```

**命令行（VS Code 官方 CLI）：**

```powershell
code --install-extension "D:\ai\kilocode-main\packages\kilo-vscode\yoyo-code-7.3.10.vsix" --force
```

安装后 **Developer: Reload Window**。

> 不要用 `cursor --install-extension`；Cursor 与 VS Code 扩展目录分离，配置不互通。

---

## 3. 工作区设置（必做）

用 VS Code **文件 → 打开文件夹** → 选择 `D:\ai\kilocode-main`。

### 路径 B — 本机 Engine（local-dev）

复制 [samples/vscode-settings.local-mvp.json](./samples/vscode-settings.local-mvp.json)：

| 设置 | 说明 |
|---|---|
| `enterprise.license.*` | 离线 RSA 或在线 Mock |
| `enterprise.remoteServer.url` | `http://127.0.0.1:4096` |
| `enterprise.remoteServer.password` | `local-phase1-dev` |
| `customApi.*` | Ruiyu MaaS（本机 `.vscode/settings.json`） |

### 路径 A′ — 云网关经 SSH 隧道（2026-06-14 验收通过）

复制 [samples/vscode-settings.cloud-tunnel-43.json](./samples/vscode-settings.cloud-tunnel-43.json)：

| 设置 | 说明 |
|---|---|
| `enterprise.remoteServer.url` | `http://127.0.0.1:9080/kilo` |
| `enterprise.license.serverUrl` | `http://127.0.0.1:9080` |
| `enterprise.license.key` | `poc-demo-key`（在线 `online`） |
| `enterprise.license.offlinePath` | 留空（在线模式） |
| `customApi.enabled` | `false`（模型在云 `.env`） |

**隧道：** 见 [PHASE1-VSCODE-CLOUD-TUNNEL.md](./PHASE1-VSCODE-CLOUD-TUNNEL.md) 或 `scripts/ssh-tunnel-9080.py`。

改设置后 **Developer: Reload Window**。

---

## 4. 验收步骤

### 本机 local-dev

1. 侧边栏 **YoYo Code Enterprise**
2. 企业私有化 → License **有效**（`offline_rsa`）· Engine `http://127.0.0.1:4096`
3. **已连接** → 对话流式回复

### 云网关 + SSH 隧道

1. 终端运行隧道（保持不关）
2. 企业私有化 → License **有效**（`online`）· Engine `http://127.0.0.1:9080/kilo`
3. **已连接** → 对话流式回复（Ruiyu MaaS 经云 Engine）

---

## 5. 开发模式（改代码时，仍在 VS Code）

```powershell
# 终端 1
.\deploy\enterprise\scripts\local-dev.ps1

# 终端 2
cd packages\kilo-vscode
bun run extension
```

会在 **VS Code 扩展开发宿主** 窗口打开（需本机已装 VS Code 且 `code` 在 PATH）。

---

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| License「未启用 / disabled」 | 未打开工作区或未设 `license.enabled: true`；见 §3 |
| 扩展列表里没有 YoYo | 确认 VSIX 装在 **VS Code** 而非 Cursor |
| 连不上 Engine | local-dev 在跑 / 或隧道 health 200 后 Reload |
| 聊天框「连接失败」 | 隧道进程退出；`netstat` 查 9080 冲突；见 CLOUD-TUNNEL 文档 |
| `offline_key_mismatch` | `license.key` 与离线 JSON 的 `key` 不一致 |
| 对话无回复 | 本机：检查 `customApi.apiKey` · 云：检查 `.env` `KILO_CUSTOM_API_KEY` |

---

## 7. 与 Cursor 的区别（测试时勿混用）

| | VS Code | Cursor |
|---|---|---|
| 扩展安装目录 | 独立 | 独立 |
| 工作区 settings | 仅在该编辑器打开工作区时生效 | 不读取 VS Code 已装扩展 |
| MVP 验收 | ✅ 使用 | ❌ 不使用 |

---

## 8. MVP 验收记录

| 项 | 结果 | 日期 |
|---|---|---|
| 自动化 `run-mvp-acceptance.ps1` | ✅ PASSED | 2026-06-07 |
| VS Code B4–B6（本机 4096） | ✅ 通过 | 2026-06-07 |
| 云 FullChain A5–A9 | ✅ smoke | 2026-06-10 |
| VS Code B4–B6（云隧道 9080） | ✅ 通过 | 2026-06-14 |
