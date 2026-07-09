# 宝塔 Nginx 反代（云机 80/443 已被宝塔占用时）

**不要用** `docker compose --profile tls`（Caddy 会抢 80 端口）。

Logto / Platform 保持 `127.0.0.1` 监听，由宝塔 Nginx 反代并终止 HTTPS。

---

## 重要：不要改这些

| 不要动 | 原因 |
|---|---|
| **伪静态** | 与企业控制面无关，改了易冲突 |
| **Nginx 主配置** | 全局改错影响所有站 |
| **已有「全局反向代理」** | 那是面板能力/别的站点的规则，不能代替本项目的 3 条路由 |

只需改 **3 个网站各自的 vhost**（或新建 2 个子域站点）。

---

## 当前云机状态（排查参考）

- `logto.wab.flyfishphp.cn` 若 **没有独立站点**，会落到 `wab.flyfishphp.cn` 的证书和规则上
- 表现：证书 CN 为 `wab.flyfishphp.cn`、`/oidc/...` 返回 404、platform 启动报 TLS 错误
- `wab.flyfishphp.cn` 若未反代到 `8090`，访问 `/api/v1/version` 会返回 HTML 而非 JSON

---

## 1. 停掉 Caddy（若还在）

```bash
docker rm -f enterprise-caddy-1 2>/dev/null || true
```

## 2. Docker 只监听本机

```bash
LOGTO_BIND=127.0.0.1:3001
LOGTO_ADMIN_BIND=127.0.0.1:3002
PLATFORM_BIND=127.0.0.1:8090
```

```bash
docker compose --profile logto --profile platform up -d
```

**platform 因 OIDC 证书错误循环重启时**，可先临时注释 `.env` 里全部 `PLATFORM_OIDC_*`，待 Nginx/SSL 配好再打开。

---

## 3. 宝塔正确做法（推荐：3 个独立网站）

### 3.1 新建 `logto.wab.flyfishphp.cn`

1. **网站** → **添加站点** → 域名 `logto.wab.flyfishphp.cn`
2. **设置** → **反向代理** → 目标 `http://127.0.0.1:3001`，代理目录 `/`
3. **关键（常见错误）：**
   - **发送域名** 填 `$host`，**不要**填 `127.0.0.1`
   - 在「高级」或配置文件中增加：`proxy_set_header X-Forwarded-Proto $scheme;`
   - 若 discovery 里仍是 `http://127.0.0.1/oidc/auth`，就是这两项没配对
4. **SSL** → 为该子域申请证书
5. DNS：A 记录 `logto.wab` → 云机 IP

### 3.2 新建 `logto-admin.wab.flyfishphp.cn`

同上，反代 `http://127.0.0.1:3002`，单独申请 SSL。

### 3.3 修改 `wab.flyfishphp.cn`（已有）

1. **设置** → **反向代理** → 添加：目标 `http://127.0.0.1:8090`，代理目录 `/`
2. **配置文件** 中删除或注释：
   - `/admin/` 的 `auth_basic`（与 enterprise `/admin/` 冲突）
   - 不需要的 PHP、`/websocket` 等旧规则（若整站只做企业控制面）
3. SSL 保持现有即可

> 若面板提示「反向代理已存在」：到 **反向代理** 列表 **编辑** 已有条目，把目标改为上表端口，不要再去改「伪静态」或「主配置」。

参考片段：`wab.flyfishphp.cn.proxy.conf`、`logto.*.proxy.conf`（可粘贴到站点 **配置文件** 的 `location /` 段）。

---

## 4. `.env`（SSL 就绪后）

```bash
LOGTO_ENDPOINT=https://logto.wab.flyfishphp.cn
LOGTO_ADMIN_ENDPOINT=https://logto-admin.wab.flyfishphp.cn
PLATFORM_OIDC_ISSUER=https://logto.wab.flyfishphp.cn/oidc
PLATFORM_OIDC_REDIRECT_URL=https://wab.flyfishphp.cn/api/v1/auth/callback
PLATFORM_OIDC_CLIENT_ID=<logto-app-id>
PLATFORM_OIDC_CLIENT_SECRET=<logto-app-secret>
```

```bash
docker compose --profile platform up -d --force-recreate enterprise-platform
```

---

## 5. 验证

```bash
# 证书域名应对齐 logto 子域
echo | openssl s_client -connect logto.wab.flyfishphp.cn:443 -servername logto.wab.flyfishphp.cn 2>/dev/null | openssl x509 -noout -subject

curl -s https://logto.wab.flyfishphp.cn/oidc/.well-known/openid-configuration | head -3
curl -s https://wab.flyfishphp.cn/api/v1/version
docker ps | grep enterprise-platform   # 应为 Up，非 Restarting
```

---

## 6. Logto Console

`https://logto-admin.wab.flyfishphp.cn` → Traditional web → Redirect URI：`https://wab.flyfishphp.cn/api/v1/auth/callback`
