# Enterprise 部署资产（Phase 1 + Phase 2）

| 路径 | 说明 |
|---|---|
| `docker-compose.yml` | Engine + Qdrant；profiles：`vllm`、`gateway`、`license`、**`platform`** |
| `platform/` | **Phase 2 L3** — Go API + `admin/`（Ant Design Pro，W4） |
| `.env.example` | 环境变量模板 |
| `env/test.cloud.phase2.env.sample` | Phase 2 PG/Redis/platform 变量 |
| `mock-license.mjs` | License 校验 POC（W2 起逐步替换为 platform API） |
| `apisix/` | APISIX 路由与 SSE 配置 |
| `bridge/` | Layer 2 透传代理 POC（`main.go` + `Dockerfile`） |
| `scripts/smoke-phase2.sh` | Phase 2 platform health 冒烟 |
| `scripts/health-check.ps1` | Compose 启动后健康检查 |

文档：`docs/enterprise/PHASE2-PLAN.md` · `PHASE2-W1-CHECKLIST.md`  
**P2 使用统计口径：** [P2-USAGE-ANALYTICS-SPEC-v1.md](../../docs/enterprise/P2-USAGE-ANALYTICS-SPEC-v1.md)（§7 验收 2026-07-09 ✅）  
**变更台账：** [P2-USAGE-ANALYTICS-CHANGES.md](../../docs/enterprise/P2-USAGE-ANALYTICS-CHANGES.md)  
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

**Linux / macOS — Phase 2 platform（W1）**

```bash
# 在 .env 中追加 env/test.cloud.phase2.env.sample 内容并设置 PLATFORM_PG_PASSWORD
docker compose --profile platform up -d --build postgres redis enterprise-platform
./scripts/smoke-phase2.sh
```

**P2 使用统计（migration `000007`）重建 Platform 后：**

```bash
# 验证表与 API（需 tenant_admin JWT 或 dev-token）
docker compose --profile platform exec -T postgres \
  psql -U kilo -d enterprise -c '\d usage_events'
curl -sf http://127.0.0.1:8090/api/v1/version
# 管理后台 → 用量统计 → 使用分析（四 Tab + 导出）
```

见 [P2-USAGE-ANALYTICS-SPEC-v1.md](../../docs/enterprise/P2-USAGE-ANALYTICS-SPEC-v1.md) §7。

**Linux / macOS — Phase 1**

VS Code 设置见 `docs/enterprise/PHASE1-DEPLOY.md` §5。  
E2E 勾选见 `docs/enterprise/PHASE1-E2E-CHECKLIST.md`。

## 客户激活指引（交付 / 客户）

私有化部署完成、管理后台可访问后，License **由软件供应商离线签发**，**由客户在管理后台自行上传激活**。客户无需 SSH、无需把文件拷到服务器目录。

### 角色分工

| 角色 | 做什么 |
|---|---|
| 软件供应商（贵司） | 完成私有化部署；按合同离线签发 License；通过邮件或 U 盘交付 `.json` 文件 |
| 客户租户管理员 | 登录管理后台 → 租户页 → 上传授权文件 → 激活 |
| 客户研发 | 安装 VS Code 插件，正常使用 AI 能力 |

### 客户操作步骤

1. 打开管理后台地址（示例：`https://<客户域名>/admin/`）。
2. 使用贵司提供的初始账号登录（Logto SSO 或交付时说明的账号）。
3. 进入 **租户** 页（`/admin/tenants`）。
4. 在本租户行点击 **上传授权文件**。
5. 选择贵司通过 **邮件附件** 或 **U 盘** 提供的 License 文件（`.json`）。
6. 点击 **激活**；成功后「License 到期」列会显示到期时间。
7. 通知研发安装插件并开始使用。

### 供应商交付清单（建议随部署邮件发出）

- 管理后台登录地址
- 初始管理员账号说明（或 SSO 配置说明）
- License 文件附件（`.json`）或 U 盘
- 本指引链接或截图（租户页 → 上传授权文件）
- 插件安装包 / 下载地址

### 授权文件说明

- 格式：JSON，由贵司在客户环境**外**签发，含 `key`、`expiresAt`、`signature` 等字段。
- 客户侧 Platform 内置**验签公钥**（随私有化镜像/配置部署），**不能**在客户环境内自行生成有效授权。
- 续期：贵司重新签发新文件，客户在租户页再次上传即可（会更新到期时间或新增授权记录）。

### 激活后行为

| 状态 | 管理后台 | 插件 / AI |
|---|---|---|
| 未上传 License | 到期列为「—」 | 校验失败，无法正常使用（现有策略） |
| 已激活且有效 | 显示到期时间 | 正常使用 |
| 距到期 ≤15 天 | 全站黄色提醒横幅 + 租户/用量页橙色提示 | 仍可用，提醒联系供应商续期 |
| 已过期 | 不显示「即将到期」提醒 | 只读模式（现有策略） |

### 常见问题（给客户）

**Q：文件要放到服务器上吗？**  
A：不需要。在浏览器里选择本机（邮件下载或 U 盘）上的文件即可。

**Q：上传失败「签名无效」？**  
A：确认使用的是贵司最新签发的文件；勿手工修改 JSON。若刚更新过验签公钥文件，需重启 Platform 后再上传。仍失败请联系供应商。

**Q：上传失败「已过期」？**  
A：联系贵司重新签发并下发新文件。

**Q：谁可以上传？**  
A：租户管理员（本租户）；系统管理员也可代传（售后/support 场景）。

### 供应商侧（内部，不交给客户）

- 签发工具：`scripts/gen-offline-license.mjs`（私钥仅保存在贵司内网）。
- 公钥随交付写入部署配置：`PLATFORM_LICENSE_PUBLIC_KEY_PATH`（示例：`samples/license-dev-public.pem`）。
- **更新公钥文件后须重启 Platform**（进程启动时加载公钥，不会热更新）：`docker compose --profile platform up -d --force-recreate enterprise-platform`。
- **客户交付镜像**使用 `-tags production` 构建（见 `platform/Dockerfile`），编译期移除免签路径；改 `.env` 无法开启无签名导入。
- 本机/联调构建不加 `production` tag 时，可用 `PLATFORM_LICENSE_ALLOW_UNSIGNED=1` 导入无签名 json（勿用于客户生产）。

