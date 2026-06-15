# Phase 1 轻量联调（无 Docker）

仅 **本机 CLI + VS Code 扩展**，对应 `PHASE1-E2E-CHECKLIST.md` 的 **B 段**（及部分 A3/A4 的替代验证）。

## 架构

```
VS Code 扩展 ──► http://127.0.0.1:4096 (本机 kilo serve)
                      │
                      └── 模型 API：customApi → **Ruiyu MaaS**（https://ruiyumaas.com/v1，默认 glm-5.1）
License：离线 JSON 文件（无需 License Mock 容器）
```

## 1. 一键启动本机 Engine

**PowerShell（仓库根目录）：**

```powershell
.\deploy\enterprise\scripts\local-dev.ps1
```

脚本会：

1. `bun script/local-bin.ts`（必要时自动编译 CLI）
2. 在 `4096` 端口启动 `kilo serve`
3. 打印 VS Code `settings.json` 片段（密码与路径）

保持该终端窗口运行；另开终端做扩展联调。

## 2. 配置 VS Code

将脚本输出的 JSON 合并到**用户设置**或工作区 `.vscode/settings.json`。

也可复制模板：`.vscode/enterprise.settings.example.json`（需把 `remoteServer.password` 改成脚本打印的密码）。

**离线 License（推荐，无需 Mock 服务）：**

```json
{
  "kilo-code.new.enterprise.license.enabled": true,
  "kilo-code.new.enterprise.license.offlinePath": "D:/ai/kilocode-main/deploy/enterprise/samples/offline-license.example.json",
  "kilo-code.new.enterprise.license.key": "enterprise-offline-demo"
}
```

**或使用在线 Mock（需第二个终端）：**

```powershell
cd deploy/enterprise
bun mock-license.mjs
```

## 3. 启动扩展（VS Code）

在 **VS Code** 中打开本仓库根目录，然后：

```powershell
cd packages/kilo-vscode
bun run extension
```

会在 VS Code **扩展开发宿主** 窗口启动。日常验收请优先用 [PHASE1-VSCODE-TEST.md](./PHASE1-VSCODE-TEST.md) 的 VSIX 安装方式。

## 4. B 段验收勾选

| # | 操作 | 预期 |
|---|---|---|
| B1 | `bun run compile` 已通过 | — |
| B2 | settings 已合并 | — |
| B3 | 扩展启动，打开 Kilo 侧边栏 | 无报错 |
| B4 | 设置 → **企业私有化** | License「有效」；Engine URL `http://127.0.0.1:4096` |
| B5 | 等待连接 | 状态为已连接（非 License 失败） |
| B6 | 发送一条对话 | 流式回复（需 customApi 可达） |

## 5. 健康检查（可选）

```powershell
# 将 $pwd 替换为 local-dev.ps1 打印的密码
$pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("kilo:$pwd"))
Invoke-WebRequest -Uri http://127.0.0.1:4096/global/health -Headers @{ Authorization = "Basic $pair" }
```

## 6. 与 Docker 路径的差异

| 能力 | 无 Docker | 有 Docker |
|---|---|---|
| Engine | 本机 `kilo serve` | Compose |
| Qdrant | 不启动（索引可选关闭） | Compose |
| APISIX 审计 | 跳过 A3/A7 | `profile gateway` |
| License | 离线文件 / `bun mock-license.mjs` | Compose `license-mock` |

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| 端口占用 | 修改 `local-dev.ps1` 的 `$Port` 与 settings 中 URL |
| License 无效 | 检查 `offlinePath` 绝对路径、`expiresAt`、key 一致 |
| 连接失败 | 确认 `local-dev.ps1` 终端仍在运行；密码与 settings 一致 |
| 无模型回复 | 配置 `customApi.baseUrl` / `apiKey` 或环境变量 `KILO_CUSTOM_API_*` |

Phase 1 无 Docker 完成标准：**B1–B6 全部通过** 即可进入提交与 Phase 2 规划。
