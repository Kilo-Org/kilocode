# Logto SSO — 自托管 / Logto Cloud

企业平台使用标准 **OIDC 授权码**；[Logto](https://logto.io/) 作为 IdP，兼容自托管与 SaaS，无需改 platform 代码。

> **HTTP 公网访问会报错** `Crypto.subtle is unavailable` — Logto 控制台与用户登录页须 **HTTPS**（或 localhost 隧道）。

---

## 推荐：域名 + HTTPS

### 方式 A — 宝塔 Nginx（本云机已占用 80/443）

见 [deploy/enterprise/nginx/README.md](../../deploy/enterprise/nginx/README.md)。

- `wab.flyfishphp.cn` → `127.0.0.1:8090`（**勿启** Docker Caddy）
- `logto.wab.flyfishphp.cn` → `127.0.0.1:3001`
- `logto-admin.wab.flyfishphp.cn` → `127.0.0.1:3002`

### 方式 B — Docker Caddy（仅 80/443 未被占用时）

| 子域 | 用途 | 反代目标 |
|---|---|---|
| `logto.wab.flyfishphp.cn` | Logto OIDC | `logto:3001` |
| `logto-admin.wab.flyfishphp.cn` | Logto 控制台 | `logto:3002` |
| `wab.flyfishphp.cn` | 企业控制面 | `enterprise-platform:8090` |

```bash
docker compose --profile logto --profile platform --profile tls up -d
```

在域名控制台为 **43.143.227.210** 添加 A 记录：

- `wab.flyfishphp.cn`
- `logto.wab.flyfishphp.cn`
- `logto-admin.wab.flyfishphp.cn`

（或用 `*.wab.flyfishphp.cn` 泛解析。）

### 步骤 2 — 防火墙 / 安全组

放行：**80、443**（Let's Encrypt 校验 + HTTPS）。

Logto / Platform **不要**对公网暴露 3001/3002/8090（仅 `127.0.0.1` 绑定，由 Caddy 对外）。

### 步骤 3 — `.env`

参考 `env/test.cloud.logto.env.sample`：

```bash
CADDY_EMAIL=admin@flyfishphp.cn

LOGTO_PG_PASSWORD=<强密码>
LOGTO_ENDPOINT=https://logto.wab.flyfishphp.cn
LOGTO_ADMIN_ENDPOINT=https://logto-admin.wab.flyfishphp.cn
LOGTO_BIND=127.0.0.1:3001
LOGTO_ADMIN_BIND=127.0.0.1:3002

PLATFORM_OIDC_ISSUER=https://logto.wab.flyfishphp.cn/oidc
PLATFORM_OIDC_CLIENT_ID=<待填>
PLATFORM_OIDC_CLIENT_SECRET=<待填>
PLATFORM_OIDC_REDIRECT_URL=https://wab.flyfishphp.cn/api/v1/auth/callback
PLATFORM_OIDC_BROWSER_REDIRECT=/admin/
PLATFORM_BIND=127.0.0.1:8090
```

### 步骤 4 — 启动

```bash
cd /root/kilocode-main/deploy/enterprise
docker compose --profile logto --profile platform --profile tls up -d
docker compose --profile tls logs caddy --tail 30
```

验证证书与 OIDC：

```bash
curl -s https://logto.wab.flyfishphp.cn/oidc/.well-known/openid-configuration | head -3
curl -s https://wab.flyfishphp.cn/api/v1/version
```

### 步骤 5 — Logto Console

1. 打开 **https://logto-admin.wab.flyfishphp.cn** → 创建 Logto 管理员
2. **Applications** → **Traditional web**
3. **Redirect URI：** `https://wab.flyfishphp.cn/api/v1/auth/callback`
4. **Post sign-out redirect URI：** `https://wab.flyfishphp.cn/admin/`
5. 复制 App ID / Secret → 写入 `.env` 的 `PLATFORM_OIDC_CLIENT_*`
6. 重建 platform：

```bash
docker compose --profile platform up -d --force-recreate enterprise-platform
curl -s https://wab.flyfishphp.cn/api/v1/auth/status
```

### 步骤 6 — 验收（W3-06）

1. **https://wab.flyfishphp.cn/admin/**
2. 点击 **Logto 登录**
3. 在 `logto.wab.flyfishphp.cn` 完成登录 → 回到管理后台

---

## 临时方案：SSH 隧道（仅本机配 Console）

```bash
ssh -L 3002:127.0.0.1:3002 -L 3001:127.0.0.1:3001 root@43.143.227.210
```

浏览器访问 `http://localhost:3002`（仅配置阶段，不能替代生产 HTTPS）。

---

## Platform 变量说明

| 变量 | 示例 |
|---|---|
| `PLATFORM_OIDC_ISSUER` | `https://logto.wab.flyfishphp.cn/oidc`（必须以 `/oidc` 结尾） |
| `PLATFORM_OIDC_REDIRECT_URL` | 与 Logto 应用 Redirect URI **完全一致** |
| `LOGTO_ENDPOINT` | 与 Issuer 去掉 `/oidc` 相同 |
| `LOGTO_ADMIN_ENDPOINT` | 管理控制台公网 URL |

SSO 验收通过后：`PLATFORM_AUTH_DEV=0`

---

## VS Code 插件 SSO（P2-L3-09 / gatekeeper）

### Platform

`.env`（与扩展 `publisher.name` 一致：`yoyo-local.yoyo-code`）：

```bash
PLATFORM_OIDC_VSCODE_URI=vscode://yoyo-local.yoyo-code/gatekeeper/callback
```

登录入口：`GET /api/v1/auth/login?client=vscode` → Logto → Platform 回调签发 JWT → 302 到 `vscode://…/gatekeeper/callback?token=…`

**Logto Redirect URI 仍只需 HTTPS：**

`https://wab.flyfishphp.cn/api/v1/auth/callback`（不要加 `vscode://`）

### APISIX

`/kilo/*` 对 `Authorization: Bearer` 启用 `jwt-auth`（`kilo-engine-jwt` 路由）；Basic 仍走 `kilo-engine` 路由。

```bash
./scripts/sync-apisix-from-env.sh
```

### 交付 VSIX

`packages/kilo-vscode/yoyo-code-7.3.53-enterprise.2.vsix`

- 内置 gatekeeper 默认：`https://wab.flyfishphp.cn`
- 登录后 **Bearer JWT 直连网关**，无本地 HTTP 代理

可选 settings 见 [samples/vscode-settings.cloud-sso-wab.json](./samples/vscode-settings.cloud-sso-wab.json)。

### 验收步骤

1. 安装 `yoyo-code-7.3.53-enterprise.2.vsix`，重载窗口
2. 侧边栏 **企业登录** → 浏览器 Logto → 回到 VS Code
3. 提示「SSO 登录成功，已连接 https://wab.flyfishphp.cn/kilo」
4. 聊天经 JWT 正常回复

自动化：`./scripts/smoke-phase2-sso.sh`（dev-token + Bearer `/kilo/global/health`）

---

## 用户建档

| 场景 | 行为 |
|---|---|
| 首次 Logto 登录 | 自动创建用户，默认 `developer` |
| 需管理员 | PG 分配 `tenant_admin` 等角色 |

---

## 修订

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-18 | Logto 替代 Keycloak |
| v1.1 | 2026-06-18 | 域名 HTTPS（Caddy + wab.flyfishphp.cn） |
| v1.3 | 2026-06-23 | gatekeeper 直连 SSO + VSIX enterprise.2 |
