# P2 效能考核 — 实现变更台账

规格：[P2-ASSESSMENT-SPEC-v1.md](./P2-ASSESSMENT-SPEC-v1.md)  
数据底座：[P2-USAGE-ANALYTICS-SPEC-v1.md](./P2-USAGE-ANALYTICS-SPEC-v1.md)（已验收）

---

## 状态说明

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase A | 个人 V3 考核 | 进行中 |
| Phase B | 管理者团队考核（组织树） | 待定 |
| Phase C | 人工产出 / 渗透率 | 待定 |

---

## P2-A-001 — 2026-07-09

- **范围**：Phase A 个人 V3 考核（Platform 评分引擎 + Admin Tab + 导出）
- **摘要**：
  - 复用 `buildReport` 用户汇总，按 V3 公式计算对数归一化分项、效率乘数、综合分与 A～E 等级
  - API：`GET /api/v1/usage/assessment/config|report|export`
  - Admin「用量」页新增「效能考核」Tab
- **文件**
  - 新增：
    - `deploy/enterprise/platform/internal/usage/assessment.go`
    - `deploy/enterprise/platform/internal/usage/assessment_test.go`
    - `deploy/enterprise/platform/admin-ui/src/pages/Usage/Assessment.tsx`
  - 修改：
    - `deploy/enterprise/platform/cmd/server/main.go`
    - `deploy/enterprise/platform/admin-ui/src/services/enterprise.ts`
    - `deploy/enterprise/platform/admin-ui/src/pages/Usage/index.tsx`
  - 删除：无
- **数据库**：无（读 `usage_events` 聚合，与使用分析同口径）
- **配置**：默认权重 40/30/30，config 接口返回静态默认值
- **撤回**：删除 assessment 路由与文件即可，不影响使用分析
- **状态**：进行中（待 go test + 云机联调）

---

## 批次模板

```markdown
## P2-A-NNN — YYYY-MM-DD

- **范围**：
- **摘要**：
- **文件**
  - 新增：
  - 修改：
  - 删除：
- **数据库**：
- **配置**：
- **撤回**：
- **状态**：进行中
```
