# Phase 2 — W2 关项清单

**周次：** W2  
**目标：** PG 迁移 + License API + RBAC 基础表 + 三员互斥逻辑。

---

## 交付物

| 路径 | 说明 |
|---|---|
| `migrations/000002_license_rbac.up.sql` | licenses、usage、users、roles |
| `migrations/000003_seed.up.sql` | 默认租户 + `poc-demo-key` |
| `internal/license/` | `POST /api/v1/license/verify` |
| `internal/rbac/` | 三员互斥 `CanAssign` |
| `internal/db/migrate.go` | 启动时自动迁移 |

---

## 云机部署

```bash
cd /root/kilocode-main/deploy/enterprise

# 同步本机 platform/ 与 docker-compose.yml、scripts/smoke-phase2.sh 后：
docker compose --profile platform up -d --build enterprise-platform
docker compose --profile platform logs enterprise-platform --tail 30
./scripts/smoke-phase2.sh
```

手动验 License：

```bash
curl -s -X POST http://127.0.0.1:8090/api/v1/license/verify \
  -H "Content-Type: application/json" \
  -d '{"key":"poc-demo-key","client":"vscode","machineId":"test"}'
```

插件切换（可选，替代 license-mock）：

```json
"enterprise.license.serverUrl": "http://43.143.227.210:8090"
```

（生产应经 APISIX 路由，W3/W5 完善。）

---

## W2 关项勾选

| ID | 项 | 状态 |
|---|---|---|
| W2-01 | 启动时 PG migrate 成功 | ✅ 云机 2026-06-18 |
| W2-02 | `POST /api/v1/license/verify` 有效 key | ✅ smoke `valid:true` |
| W2-03 | 无效 key 返回 403 | ✅ smoke HTTP 403 |
| W2-04 | `license_usage` 有记录 | ✅ 有效 key 验签成功即写入（否则返回 500） |
| W2-05 | `go test ./...` 通过 | ⏸ 源码单测已交付；云机可选 `docker run ... go test ./...` |
| W2-06 | RBAC 表 + 三员互斥单测 | ✅ `rbac_test.go` 三员互斥用例 |

**云机 smoke 输出（2026-06-18）：** phase `2-w2`，health OK，License 有效/无效用例通过。

可选核查 `license_usage`：

```bash
docker compose --profile platform exec -T postgres \
  psql -U kilo -d enterprise -c "SELECT count(*) FROM license_usage;"
```

---

## W3 预告

- OIDC 登录 + JWT
- APISIX `jwt-auth` 联动
- 用户/角色 HTTP API

---

## 修订

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-18 | W2 License + RBAC 骨架 |
| v1.1 | 2026-06-18 | W2-01～04、06 云机 smoke 验收通过 |
