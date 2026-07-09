# Phase 2 — W1 关项清单

**周次：** W1（M2 验收通过后第 1 周）  
**目标：** 单仓 L3 骨架可启动；PG/Redis/platform health 通过；不写业务 API。

---

## 仓库结构（已创建）

```
deploy/enterprise/
  platform/
    cmd/server/main.go      # GET /health, /api/v1/version
    migrations/000001_init.up.sql
    admin/README.md         # W4 初始化 Ant Design Pro
    Dockerfile
    go.mod
    README.md
  env/test.cloud.phase2.env.sample
  scripts/smoke-phase2.sh
  docker-compose.yml        # profile: platform
```

---

## 本机 / 云机操作

### 1. 合并环境变量

```bash
cd deploy/enterprise
# 在现有 .env 末尾追加 Phase 2 段（勿覆盖 KILO_SERVER_PASSWORD 等）
cat env/test.cloud.phase2.env.sample >> .env
nano .env   # 设置 PLATFORM_PG_PASSWORD
```

### 2. 启动 platform profile

```bash
chmod +x scripts/smoke-phase2.sh
docker compose --profile platform up -d --build postgres redis enterprise-platform
docker compose --profile platform ps
```

### 3. 冒烟

```bash
./scripts/smoke-phase2.sh
curl http://127.0.0.1:8090/health
curl http://127.0.0.1:8090/api/v1/version
```

### 4. 与 Phase 1 共存验证

```bash
docker compose --profile gateway --profile license --profile platform ps
# kilo-engine + apisix + enterprise-platform 均应 Up
```

---

## W1 关项勾选

| ID | 项 | 状态 |
|---|---|---|
| W1-01 | [PHASE2-KICKOFF.md](./PHASE2-KICKOFF.md) 内部确认（含 SSO 批次） | ✅ 2026-06-18 |
| W1-02 | 测试 IdP（甲方或自建 Keycloak） | ⏸ 延后至 W3 |
| W1-03 | `platform` 镜像构建成功 | ✅ 云机 2026-06-18 |
| W1-04 | `smoke-phase2.sh` 通过 | ✅ 云机 health/version OK |
| W1-05 | OpenAPI 草案列出 License/Auth/RBAC 路径 | ⬜ |
| W1-06 | 附件三 Phase 2 用例 v1.1 入库 | ⬜ |
| W1-07 | 周会 Demo 录屏（health + compose ps） | ⬜ |

---

## W2 预告（不在 W1 做）

- `enterprise-platform` 连接 PG 并执行 migrate
- License API：`POST /api/v1/license/verify`
- RBAC 表结构与中间件

---

## 修订

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-16 | 单仓方案锁定；W1 骨架落地 |
| v1.1 | 2026-06-18 | W1-03/04 云机验收通过 |
| v1.2 | 2026-06-18 | W1-01 内部确认；甲方事项延后至 M3/W3 |
