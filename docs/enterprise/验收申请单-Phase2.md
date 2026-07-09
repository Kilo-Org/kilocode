# Phase 2 验收申请单

| 项 | 内容 |
|---|---|
| 项目名称 | 企业级私有化 AI 编程工具 Phase 2 |
| 申请批次 | M3 / 第二批次 |
| 申请日期 | 2026年06月02日 |
| Platform phase | `2-ad-a5` |
| 乙方联系人 | ________________ |

---

## 1. 交付物清单

| 序号 | 交付物 | 位置/说明 | 是否包含 |
|---|---|---|---|
| 1 | L3 enterprise-platform | `deploy/enterprise/platform/` | ✅ |
| 2 | Admin 管理后台（Ant Design Pro） | `platform/admin-ui/` → embed `/admin/` | ✅ |
| 3 | 后台开发文档 | `docs/enterprise/ADMIN-ANT-DESIGN-PRO.md` v1.4 | ✅ |
| 4 | Logto SSO 自托管 | `LOGTO-SSO.md` + 宝塔 HTTPS | ✅ |
| 5 | OpenAPI v0.4 | `deploy/enterprise/openapi.yaml`（全量 Platform API） | ✅ |
| 6 | Compose Phase 2 profile | platform / logto / gateway | ✅ |
| 7 | 自动化验收脚本 | `smoke-phase2*.sh`、`smoke-phase2-all.sh` | ✅ |
| 8 | 云机 AD Pro 验收脚本 | `scripts/verify-cloud-ad.py` | ✅ |
| 9 | E2E 清单 | `PHASE2-E2E-CHECKLIST.md` | ✅ |
| 10 | 验收标准 | `验收标准详细说明.md` §3 | ✅ |
| 11 | Phase 2 周清单 | `PHASE2-W1`～`W6-CHECKLIST.md` | ✅ |
| 12 | P2 IDE 使用统计 | `P2-USAGE-ANALYTICS-SPEC-v1.md` + `P2-USAGE-ANALYTICS-CHANGES.md` | ✅ |

---

## 2. 功能验收摘要

| 模块 | 验收路径 | 结果 |
|---|---|---|
| L3 License | Platform `POST /api/v1/license/verify` | ✅ smoke |
| L3 RBAC | 三员互斥单测 + 角色 API + 权限菜单 | ✅ |
| L3 SSO | Logto OIDC + 浏览器 admin 登录 | ✅ 2026-06-22 |
| L3 后台 | 8 模块 AD Pro（5/6 占位，含文档说明） | ✅ AD Pro 2026-06-02 |
| L3 租户 | 列表 / 新建 / 编辑 + License 到期列 | ✅ |
| L3 用户 | 列表 / 绑角色 / 卸角色 / 详情 `oidc_sub` | ✅ |
| L3 用量 | summary + 7/30 天趋势 + License 列表 + **使用分析四 Tab** | ✅ |
| L3 审计 | 列表 + kind/时间筛选 + 分页 | ✅ |
| L3 模型配置 | 4 Provider + fallback + `apiKeyEnv` + apply | ✅ smoke |
| L4 网关 JWT | APISIX jwt-auth + platform | ✅ W3 smoke |
| L1/L2 Phase 1 | FullChain 与 Phase 2 共存 | ✅ W6 smoke-all |
| P2-L3-09 VS Code SSO | gatekeeper + Bearer 直连 /kilo | ✅ 2026-06-23 |
| P2-L3-11 IDE 使用分析 | ingestion + 四 Tab + xlsx 导出 + VS Code 上报 | ✅ 2026-07-09 |
| L4 灰度/Fallback | W5 范围 | ⏸ 延期 |

**验收环境：**

- 云服务器：`43.143.227.210`（OpenCloudOS 9）
- Platform：`https://wab.flyfishphp.cn`
- Admin：`https://wab.flyfishphp.cn/admin/`
- Logto OIDC：`https://logto.wab.flyfishphp.cn/oidc`
- Logto Console：`https://logto-admin.wab.flyfishphp.cn`
- 网关：`9080`（APISIX）

**自动化证据：**

