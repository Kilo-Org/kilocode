# Phase 1 端到端联调清单（W6）

按顺序勾选。自动化步骤见 `deploy/enterprise/scripts/e2e-smoke.ps1`。

## A. 服务端（Layer 1 + 4）

| # | 步骤 | 命令 / 预期 | 通过 |
|---|---|---|---|
| A1 | 构建 CLI 与 Engine 镜像 | `build-engine.sh` / `deploy-cloud.sh --build` | ✅ 云 OC9 |
| A2 | 启动 Engine + Qdrant + License | compose FullChain | ✅ |
| A3 | Engine 健康检查 | `curl -u kilo:$PWD http://localhost:4096/global/health` → 200 | ✅ |
| A4 | License 校验 | `POST .../api/v1/license/verify` + `poc-demo-key` → `valid: true` | ✅ |
| A5 | 启动全链路栈 | Engine + Bridge + APISIX + License | ✅ |
| A6 | Bridge 健康 | `curl http://localhost:8080/health` → `ok` | ✅ |
| A7 | 经网关访问 Engine | `curl -u kilo:$PWD http://localhost:9080/kilo/global/health` → 200 | ✅ |
| A8 | 自动化 smoke | `./scripts/e2e-smoke.sh --full-chain` | ✅ |
| A9 | 审计日志有记录 | `logs/apisix/enterprise-audit.log` 有新行 | ✅ |
| A10 | SSE 路由（可选） | 见 `deploy/enterprise/apisix/SSE-VERIFY.md` | 🟡 隧道 curl 已收 `server.connected` |

> **无 Docker**：见 [PHASE1-E2E-LOCAL.md](./PHASE1-E2E-LOCAL.md)，只完成 B 段即可关闭 Phase 1 轻量验收。

## B. 客户端（Layer 5）

| # | 步骤 | 预期 | 通过 |
|---|---|---|---|
| B1 | 编译扩展 | `verify-mvp.ps1` / esbuild + VSIX 打包 | ✅ |
| B2 | 配置 `settings.json` | 见 `PHASE1-DEPLOY.md` §5 | ✅ |
| B3 | VSIX 安装或 `bun run extension` | 侧边栏可打开 YoYo Code Enterprise | ✅ |
| B4 | 设置 → 企业私有化 | License 显示「有效」；Engine URL 正确 | ✅ 经隧道 online |
| B5 | 连接后端 | 状态栏/聊天区显示已连接（非 License 错误） | ✅ 经隧道 |
| B6 | 发起对话 | 流式回复正常；无明显断流 | ✅ 经隧道 |
| B7 | 代码补全（可选） | 需 vLLM profile + customApi | ⬜ |

## C. 离线 License RSA（M2 blocker）

| # | 步骤 | 预期 | 通过 |
|---|---|---|---|
| C1 | 生成样例（可选） | `bun deploy/enterprise/scripts/gen-offline-license.mjs` | ✅ |
| C2 | 配置 signed 文件 + 公钥 | `offline-license.signed.json` + `license.offlinePublicKeyPath` → `license-dev-public.pem` | ✅ |
| C3 | 插件/单测 | reason=`offline_rsa`，连接允许 | ✅ |
| C4 | 篡改 signature | `offline_bad_signature`，连接阻断 | ✅ 单测 |
| C5 | 过期文件 | `offline_expired`，连接阻断 | ✅ 单测 |

## D. 镜像多架构（P1-W6-03）

| # | 步骤 | 预期 | 通过 |
|---|---|---|---|
| D1 | x86 构建 | `docker build` 在 amd64 主机成功 | ⬜ |
| D2 | ARM64（可选） | `docker buildx build --platform linux/arm64` | ⬜ |

## Phase 1 出口判定

- **MVP 可交付**：阶段 0 + 路径 B + 云 FullChain A5–A9 **（✅ 2026-06-10）**
- **M2 合同验收**：MVP + 阶段 3 交付物 + 插件经网关 B4–B6 **（✅ 隧道 2026-06-14；✅ 公网 9080 2026-06-02）**
- **可交付 POC**：A1–A4 + B1–B6（A3/A4 可用 local-dev 替代 Compose）
- **可交付招标演示**：再加 A5–A9 + C2–C3

联调记录：

```
日期：2026-06-14
环境：腾讯云 OpenCloudOS 9，43.143.227.210，Ruiyu MaaS（服务端 .env）
服务端：e2e-smoke.sh --full-chain PASSED（Engine / Bridge / Gateway / License / 审计日志）
客户端（经 SSH 隧道 127.0.0.1:9080）：
  B4 License online ✅
  B5 连接后端 ✅
  B6 对话流式回复 ✅（VS Code UI 确认 2026-06-14）
公网 9080（2026-06-02 开发 PC）：
  curl health 200 {"healthy":true,"version":"7.3.7"} ✅
  license verify valid=true ✅
```
