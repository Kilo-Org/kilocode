# Admin 管理后台

Ant Design Pro 源码：`../admin-ui/`。构建产物嵌入 `internal/admin/static/`，由 Platform 在 `/admin/` 提供。

| # | 模块 | 状态 |
|---|---|---|
| 1 | 租户管理 | ProTable 列表 |
| 2 | 用户管理 | ProTable + 分配角色 |
| 3 | 用量统计 | StatisticCard |
| 4 | 模型配置 | ProForm + 下发 Engine |
| 5 | 代码索引 | 占位 |
| 6 | 安全报告 | 占位 |
| 7 | 系统监控 | 健康卡片 |
| 8 | 审计日志 | ProTable |

## 开发

```bash
cd deploy/enterprise/platform/admin-ui
npm install
npm run dev          # http://localhost:8000/admin/
npm run build        # → internal/admin/static/
```

登录：OIDC（Logto）或开发 `POST /api/v1/auth/dev-token`（`PLATFORM_AUTH_DEV=1`）。

文档：[ADMIN-ANT-DESIGN-PRO.md](../../../../docs/enterprise/ADMIN-ANT-DESIGN-PRO.md)

## 验收

- [PHASE2-W4-CHECKLIST.md](../../../../docs/enterprise/PHASE2-W4-CHECKLIST.md)
- [PHASE2-E2E-CHECKLIST.md](../../../../docs/enterprise/PHASE2-E2E-CHECKLIST.md) §D