```text
./scripts/smoke-phase2-all.sh — PASSED（2026-06-02，[w6] ALL PASSED）
./scripts/smoke-phase2-w4.sh — PASSED（AD Pro API：roles / usage/detail / licenses / audit 分页 / apiKeyEnv）
./scripts/smoke-rbac.sh — PASSED（HTTP 三员互斥 409）
python scripts/verify-cloud-ad.py — PASSED（云机 43.143.227.210，phase 2-ad-a5）
浏览器 Logto → admin — PASSED（2026-06-22）
VS Code gatekeeper SSO → 对话 — PASSED（2026-06-23，enterprise.2.vsix）
admin-ui tests/access.test.ts — 4/4 PASSED
P2 使用统计 — PASSED（2026-07-09：migration 000007、analytics API、四 Tab、xlsx 导出、VS Code G1～G4）
```

---

## 3. P2-L3-10 后台走查（AD Pro）

| # | 模块 | 路径 | 能力 | 结果 |
|---|---|---|---|---|
| 1 | 租户管理 | `/admin/tenants` | ProTable、编辑、sys_admin 新建、License 到期 | ✅ |
| 2 | 用户管理 | `/admin/users` | 列表、SSO 绑定列、分配/移除角色、详情 Drawer | ✅ |
| 3 | 用量统计 | `/admin/usage` | 概览、7/30 天趋势、License 列表、**使用分析四 Tab + 导出** | ✅ |
| 4 | 模型配置 | `/admin/model` | ProForm 保存/下发、fallback、apiKeyEnv 环境变量引用 | ✅ |
| 5 | 代码索引 | `/admin/index` | Phase 3 占位（PHASE2-PLAN §5.5） | ✅ 占位 |
| 6 | 安全报告 | `/admin/security` | Phase 3 占位（PHASE2-PLAN §5.6） | ✅ 占位 |
| 7 | 系统监控 | `/admin/monitor` | 组件探活卡片 | ✅ |
| 8 | 审计日志 | `/admin/audit` | ProTable 筛选 + 分页 | ✅ |

**权限矩阵（摘要）：**

| 角色 | 可见菜单 |
|---|---|
| sys_admin | 全部（含新建租户、模型写） |
| tenant_admin | 租户(无新建)、用户、用量、模型(写)、监控、占位页 |
| security_admin | 用户、模型(只读)、监控、审计 |
| audit_admin | 用量、监控、审计 |
| developer / viewer | 无后台 → `/403`（Layout 内提示） |

---

## 4. Blocker 对照（附件三 §3.4）

| Blocker | 结果 |
|---|---|
| P2-L3-02 License 在线 | ✅ |
| P2-L3-08 OIDC 全流程 | ✅ |
| P2-L3-09 VS Code SSO | ✅ gatekeeper 直连 |
| P2-L3-10 后台核心模块 | ✅ AD Pro 1～4、7、8；5、6 占位 |
| P2-L2-01～04 至少 3 家模型 | ✅ deepseek 云 smoke；4 家翻译见 `translate_test.go` |
| P2-L4-01 或 P2-L4-02 | ⏸ W5 延期（内部有条件通过） |

---

## 5. 已知限制（Phase 2 边界）

- W5 灰度/Fallback 未纳入本批次正式验收
- VS Code SSO 已验收（gatekeeper + JWT 直连，VSIX `yoyo-code-7.3.53-enterprise.2`）
- 4 模型「对话冒烟」依赖 `KILO_CUSTOM_API_KEY`；后台仅配置 `apiKeyEnv` 环境变量名，不下发明文密钥
- License 离线 RSA 全量演示、ClickHouse 审计 WORM、跨租户 403 完整演示可 Phase 3 补强
- 代码索引 / Semgrep 安全报告为 Phase 3 占位，符合 P2-L3-10 约定
- 甲方附件三/合同 SSO 批次对齐：M3 前另行签署纪要（见 PHASE2-KICKOFF）

---

## 6. 乙方声明

- [ ] 交付物与仓库当前分支一致
- [ ] 已知问题已在 E2E 清单与 §5 列出
- [ ] 云机 `.env` 无密钥提交 Git
- [ ] Admin 构建产物已嵌入 `platform/internal/admin/static/`（Docker 多阶段 build）

甲方确认：________________  日期：________

乙方确认：________________  日期：________

---

## 修订

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-22 | Phase 2 内部验收申请单草案 |
| v1.2 | 2026-06-23 | P2-L3-09 插件 SSO + 对话验收 |
| v2.0 | 2026-06-02 | AD Pro 替换 W4 静态 SPA；P1/P2 API；权限菜单；openapi v0.4；云机 verify-cloud-ad |
| v2.1 | 2026-07-09 | P2-L3-11 IDE 使用分析（四 Tab + xlsx + VS Code 联调） |
