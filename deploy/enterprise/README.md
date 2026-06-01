# Enterprise Phase 1 部署资产

| 路径 | 说明 |
|---|---|
| `docker-compose.yml` | Engine + Qdrant；profiles：`vllm`、`gateway`、`license` |
| `.env.example` | 环境变量模板 |
| `mock-license.mjs` | License 校验 POC 服务 |
| `apisix/` | APISIX 路由与 SSE 配置 |
| `bridge/README.md` | Layer 2 桥接层契约（Go 独立仓） |

文档：`docs/enterprise/PHASE1-MILESTONES.md`、`docs/enterprise/PHASE1-DEPLOY.md`

## 快速启动

```bash
cp .env.example .env
# 编辑 KILO_SERVER_PASSWORD

docker compose up -d kilo-engine qdrant
docker compose --profile license up -d   # 可选
```

VS Code 设置见 `PHASE1-DEPLOY.md` §5。
