# Enterprise Admin UI — Ant Design Pro

React 18 + Umi Max 4 + `@ant-design/pro-components`。

完整规格：[docs/enterprise/ADMIN-ANT-DESIGN-PRO.md](../../../../docs/enterprise/ADMIN-ANT-DESIGN-PRO.md)

## 开发

需本地 Platform 运行在 `8090`（`docker compose --profile platform up -d`）。

```bash
cd deploy/enterprise/platform/admin-ui
npm install
npm run dev
```

浏览器：`http://localhost:8000/admin/`（proxy `/api` → `8090`）

开发登录：`admin@enterprise.local`（`PLATFORM_AUTH_DEV=1`）

## 构建（嵌入 Go）

```bash
npm run build
```

产物同步至 `../internal/admin/static/`，随后：

```bash
cd ..
docker compose --profile platform build enterprise-platform
```

## 8 模块

| 路由 | 模块 |
|---|---|
| `/admin/tenants` | 租户管理 |
| `/admin/users` | 用户管理 + 绑角色 |
| `/admin/usage` | 用量统计 |
| `/admin/model` | 模型配置 |
| `/admin/index` | 代码索引（占位） |
| `/admin/security` | 安全报告（占位） |
| `/admin/monitor` | 系统监控 |
| `/admin/audit` | 审计日志 |
