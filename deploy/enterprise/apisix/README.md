# APISIX Phase 1

## 启动

```bash
cd deploy/enterprise
docker compose --profile gateway up -d
```

## 路由（W3）

| 路径 | 上游 | 鉴权 |
|---|---|---|
| `/kilo/*` | `enterprise-bridge:8080` | 无（Phase 1） |
| `/api/v1/auth/*` | `enterprise-platform:8090` | 公开 |
| `/api/v1/license/*` | `enterprise-platform:8090` | 公开 |
| `/api/v1/*` | `enterprise-platform:8090` | `jwt-auth` |

**JWT：** `apisix.yaml` 中 consumer `secret` 须与 `.env` 的 `PLATFORM_JWT_SECRET` 一致；payload 含 `key: enterprise-jwt`（`PLATFORM_JWT_KEY`）。

启动 gateway + platform：

```bash
docker compose --profile gateway --profile platform up -d apisix enterprise-platform
```

## SSE 要点

`apisix.yaml` 中 `kilo-engine` 路由设置：

- `proxy_buffering: false`
- `proxy_cache: false`
- 长超时（chat 流式）

## 插件（Phase 1 示例）

- `limit-count`：100 req/min（需 Redis 时在 Phase 2 补全）
- `file-logger`：写 `logs/apisix/enterprise-audit.log`（勿用 `http-logger` + `file://`）

生产环境请启用 TLS、JWT 与独立 Redis。

SSE 验证步骤见 [SSE-VERIFY.md](./SSE-VERIFY.md)。审计日志写入 `../logs/apisix/enterprise-audit.log`。
