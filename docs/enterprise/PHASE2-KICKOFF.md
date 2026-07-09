# Phase 2 启动纪要（内部确认）

| 项 | 内容 |
|---|---|
| 会议类型 | Phase 2 内部启动（**暂不等待甲方书面确认**） |
| 日期 | 2026-06-18 |
| 确认方式 | 项目组内部确认；M3 正式验收前再与甲方对齐合同/附件三 |
| 前置条件 | Phase 1 云机验证通过 · W1 platform health OK |

---

## 1. 已确认决策

| # | 决策项 | 结论 |
|---|---|---|
| D1 | 代码仓库 | **单仓** `kilocode` · `deploy/enterprise/platform/`（L3）+ `bridge/`（L2） |
| D2 | SSO 批次 | SSO 纳入 **Phase 2**；OIDC 为 M3 Blocker；SAML/LDAP 择一 |
| D3 | Phase 2 起算 | M2 验收通过日 = **W0** |
| D4 | 测试环境 | 云机 `43.143.227.210` + Compose `platform` profile |
| D5 | 内核策略 | **不修改** `packages/opencode/`；策略经 L2/L3 |

---

## 2. 外部依赖（延后，不阻塞 W1～W2）

| # | 项 | 计划 | 状态 |
|---|---|---|---|
| A1 | 测试 IdP（Keycloak / Authing） | W3 前；可 **自建 Keycloak** 替代 | ⏸ 延后 |
| A2 | 甲方 Git 私有仓 | M3 前同步 | ⏸ 延后 |
| A3 | 甲方镜像仓 | M3 前 | ⏸ 延后 |
| A4 | 合同变更 / 附件三 v1.1（SSO 调至 Phase 2） | **M3 验收前**与甲方确认 | ⏸ 延后 |
| A5 | 各模型 API Key（冒烟） | W4 | ⏸ 延后 |

---

## 3. 乙方 W1 交付承诺

| # | 交付物 | 验收 |
|---|---|---|
| B1 | `deploy/enterprise/platform/` 骨架 + `/health` | `smoke-phase2.sh` 通过 |
| B2 | Compose：`postgres` + `redis` + `enterprise-platform` | `docker compose --profile platform ps` |
| B3 | DB 迁移占位 `migrations/000001_init.up.sql` | 文件入库 |
| B4 | OpenAPI 草案 v0.2（License/Auth/RBAC 路径） | `openapi.yaml` 或 `platform/openapi.yaml` |
| B5 | Phase 2 用例表 v1.1 | [验收标准详细说明.md](./验收标准详细说明.md) §3 |

---

## 4. 六周里程碑（复述）

| 周 | 主题 |
|---|---|
| W1 | 地基 + platform 骨架 |
| W2 | License + RBAC |
| W3 | SSO + JWT + APISIX |
| W4 | 后台 8 模块 MVP + 模型配置 |
| W5 | 灰度/Fallback + VS Code SSO |
| W6 | E2E + 验收申请单 |

详见 [PHASE2-PLAN.md](./PHASE2-PLAN.md)。

---

## 5. 风险与共识

| 风险 | 共识处理 |
|---|---|
| SSO 工期紧 | OIDC 先行；国密 SSO 留 Phase 3 |
| 8 模块范围大 | 代码索引/安全报告 W4 占位页 |
| 合同 SSO 原文在 Phase 3 | **M3 前**与甲方对齐附件三；开发阶段按内部计划推进 |

---

## 6. 行动项

| # | 行动 | 负责人 | 截止 |
|---|---|---|---|
| 1 | 合并 `env/test.cloud.phase2.env.sample` 到云机 `.env` | | |
| 2 | 云机 `docker compose --profile platform up -d` | | |
| 3 | 召开周会节奏：每周 __ 固定 Demo | | |
| 4 | Issue 看板导入 P0（见 PHASE2-PLAN §4） | | |

---

## 7. 内部确认（代替甲方签字）

| 角色 | 确认 | 日期 |
|---|---|---|
| 项目负责人 | ✅ 按本文档 D1～D5 启动 Phase 2 | 2026-06-18 |
| 甲方书面确认 | ⏸ M3 验收前补齐 | — |

---

**归档：** 本纪要存于 `docs/enterprise/`；同步 [二次开发计划.md](./二次开发计划.md) §8。
