# Enterprise Phase 1 部署资产

| 路径 | 说明 |
|---|---|
| `docker-compose.yml` | Engine + Qdrant；profiles：`vllm`、`gateway`、`license` |
| `.env.example` | 环境变量模板 |
| `mock-license.mjs` | License 校验 POC 服务 |
| `apisix/` | APISIX 路由与 SSE 配置 |
| `bridge/` | Layer 2 透传代理 POC（`main.go` + `Dockerfile`） |
| `scripts/health-check.ps1` | Compose 启动后健康检查 |

文档：`docs/enterprise/PHASE1-MILESTONES.md`、`docs/enterprise/PHASE1-DEPLOY.md`  
**云服务器：** [PHASE1-DEPLOY-CLOUD.md](../../docs/enterprise/PHASE1-DEPLOY-CLOUD.md)

## 快速启动

**无 Docker（本机联调）**

```powershell
.\scripts\local-dev.ps1          # 终端 1：kilo serve :4096
cd ..\..\packages\kilo-vscode
bun run extension                # 终端 2
```

见 `docs/enterprise/PHASE1-E2E-LOCAL.md`。

**Windows + Docker**

```powershell
cd deploy/enterprise
.\scripts\build-engine.ps1    # 首次：构建 CLI + 镜像
.\scripts\up.ps1 -License      # Engine + Qdrant + License Mock + smoke
.\scripts\up.ps1 -Build -License -Gateway   # 含 APISIX
```

**Linux / macOS**

```bash
cp .env.example .env
./scripts/build-engine.sh
docker compose --profile license up -d kilo-engine qdrant license-mock
```

VS Code 设置见 `docs/enterprise/PHASE1-DEPLOY.md` §5。  
E2E 勾选见 `docs/enterprise/PHASE1-E2E-CHECKLIST.md`。
