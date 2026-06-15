# Phase 1 MVP 交付执行清单

面向 M2 合同验收。按顺序执行，完成一项勾一项。

**两种验收路径（满足其一可交付 POC，FullChain 满足 M2）：**

| 路径 | 适用 | 文档 |
|---|---|---|
| **A. 云 FullChain** | 公网测试 + 外部 API | [PHASE1-DEPLOY-TEST-API.md](./PHASE1-DEPLOY-TEST-API.md) |
| **B. 本机轻量** | 无 Docker / 先验插件 | [PHASE1-E2E-LOCAL.md](./PHASE1-E2E-LOCAL.md) |

**测试客户端：** 仅 **Microsoft VS Code**（见 [PHASE1-VSCODE-TEST.md](./PHASE1-VSCODE-TEST.md)），不用 Cursor。

---

## 阶段 0 — 代码与自动化（研发）

```powershell
# 仓库根目录
cd packages\kilo-vscode
bun test tests/unit/enterprise-license-offline.test.ts
bun run typecheck
bun run compile
cd ..\..\deploy\enterprise\scripts
.\verify-mvp.ps1
```

| # | 项 | 命令/产物 | 状态 |
|---|---|---|---|
| 0-1 | License RSA 单测 | 9/9 pass | ✅ |
| 0-2 | typecheck | `bun run typecheck` | ✅ |
| 0-3 | 扩展编译 | `verify-mvp.ps1` / esbuild | ✅ |
| 0-4 | verify-mvp.ps1 | 本地脚本 | ✅ |

---

## 阶段 1 — 服务端（路径 A：云 Docker）

| # | 项 | 说明 | 状态 |
|---|---|---|---|
| 1-1 | 云主机 OpenCloudOS 9 | 安全组 9080、443 出站 | ✅ 43.143.227.210 |
| 1-2 | `cp env/test.cloud.ruiyumaas.env.sample .env` | 密码 + Ruiyu Key | ✅ |
| 1-3 | `./scripts/deploy-cloud.sh --build --full-chain` | smoke 通过 | ✅ 2026-06-10 |
| 1-4 | 公网 curl 9080 health | 开发 PC 可访问 | ✅ 2026-06-02（health 200 + license valid） |

---

## 阶段 1 — 服务端（路径 B：本机）

| # | 项 | 说明 | 状态 |
|---|---|---|---|
| 1B-1 | `.\local-dev.ps1` | 终端保持运行 | ✅ |
| 1B-2 | curl localhost:4096 health | Basic 认证 200 | ✅ |

---

## 阶段 2 — 客户端（VS Code）

### 路径 B：本机 Engine（local-dev）

| # | 项 | 说明 | 状态 |
|---|---|---|---|
| 2-1 | 合并 settings | `samples/vscode-settings.local-mvp.json` | ✅ |
| 2-2 | VS Code 安装 VSIX | `yoyo-code-7.3.10.vsix` | ✅ |
| 2-3 | 企业私有化 Tab | License 有效（`offline_rsa`） | ✅ |
| 2-4 | 已连接 Engine | `http://127.0.0.1:4096` | ✅ |
| 2-5 | 发起对话 | Ruiyu MaaS glm-5.1 | ✅ |

### 路径 A：云网关公网直连（推荐，2026-06-02 已通）

| # | 项 | 说明 | 状态 |
|---|---|---|---|
| 2A-1 | 工作区 settings | [samples/vscode-settings.cloud-43.143.227.210.json](./samples/vscode-settings.cloud-43.143.227.210.json) | ✅ |
| 2A-2 | 公网 health | `curl http://43.143.227.210:9080/kilo/global/health` → 200 | ✅ 2026-06-02 |
| 2A-3 | 公网 License | `POST .../api/v1/license/verify` → `valid: true` | ✅ 2026-06-02 |
| 2A-4 | B4–B6（可选） | VS Code 改公网 URL 后 Reload 再验对话 | ⬜ 建议补一次 UI 确认 |

