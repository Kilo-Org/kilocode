# enterprise-platform（L3）

Phase 2 企业控制面：**单仓**路径 `deploy/enterprise/platform/`。

## 云机 / Compose

```bash
cd deploy/enterprise
docker compose --profile platform up -d --build enterprise-platform
./scripts/smoke-phase2.sh
./scripts/smoke-phase2-w3.sh
./scripts/smoke-phase2-w4.sh
```

**客户交付镜像**在 `Dockerfile` 中使用 `go build -tags production`：License 导入**必须** RSA 签名，无 `PLATFORM_LICENSE_ALLOW_UNSIGNED` 开关（改 `.env` 无效）。本机 `go run ./cmd/server` 默认 dev 构建，联调可设 `PLATFORM_LICENSE_ALLOW_UNSIGNED=1`。

## API（W4）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/` | 管理后台 SPA |
| GET/PUT | `/api/v1/model-config` | 模型配置 |
| POST | `/api/v1/model-config/apply` | 翻译并写入 `generated.kilo.jsonc` |
| GET | `/api/v1/tenants` | 租户 |
| GET | `/api/v1/usage/summary` | 用量 |
| GET | `/api/v1/monitor/health` | 组件健康 |
| GET | `/api/v1/audit/logs` | 配置审计 |

文档：[PHASE2-W4-CHECKLIST.md](../../../docs/enterprise/PHASE2-W4-CHECKLIST.md)
