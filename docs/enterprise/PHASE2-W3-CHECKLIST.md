# Phase 2 — W3 关项清单

**周次：** W3  
**目标：** OIDC 登录骨架、JWT 签发、APISIX `jwt-auth` 联动、用户/角色 HTTP API。

---

## 交付物

| 路径 | 说明 |
|---|---|
| `migrations/000004_auth_oidc.up.sql` | `oidc_sub`、开发用户 seed |
| `internal/auth/` | JWT 签发/校验、Bearer 中间件 |
| `internal/oidc/` | OIDC 登录回调 + dev-token |
| `internal/users/` | `GET /api/v1/users`、`POST .../roles` |
| `apisix/apisix.yaml` | platform 路由 + `jwt-auth` consumer |
| `scripts/smoke-phase2-w3.sh` | JWT + 网关验收 |

---

## 云机部署

```bash
cd /root/kilocode-main/deploy/enterprise

# .env 追加（与 apisix consumer secret 一致）：
# PLATFORM_JWT_SECRET=change-me-enterprise-jwt-secret-32chars
# PLATFORM_JWT_KEY=enterprise-jwt
# PLATFORM_AUTH_DEV=1

docker compose --profile platform up -d --build enterprise-platform

# 网关 + platform 同网段时：
docker compose --profile gateway --profile platform up -d apisix

chmod +x scripts/smoke-phase2-w3.sh
./scripts/smoke-phase2-w3.sh
```

OIDC（Logto，见 [LOGTO-SSO.md](./LOGTO-SSO.md)）：

```bash
docker compose --profile logto up -d
# Console: http://HOST:3002 — 创建 Traditional web 应用
# 配置 PLATFORM_OIDC_* 后重建 platform
```

---

## W3 关项勾选

| ID | 项 | 状态 |
|---|---|---|
| W3-01 | `PLATFORM_JWT_SECRET` 配置，platform 启动 | ✅ 云机 2026-06-18 |
| W3-02 | `POST /api/v1/auth/dev-token` 签发 JWT | ✅ smoke token 320 chars |
| W3-03 | `GET /api/v1/auth/me` Bearer 200 | ✅ tenant_admin |
| W3-04 | `GET /api/v1/users` 租户列表 | ✅ 1 用户 |
| W3-05 | APISIX `jwt-auth` 保护 `/api/v1/*` | ✅ 网关 me 200、匿名 401 |
| W3-06 | OIDC 登录全流程（Logto / 甲方 IdP） | ✅ 浏览器 Logto 登录进 admin |

**云机验收（2026-06-22）：** Logto 自托管 + 宝塔 HTTPS 反代；`https://wab.flyfishphp.cn/admin/` 浏览器 SSO 成功。

---

## 修订

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-18 | W3 Auth/JWT/APISIX 骨架 |
| v1.1 | 2026-06-18 | W3-01～04 云机 platform smoke 通过 |
| v1.2 | 2026-06-18 | W3-05 APISIX jwt-auth 云机验收通过 |
| v1.3 | 2026-06-22 | W3-06 Logto OIDC 浏览器登录验收通过 |

---

## W4 预告

- Admin 8 模块 MVP（React）
- L2 配置翻译
- 4 模型冒烟
