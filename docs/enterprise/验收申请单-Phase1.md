# Phase 1 验收申请单

| 项 | 内容 |
|---|---|
| 项目名称 | 企业级私有化 AI 编程工具 Phase 1 MVP |
| 申请批次 | M2 / 第一批次 |
| 申请日期 | 2026年06月14日 |
| 乙方联系人 | ________________ |

---

## 1. 交付物清单

| 序号 | 交付物 | 位置/说明 | 是否包含 |
|---|---|---|---|
| 1 | 源代码 | Git 仓库 / tag: `phase1-mvp` | ✅ f1459864d |
| 2 | VSIX 安装包 | `packages/kilo-vscode/yoyo-code-7.3.10.vsix` | ✅ |
| 3 | Docker Compose 与脚本 | `deploy/enterprise/` | ✅ |
| 4 | OpenAPI 草案 | `deploy/enterprise/openapi.yaml` | ✅ |
| 5 | 部署手册 | `docs/enterprise/PHASE1-DEPLOY*.md` | ✅ |
| 6 | E2E 验收记录 | `PHASE1-E2E-CHECKLIST.md` 已勾选 | ✅ |
| 7 | 验收标准 | `验收标准详细说明.md` | ✅ |
| 8 | 安全评审纪要 | `PHASE1-SECURITY-REVIEW.md` | ✅ |
| 9 | 开源合规报告 | `开源组件合规报告.md` | ✅ v1.0（2026-06-14 扫描） |
| 10 | 客户交付说明 | `PHASE1-客户交付说明.md` | ✅ |
| 11 | SSH 隧道联调说明 | `PHASE1-VSCODE-CLOUD-TUNNEL.md` + `scripts/ssh-tunnel-9080.py` | ✅ |

---

## 2. 功能验收摘要

| 模块 | 验收路径 | 结果 |
|---|---|---|
| L5 VS Code 插件 | VSIX + 企业私有化 Tab + B4–B6 对话 | ✅ 通过 |
| L4 APISIX | 云 FullChain smoke A5–A9 | ✅ 通过（43.143.227.210） |
| L2 Bridge | bridge /health + 代理 `/kilo/global/health` | ✅ 通过 |
| L1 Engine + Qdrant | 云 compose + 机内 health 200 | ✅ 通过 |
| License 原型 | 在线 Mock（`online`）+ RSA 离线 C1–C5 | ✅ 通过 |
| 对话/流式 | B6 经网关（SSH 隧道 → APISIX → Engine → Ruiyu MaaS） | ✅ 通过 |

**验收环境：**

- 路径：☑ 云 FullChain + 公网 9080 直连 ☑ SSH 隧道（备选） ☐ 本机 local-dev
- 云服务器：`43.143.227.210`（OpenCloudOS 9）
- 插件 Engine URL：`http://43.143.227.210:9080/kilo`（公网直连，2026-06-02 复测 health 200）
- License：`online` / `poc-demo-key`
- 模型：☑ 云 `.env` Ruiyu MaaS ☐ vLLM ☐ 其他

**自动化证据：**

```text
云机：./scripts/e2e-smoke.sh --full-chain — PASSED（2026-06-10）
本机：run-mvp-acceptance.ps1 — PASSED（2026-06-07）
License 单测 9/9 · 隧道 health/SSE/B6 API smoke · VS Code UI 对话（2026-06-14）· 公网 9080 health/license（2026-06-02）
```

---

## 3. 性能项（Phase 1 可选）

| 项 | 标准 | 实测 | 结论 |
|---|---|---|---|
| 补全 P95 &lt; 3s | 14B | ☐ 未测 | ☑ 有条件通过（Phase 1 免责） |

---

## 4. 已知限制（Phase 1 边界）

- License 为原型（Mock + RSA 离线），非 Phase 2 生产引擎
- **公网 9080**：2026-06-02 开发 PC 复测 **health 200 + license valid**；SSH 隧道仍可作为备选（见 `PHASE1-VSCODE-CLOUD-TUNNEL.md`）
- 模型 API Key 配置在云服务器 `.env`（`KILO_CUSTOM_API_KEY`），插件侧 `customApi.enabled: false`
- RBAC / 管理后台 / 国密 / JetBrains 属 Phase 2/3
- 性能全量指标在 Phase 3 压测验收

---

## 5. 乙方声明

- [x] 交付物与仓库当前分支一致（tag 待打 `phase1-mvp`）
- [x] 已知问题已在 E2E 清单与 §4 列出
- [x] 无硬编码生产密钥提交至仓库

乙方签字：________  日期：2026-06-14

---

## 6. 甲方验收结论（甲方填写）

⬜ **通过**　⬜ **有条件通过**（限期____日整改）　⬜ **不通过**

甲方签字：________  日期：________