### 路径 A′：云网关经 SSH 隧道（公网 9080 未通时备选）

| # | 项 | 说明 | 状态 |
|---|---|---|---|
| 2A-1 | SSH 隧道 | `scripts/ssh-tunnel-9080.py` 或 OpenSSH `-L 9080:127.0.0.1:9080` | ✅ |
| 2A-2 | 工作区 settings | [samples/vscode-settings.cloud-tunnel-43.json](./samples/vscode-settings.cloud-tunnel-43.json) | ✅ |
| 2A-3 | B4 License | 有效 / `online`（`poc-demo-key`） | ✅ 2026-06-14 |
| 2A-4 | B5 连接 | 已连接 `http://127.0.0.1:9080/kilo` | ✅ |
| 2A-5 | B6 对话 | 流式回复（云 Engine + Ruiyu MaaS） | ✅ |

详见 [PHASE1-VSCODE-CLOUD-TUNNEL.md](./PHASE1-VSCODE-CLOUD-TUNNEL.md) · [PHASE1-CLOUD-QUICKSTART-43.md](./PHASE1-CLOUD-QUICKSTART-43.md) §5。

---

## 阶段 3 — 交付物打包

| # | 交付物 | 路径 | 状态 |
|---|---|---|---|
| 3-1 | 源代码 | Git 私有仓 tag `phase1-mvp` | ✅ f1459864d |
| 3-2 | VSIX | `packages/kilo-vscode/yoyo-code-7.3.10.vsix` | ✅ |
| 3-3 | 部署手册 | PHASE1-DEPLOY*.md | ✅ |
| 3-4 | OpenAPI | `deploy/enterprise/openapi.yaml` | ✅ |
| 3-5 | E2E 清单 | PHASE1-E2E-CHECKLIST.md | ✅ |
| 3-6 | 验收标准 | 验收标准详细说明.md | ✅ |
| 3-7 | 安全评审 | PHASE1-SECURITY-REVIEW.md | ✅ |
| 3-8 | 开源合规 | 开源组件合规报告.md | ✅ v1.0 2026-06-14 |
| 3-9 | 客户交付说明 | PHASE1-客户交付说明.md | ✅ |
| 3-10 | 验收申请单 | 验收申请单-Phase1.md | ✅ 已填路径 B |

---

## 自动化验收（一键）

```powershell
# 终端 1：保持 Engine
.\deploy\enterprise\scripts\local-dev.ps1

# 终端 2：自动化 + 可选 FullChain
cd deploy\enterprise\scripts
.\run-mvp-acceptance.ps1          # 路径 B MVP
.\run-mvp-acceptance.ps1 -FullChain   # Docker 就绪后补 A5-A9
```

| 检查项 | 脚本步骤 |
|---|---|
| License RSA 单测 C4/C5 | verify-mvp |
| 在线 License P1-LC-01 | mock-license |
| Engine health P1-L1-01 | run-mvp-acceptance |
| VS Code B4–B6 | 手动 | ✅ 本机 4096（2026-06-07）· ✅ 云隧道（2026-06-14） |
| FullChain P1-E2E-02 | `-FullChain`（需 Docker） |

---

## 阶段 4 — 提交验收

1. 填写 [验收申请单-Phase1.md](./验收申请单-Phase1.md)
2. 附交付物清单与 E2E 勾选截图/日志
3. 甲方 10 工作日内验收（合同 §5.3）

---

## 出口判定

| 级别 | 条件 |
|---|---|
| **MVP 可交付** | 阶段 0 + 云 A1–A9 + 路径 B 或 A′ 阶段 2 + C1–C5 **（✅ 2026-06-14）** |
| **POC 可交付** | 同上 |
| **M2 合同验收** | MVP + 阶段 3 交付物 + 公网 9080 或隧道说明书面确认 |
