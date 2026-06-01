# APISIX Phase 1

## 启动

```bash
cd deploy/enterprise
docker compose --profile gateway up -d
```

## 路由

| 路径 | 上游 |
|---|---|
| `/kilo/*` | `kilo-engine:4096` |
| `/api/v1/license/*` | `license-mock:19090`（profile license） |

## SSE 要点

`apisix.yaml` 中 `kilo-engine` 路由设置：

- `proxy_buffering: false`
- `proxy_cache: false`
- 长超时（chat 流式）

## 插件（Phase 1 示例）

- `limit-count`：100 req/min（需 Redis 时在 Phase 2 补全）
- `http-logger`：写 `/usr/local/apisix/logs/access.log`

生产环境请启用 TLS、JWT 与独立 Redis。
