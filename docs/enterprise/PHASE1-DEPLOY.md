# Phase 1 安装部署手册（初稿）

面向 POC / 试点环境。生产环境请叠加 APISIX、TLS、备份与监控（Phase 2+）。

面向客户的交付范围说明见 [PHASE1-客户交付说明.md](./PHASE1-客户交付说明.md)。

## 1. 架构（MVP）

```
VS Code 插件 ──► [可选 APISIX] ──► Kilo Engine (kilo serve) ──► vLLM / 自定义 API
                      │
                      └──► [可选] License Mock / 企业 License 服务
```

## 2. 前置条件

| 项 | 要求 |
|---|---|
| 客户端 | VS Code ≥ 1.105，已安装本 Fork 打包的 VSIX |
| 服务端 | Linux x86_64（ARM64 需先构建对应 CLI 镜像） |
| GPU（可选） | 2×4090 或等价，用于 Qwen2.5-Coder-14B |
| 网络 | 插件与 Engine 互通；禁止出域场景关闭公网 egress |

## 3. 构建 Kilo Engine 镜像

在仓库根目录：

```bash
cd packages/opencode
bun run script/build.ts --single --skip-install
docker build -t your-registry/kilo-engine:local .
```

## 4. Docker Compose 启动

本地或云服务器均可用。 **云主机步骤见 [PHASE1-DEPLOY-CLOUD.md](./PHASE1-DEPLOY-CLOUD.md)。**

```bash
cd deploy/enterprise
cp .env.example .env
# 编辑 .env：KILO_SERVER_PASSWORD、模型 API 等
docker compose up -d kilo-engine qdrant
# 可选 GPU 推理：
# docker compose --profile vllm up -d
```

默认 Engine 地址：`http://<host>:4096`（见 `docker-compose.yml`）。

健康检查：

```bash
curl -u "kilo:$KILO_SERVER_PASSWORD" http://localhost:4096/global/health
```

## 5. VS Code 插件配置

在用户或工作区 `settings.json` 中：

```json
{
  "kilo-code.new.enterprise.remoteServer.enabled": true,
  "kilo-code.new.enterprise.remoteServer.url": "http://your-engine-host:4096",
  "kilo-code.new.enterprise.remoteServer.password": "<与 KILO_SERVER_PASSWORD 一致>",
  "kilo-code.new.customApi.enabled": true,
  "kilo-code.new.customApi.baseUrl": "http://your-vllm-host:8000/v1",
  "kilo-code.new.enterprise.license.enabled": true,
  "kilo-code.new.enterprise.license.serverUrl": "http://your-gateway:9080",
  "kilo-code.new.enterprise.license.key": "your-license-key"
}
```

经 APISIX 时，配置网关与路径分离：

```json
{
  "kilo-code.new.enterprise.gatewayUrl": "http://your-gateway:9080",
  "kilo-code.new.enterprise.remoteServer.url": "/kilo"
}
```

或继续使用完整 URL：`http://your-gateway:9080/kilo`。

## 6. License Mock（开发/POC）

```bash
cd deploy/enterprise
bun mock-license.mjs
# 默认 http://127.0.0.1:19090/api/v1/license/verify
```

插件设置：

```json
{
  "kilo-code.new.enterprise.license.serverUrl": "http://127.0.0.1:19090",
  "kilo-code.new.enterprise.license.key": "poc-demo-key"
}
```

## 7. 离线 License 文件（RSA 原型）

`license.offlinePath` + `license.offlinePublicKeyPath`（或 inline PEM）。

生成样例：

```bash
bun deploy/enterprise/scripts/gen-offline-license.mjs
```

含 `signature` 时须 RSA-SHA256 验签通过。详见 [PHASE1-MVP-DELIVERY.md](./PHASE1-MVP-DELIVERY.md) 阶段 2-6。

## 8. APISIX（可选）

```bash
cd deploy/enterprise
docker compose --profile gateway up -d
```

详见 `deploy/enterprise/apisix/README.md`。SSE 路由必须关闭响应缓冲。

## 9. Engine 环境变量（常用）

| 变量 | 说明 |
|---|---|
| `KILO_SERVER_PASSWORD` | 与插件 `remoteServer.password` 一致 |
| `KILO_CUSTOM_API_KEY` | 自定义模型 API Key |
| `KILO_CUSTOM_API_BASE_URL` | OpenAI-compatible 基址 |
| `KILO_DISABLE_CODEBASE_INDEXING` | 无工作区时可由扩展注入 |

## 10. 品牌定制

| 设置 | 作用 |
|---|---|
| `kilo-code.new.enterprise.productName` | 窗口/面板标题 |
| `package.json` `displayName` / `icon` | 市场与扩展列表 |
| `kilo-ui` CSS 变量 | webview 主题色（见 `packages/kilo-ui`） |

命令面板执行 **Enterprise: About & Open Source Notice** 查看 Apache 2.0 声明。

## 11. 故障排查

| 现象 | 检查 |
|---|---|
| 无法连接 Engine | `curl` health；防火墙；`remoteServer.url` 是否含协议 |
| License 失败 | Mock 服务是否启动；`license.enabled`；离线文件路径与到期时间 |
| 流式卡顿 | APISIX `proxy_buffering off`；GPU 利用率 |
| 无模型 | `~/.config/kilo/kilo.jsonc` 是否由 `customApi` 写入 |

## 12. 无 Docker 轻量联调（推荐先做）

```powershell
# 终端 1 — 保持运行
.\deploy\enterprise\scripts\local-dev.ps1

# 终端 2
cd packages/kilo-vscode
bun run extension
```

工作区已可合并 `.vscode/settings.json` 中的 `kilo-code.new.enterprise.*` 项。  
完整说明：[PHASE1-E2E-LOCAL.md](./PHASE1-E2E-LOCAL.md)

## 13. 一键脚本（W6，需 Docker）

| 脚本 | 作用 |
|---|---|
| `deploy/enterprise/scripts/build-engine.ps1` | 构建 CLI + Docker 镜像 |
| `deploy/enterprise/scripts/up.ps1` | 启动 Compose 并跑 smoke |
| `deploy/enterprise/scripts/e2e-smoke.ps1` | 健康检查 + License 校验 |
| `deploy/enterprise/scripts/health-check.ps1` | 轻量健康检查 |

完整联调清单：`PHASE1-E2E-CHECKLIST.md`  
定制 VSIX：`PHASE1-VSIX.md`

## 14. 下一步（Phase 2）

- Go 桥接层全量代理
- License 服务（订阅、只读降级）
- RBAC + 管理后台
- 审计日志入 ClickHouse
