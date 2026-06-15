# APISIX SSE 验证（P1-W3-05）

## 配置要点

`apisix.yaml` 中 `kilo-engine` 路由已设置：

- `timeout.read` / `timeout.send` = 300s
- `X-Accel-Buffering: no`（`response-rewrite` 插件）
- `file-logger` 写入 `logs/apisix/enterprise-audit.log`

Compose 将 `logs/apisix` 挂载到容器内 `/usr/local/apisix/logs`。

## 验证步骤

1. 启动栈：

```bash
cd deploy/enterprise
docker compose --profile gateway --profile license up -d
```

2. 健康检查（经网关）：

```bash
curl -s -o /dev/null -w "%{http_code}" -u "kilo:$KILO_SERVER_PASSWORD" \
  http://localhost:9080/kilo/global/health
# 预期 200
```

3. 触发 SSE（需已有 session；或用 CLI 直连对比延迟）：

```bash
# 对比：直连 Engine vs 经 APISIX 的首字节时间（应接近）
curl -N -u "kilo:$KILO_SERVER_PASSWORD" \
  -H "Accept: text/event-stream" \
  "http://localhost:4096/global/event" --max-time 5
```

4. 检查审计日志：

```bash
tail -n 20 logs/apisix/enterprise-audit.log
```

应包含 `/kilo/` 路径请求记录。

## 失败排查

| 现象 | 处理 |
|---|---|
| 502 / 504 | 检查 `kilo-engine` 容器日志；增大 `timeout.read` |
| 流式一次性返回 | 确认 `X-Accel-Buffering: no`；禁用上游 `proxy_cache` |
| 无审计日志 | 确认 `logs/apisix` 目录权限；重启 apisix 容器 |
