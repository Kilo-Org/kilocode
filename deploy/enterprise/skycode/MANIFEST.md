# skycode 客户仓库文件清单

面向仓库：[yoyoabc/skycode](https://github.com/yoyoabc/skycode)（客户可构建、可部署的公开交付仓）

**原则：** 以黑名单为主（从本仓剔除敏感/内部内容）；白名单用于核对构建所需最小集。

配套文件（留在**供应商内网仓**，不复制给客户）：

| 文件 | 用途 |
|---|---|
| [gitignore](./gitignore) | 复制到 skycode 根目录为 `.gitignore` |
| [export.ts](./export.ts) | 一键导出 + 推送前检查 |
| [../../script/check-skycode-push.ts](../../script/check-skycode-push.ts) | 供应商推送前检查（**不进客户仓**） |

---

## 1. 白名单（客户仓应包含）

### 1.1 仓库根目录

| 路径 | 说明 |
|---|---|
| `package.json` | Monorepo 工作区 |
| `bun.lock` / `bunfig.toml` | 依赖锁定 |
| `patches/` | 上游补丁 |
| `turbo.json` | 构建编排 |
| `tsconfig.json` | TS 基座 |
| `install` | 安装入口 |
| `LICENSE` | 许可证 |
| `README.md` | **需改写**为客户版（勿链内部文档） |
| `.gitignore` | 由本目录 `gitignore` 复制 |
| `.editorconfig`、`.gitattributes`、`.oxlintrc.json`、`.prettierignore` | 可选，利于协作 |

**建议不包含：** 多语言 `README.*.md`、`RELEASING.md`、`CONTRIBUTING.md`（上游贡献流）、`flake.nix`、`kilocode-cloud.tgz`

### 1.2 packages（构建 VS Code + Engine + Platform）

| 包 | 必需 | 说明 |
|---|---|---|
| `packages/opencode/` | ✅ | CLI / Engine 核心 |
| `packages/kilo-vscode/` | ✅ | VS Code 扩展（企业化） |
| `packages/sdk/js/` | ✅ | HTTP SDK |
| `packages/core/` | ✅ | 共享核心 |
| `packages/kilo-gateway/` | ✅ | 网关 |
| `packages/kilo-indexing/` | ✅ | 索引 |
| `packages/kilo-telemetry/` | ✅ | 遥测（可配置关闭） |
| `packages/kilo-i18n/` | ✅ | 国际化 |
| `packages/kilo-ui/` | ✅ | Webview UI |
| `packages/ui/` | ✅ | UI 组件 |
| `packages/plugin/` | ✅ | 插件接口 |
| `packages/plugin-atomic-chat/` | ✅ | 依赖 |
| `packages/http-recorder/` | ✅ | 依赖 |
| `packages/llm/` | ✅ | 依赖 |
| `packages/script/` | ✅ | 构建脚本 |
| `packages/kilo-web-ui/` | 可选 | 若扩展 webview 引用 |
| `packages/kilo-console/` | 可选 | 非扩展主路径可省略 |
| `packages/kilo-jetbrains/` | ❌ | 非本交付范围 |
| `packages/kilo-docs/` | ❌ | 上游产品文档站 |
| `packages/storybook/` | ❌ | 组件演示 |
| `packages/yoyo-auth/` | ❌ | 内部登录扩展 |
| `packages/extensions/` | ❌ | Zed 等，非必需 |
| `packages/containers/` | 可选 | 容器相关 |
| `packages/effect-drizzle-sqlite/` | 按需 | opencode 若引用则保留 |

### 1.3 deploy/enterprise（私有化交付）

| 路径 | 必需 | 说明 |
|---|---|---|
| `deploy/enterprise/docker-compose.yml` | ✅ | 去掉 `license-mock` profile 说明或整段 |
| `deploy/enterprise/platform/` | ✅ | Go 控制面 + Admin UI |
| `deploy/enterprise/bridge/` | ✅ | 网关桥接 |
| `deploy/enterprise/apisix/` | ✅ | 网关配置 |
| `deploy/enterprise/config/*.kilo.jsonc` | ✅ | 模型配置模板（无真实 Key） |
| `deploy/enterprise/env/*.env.sample` | ✅ | **脱敏**：去掉测试云 IP/域名注释 |
| `deploy/enterprise/scripts/build-engine.sh` | ✅ | 构建 Engine 镜像 |
| `deploy/enterprise/scripts/deploy-cloud.sh` | ✅ | 部署入口 |
| `deploy/enterprise/scripts/bootstrap-oc9.sh` | ✅ | 主机初始化 |
| `deploy/enterprise/scripts/e2e-smoke.sh` | 可选 | 冒烟（改用客户域名） |
| `deploy/enterprise/openapi.yaml` | ✅ | API 契约 |
| `deploy/enterprise/samples/offline-license.example.json` | ✅ | **无签名**模板 |
| `deploy/enterprise/README.md` | ✅ | **删「供应商侧」§** 后给客户 |

### 1.4 script/（仓库根 — 仅供应商内网仓）

| 路径 | 说明 |
|---|---|
| `script/check-skycode-push.ts` | 导出后、push 前在**供应商侧**运行；**不交付客户** |

### 1.5 推送前须在代码中处理（白名单内但需裁剪）

| 项 | 处理 |
|---|---|
| `packages/kilo-vscode/src/enterprise/license-crypto.ts` | **删除** `signRsaSha256`（仅保留验签） |
| `packages/kilo-vscode/tests/unit/enterprise-license-offline.test.ts` | 去掉生成私钥/签名的用例，或整文件不交付 |
| `deploy/enterprise/platform/migrations/000003_seed.up.sql` | 演示 Key `poc-demo-key` 改为占位或移除 |
| `deploy/enterprise/platform/internal/license/unsigned_dev.go` | 可保留源码，**客户镜像必须用 `-tags production` 构建** |
| Admin `dev-token` 登录 | 生产 `.env` 设 `PLATFORM_AUTH_DEV=0` |

---

## 2. 黑名单（禁止进入 skycode）

### 2.1 目录（整目录排除）

```
docs/enterprise/
scripts/                          # 根目录 scripts/ 全部为云机运维，整包排除
packages/yoyo-auth/
packages/kilo-jetbrains/
packages/kilo-docs/
packages/storybook/
deploy/enterprise/caddy/
deploy/enterprise/nginx/          # 含 flyfishphp 测试域配置
deploy/enterprise/dist/
.kilo/
.opencode/
.github/                          # 可选：客户仓不必含上游 CI
```

### 2.2 文件（按路径）

| 路径 | 原因 |
|---|---|
| `deploy/enterprise/scripts/gen-offline-license.mjs` | **离线 License 签发**（供应商专属） |
| `deploy/enterprise/mock-license.mjs` | 假 License 服务 |
| `deploy/enterprise/samples/offline-license.signed.json` | 已签名授权文件 |
| `deploy/enterprise/samples/license-dev-public.pem` | 与签发体系绑定的公钥 |
| `deploy/enterprise/samples/license-dev-private.pem` | 私钥 |
| `packages/kilo-vscode/script/package-yoyo.ts` | 内网打包脚本（硬编码测试域） |
| `deploy/enterprise/scripts/pack-for-cloud.ps1` | 内网整包上传云机 |
| `kilocode-cloud.tgz` | 云部署归档 |
| `packages/kilo-vscode/*.vsix` | 构建产物 |
| `tmp-*` | 临时文件 |
| `*.pem`（根目录及 tmp） | 密钥材料 |
| `企业私有化*.md`（仓库根） | 内部方案 |
| `docs/enterprise/软件外包开发合同*.md` | 商业合同 |

### 2.3 文档类（`docs/enterprise/` 全部）

含但不限于：Phase 计划、验收清单、P2 规格/台账、考核 xlsx、合同、二次开发计划、云机 Quickstart 等。**客户仓不提供内部交付文档**；仅保留改写后的根 `README.md` + `deploy/enterprise/README.md`（客户版）。

### 2.4 内容敏感串（推送前检查脚本会扫）

| 模式 | 原因 |
|---|---|
| `fcb326XYZ0!@#` | 云机 SSH 默认密码 |
| `43.143.227.210` | 测试云公网 IP |
| `flyfishphp.cn` / `wab.flyfishphp` | 测试域名 |
| `gen-offline-license.mjs` | 签发工具路径（客户源码中不应出现） |
| `license-dev-private.pem` | 私钥文件名 |

### 2.5 构建产物与依赖缓存（.gitignore 覆盖）

```
node_modules/
dist/
*.vsix
*.tgz
.env
.env.local
```

---

## 3. 推荐交付流程

### 首次

```bash
bun deploy/enterprise/skycode/export.ts --clone https://github.com/yoyoabc/skycode.git ../skycode-publish
cd ../skycode-publish
git add -A && git commit -m "feat(enterprise): skycode delivery"
git push -u origin main
```

### 日常更新（增量，推荐）

```bash
# kilocode-main 内开发、验收通过后：
bun deploy/enterprise/skycode/export.ts ../skycode-publish
cd ../skycode-publish
git add -A && git commit -m "feat(enterprise): <说明>"
git push origin main
```

- 默认**增量**到已有 git 克隆：保留提交历史，**不要** `git push --force`。
- 导出结束会打印 `git status` 与下一步命令。
- 供应商侧检查：`export.ts` 自动调用 `script/check-skycode-push.ts`（不进客户仓）。

### 异常时全量重置

```bash
bun deploy/enterprise/skycode/export.ts --fresh ../skycode-publish
```

清空目录树（**保留 `.git`**）后重写。仅在增量状态混乱时使用。

---

## 4. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.1 | 2026-07-10 | export.ts 默认增量同步到已有 git clone；`--clone` / `--fresh` |
