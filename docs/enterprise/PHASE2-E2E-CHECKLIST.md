# Phase 2 端到端联调清单（W6）

按顺序勾选。自动化入口：`deploy/enterprise/scripts/smoke-phase2-all.sh`。

## A. Platform 自动化

| # | 步骤 | 命令 / 预期 | 通过 |
|---|---|---|---|
| A1 | W1/W2 smoke | `./scripts/smoke-phase2.sh` | ✅ |
| A2 | W3 JWT + 网关 | `./scripts/smoke-phase2-w3.sh` | ✅ |
| A3 | W4 模型 + Admin API | `./scripts/smoke-phase2-w4.sh` | ✅ |
| A4 | RBAC 三员互斥 | `./scripts/smoke-rbac.sh` | ✅ |
| A5 | W6 总脚本 | `./scripts/smoke-phase2-all.sh` | ✅ 2026-06-02 |

## B. Phase 1 共存

| # | 步骤 | 预期 | 通过 |
|---|---|---|---|
| B1 | Engine + Bridge + APISIX Up | `docker compose ps` | ✅ |
| B2 | 全链路 health | `e2e-smoke.sh --full-chain` | ✅ |
| B3 | License 走 Platform | POST `8090/api/v1/license/verify` | ✅ |
| B4 | Platform + Logto profile | postgres/redis/logto Up | ✅ |

## C. SSO（Logto 自托管）

| # | 步骤 | 预期 | 通过 |
|---|---|---|---|
| C1 | OIDC discovery HTTPS | `authorization_endpoint` 为 https | ✅ |
| C2 | 浏览器 Logto 登录 | `https://wab.flyfishphp.cn/admin/` 进入后台 | ✅ 2026-06-22 |
| C3 | JWT 调 API | `/api/v1/auth/me` Bearer 200 | ✅ w3-smoke |

## D. 管理后台 8 模块（P2-L3-10）

| # | 模块 | 预期 | 通过 |
|---|---|---|---|
| D1 | 租户 | 列表 API | ✅ w4-smoke |
| D2 | 用户 | 列表 API | ✅ w3-smoke |
| D3 | 用量 | summary + detail + License 列表 | ✅ AD Pro |
| D4 | 模型配置 | 保存 + apply + apiKeyEnv | ✅ AD Pro |
| D5 | 代码索引 | 占位页 + 文档说明 | ✅ AD Pro |
| D6 | 安全报告 | 占位页 + 文档说明 | ✅ AD Pro |
| D7 | 系统监控 | monitor health | ✅ w4-smoke |
| D8 | 审计日志 | 筛选 + 分页 | ✅ AD Pro |

## E. 模型配置（P2-L2）

| # | 步骤 | 预期 | 通过 |
|---|---|---|---|
| E1 | deepseek apply | smoke-phase2-w4（仅 deepseek，需 Key） | ✅ |
| E2 | Engine 加载配置 | `KILO_ENGINE_CONFIG=generated.kilo.jsonc` | ✅ |
| E3 | 插件对话 | 经网关 JWT 正常回复 | ✅ 2026-06-23（yoyo-code enterprise.2 + gatekeeper 直连） |

## F. W5 延期（不阻塞 W6 内部验收）

| # | 项 | 状态 |
|---|---|---|
| F1 | APISIX 灰度 `X-Canary` | ⏸ |
| F2 | Fallback upstream | ⏸ |
| F3 | VS Code 插件 SSO | ✅ gatekeeper 直连 Bearer JWT（见 LOGTO-SSO.md §插件） |

## G. P2 IDE 使用分析（P2-L3-11）

规格：[P2-USAGE-ANALYTICS-SPEC-v1.md](./P2-USAGE-ANALYTICS-SPEC-v1.md)

| # | 步骤 | 预期 | 通过 |
|---|---|---|---|
| G1 | migration 000007 | 表 `usage_events` 存在 | ✅ |
| G2 | POST `/api/v1/usage/events` | Bearer JWT，`accepted` 递增 | ✅ |
| G3 | GET `/api/v1/usage/analytics/report` | 四块 JSON + 上海时区日期 | ✅ |
| G4 | GET `/api/v1/usage/analytics/export` | xlsx 四 sheet、中文列名 | ✅ |
| G5 | 管理后台 `/admin/usage` → 使用分析 | 四 Tab 与导出 | ✅ |
| G6 | VS Code 联调 §7.7 G1～G4 | 补全/Agent/跨日/导出一致 | ✅ 2026-07-09 |

---

## Phase 2 出口判定（内部）

- **自动化通过：** A5 + B2 ✅
- **Blocker 手工：** C2 + D1～D4、D7 + E1 + **E3** ✅
- **M3 正式验收：** 另附 [验收申请单-Phase2.md](./验收申请单-Phase2.md) + 甲方对齐附件三

联调记录：

```
日期：2026-06-23
执行人：乙方联调
插件：yoyo-code-7.3.53-enterprise.2.vsix（gatekeeper SSO，Bearer 直连网关，无本地代理）
smoke-phase2-all 输出摘要：[w6] ALL PASSED — 插件对话经 /kilo JWT 正常回复
环境：43.143.227.210 / wab.flyfishphp.cn
```

```
日期：2026-07-09
执行人：乙方联调
范围：P2 IDE 使用分析（Platform + Admin + VS Code）
插件：yoyo-code-7.3.53-enterprise.2.vsix（Gatekeeper SSO 上报）
结果：§7 A1～F3 + G1～G6 全通过（见 P2-USAGE-ANALYTICS-SPEC-v1.md §7）
环境：43.143.227.210 / wab.flyfishphp.cn
```

---

## 修订

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-22 | Phase 2 W6 E2E 清单 |
| v1.2 | 2026-06-23 | E3 插件对话 + gatekeeper 直连 SSO 验收 |
| v1.3 | 2026-07-09 | 新增 §G P2-L3-11 IDE 使用分析验收 |
