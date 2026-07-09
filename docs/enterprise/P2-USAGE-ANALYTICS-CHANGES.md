# P2 使用统计 — 实现变更台账

规格：`docs/enterprise/P2-USAGE-ANALYTICS-SPEC-v1.md`

---

## P2-001 — 2026-07-05

- **范围**：docs, platform, admin-ui, vscode, opencode-kilocode
- **摘要**：P2 首版 — Platform 事件表与 ingestion/report/export API；管理后台使用分析四 Tab；VS Code 企业 usage 上报与 CLI 转发
- **文件**
  - 新增：
    - `docs/enterprise/P2-USAGE-ANALYTICS-CHANGES.md`
    - `deploy/enterprise/platform/migrations/000007_usage_analytics.up.sql`
    - `deploy/enterprise/platform/internal/usage/analytics.go`
    - `deploy/enterprise/platform/internal/usage/analytics_test.go`
    - `packages/kilo-vscode/src/enterprise/usage.ts`
    - `packages/opencode/src/kilocode/usage/platform.ts`
  - 修改：
    - `deploy/enterprise/platform/cmd/server/main.go`
    - `deploy/enterprise/platform/go.mod`
    - `deploy/enterprise/platform/go.sum`
    - `deploy/enterprise/platform/admin-ui/src/services/enterprise.ts`
    - `deploy/enterprise/platform/admin-ui/src/pages/Usage/index.tsx`
    - `packages/kilo-vscode/src/services/telemetry/telemetry-proxy.ts`
    - `packages/kilo-vscode/src/services/cli-backend/server-manager.ts`
    - `packages/kilo-vscode/src/extension.ts`
    - `packages/kilo-vscode/src/KiloProvider.ts`
    - `packages/opencode/src/kilocode/server/httpapi/handlers/telemetry.ts`
- **数据库**：`000007_usage_analytics.up.sql` — 表 `usage_events`；无 down migration；回滚 `DROP TABLE IF EXISTS usage_events; DELETE FROM schema_migrations WHERE version = 7;`
- **配置**：
  - 插件：Gatekeeper SSO 登录后上报；CLI 子进程 `KILO_ENTERPRISE_PLATFORM_URL` + `KILO_ENTERPRISE_USAGE_TOKEN`
  - Platform：`POST /api/v1/usage/events`、`GET /api/v1/usage/analytics/report`、`GET /api/v1/usage/analytics/export`
- **撤回**：按本文件批次倒序 `git revert` 或删除上述新增文件并还原修改；执行数据库回滚 SQL
- **状态**：已完成

---

## P2-002 — 2026-07-05

- **范围**：opencode-kilocode, vscode, docs
- **摘要**：Agent 写盘采纳追踪 — session idle 时上报 `agent.file.edit_accepted`；checkpoint revert 标记撤回；write/edit/apply_patch 记录编辑字符；inline 采纳带 chars
- **文件**
  - 新增：
    - `packages/opencode/src/kilocode/usage/agent-edits.ts`
    - `packages/opencode/test/kilocode/usage-agent-edits.test.ts`
  - 修改：
    - `packages/opencode/src/kilocode/usage/platform.ts`
    - `packages/opencode/src/session/status.ts`
    - `packages/opencode/src/session/revert.ts`
    - `packages/opencode/src/tool/write.ts`
    - `packages/opencode/src/tool/edit.ts`
    - `packages/opencode/src/tool/apply_patch.ts`
    - `packages/kilo-vscode/src/services/autocomplete/AutocompleteServiceManager.ts`
- **数据库**：无
- **配置**：无
- **撤回**：revert 本批次文件；P2-001 仍保留
- **状态**：已完成

---

## P2-003 — 2026-07-09

- **范围**：platform, vscode
- **摘要**：Platform xlsx 导出 excelize API 编译修复；VS Code `connection-service` 补全 permission/question 目录追踪与 SSE 类型（上游合并残缺，非 P2 业务逻辑）
- **文件**
  - 修改：
    - `deploy/enterprise/platform/internal/usage/analytics.go`
    - `packages/kilo-vscode/src/services/cli-backend/connection-service.ts`
- **数据库**：无
- **配置**：无
- **撤回**：revert 上述文件
- **状态**：已完成

---

## 验收记录

| 日期 | 环境 | 范围 | 结果 |
|---|---|---|---|
| 2026-07-09 | 云机 `43.143.227.210` / `wab.flyfishphp.cn` | Platform migration 000007、ingestion/report/export API、`smoke-phase2-w4.sh`、xlsx 导出 | ✅ |
| 2026-07-09 | 本机 VS Code | VSIX `yoyo-code-7.3.53-enterprise.2.vsix` + Gatekeeper SSO；§7.7 G1～G4 | ✅ |

规格勾选见 [P2-USAGE-ANALYTICS-SPEC-v1.md](./P2-USAGE-ANALYTICS-SPEC-v1.md) §7。
