# skycode 客户仓 — 日常开发与提交流程

> **读者**：软件供应商研发（内网 `kilocode-main`）  
> **客户仓**：https://github.com/yoyoabc/skycode  
> **本地工作目录**（推荐固定）：`../skycode-publish`（与 `kilocode-main` 同级）

相关文件：

| 文件 | 作用 |
|---|---|
| [MANIFEST.md](./MANIFEST.md) | 白名单 / 黑名单 |
| [export.ts](./export.ts) | 增量导出 + 自动脱敏 |
| [../../script/check-skycode-push.ts](../../script/check-skycode-push.ts) | 推送前检查（不进客户仓） |

---

## 一、原则

1. **日常只在 `kilocode-main` 开发**，不要直接在 `skycode-publish` 改业务代码。
2. 给客户更新 = **导出快照** → **commit** → **普通 push**（不要 `git push --force`）。
3. License **签发**、内部 Phase 文档、云机脚本 **永不进** skycode（见 MANIFEST 黑名单）。
4. `export.ts` 会自动：删黑名单、裁剪 License 签名、脱敏 env/README、跑 `check-skycode-push`。

---

## 二、首次准备（做一次即可）

```bash
# 在 kilocode-main 仓库根目录
bun deploy/enterprise/skycode/export.ts --clone https://github.com/yoyoabc/skycode.git ../skycode-publish
```

之后长期复用 `../skycode-publish` 这一个 git 克隆。

---

## 三、每次功能开发完成后的提交流程

### 1. 在内网仓完成开发与自测

```bash
cd d:/ai/kilocode-main

# 按需：Platform / 扩展 / CLI 相关检查
cd deploy/enterprise/platform && go test ./internal/usage/...
cd packages/kilo-vscode && bun run typecheck
```

若改了 Admin UI（`deploy/enterprise/platform/admin-ui/`），导出前需先构建静态资源：

```bash
cd deploy/enterprise/platform/admin-ui
npm run build    # → internal/admin/static/
```

### 2. 导出到客户工作目录

```bash
cd d:/ai/kilocode-main
bun deploy/enterprise/skycode/export.ts ../skycode-publish
```

- 默认 **增量**：覆盖白名单文件，保留 `.git` 与客户本地文件（如 `samples/license-public.pem`）。
- 脚本结束应显示：`[skycode-check] PASSED`。
- 若失败：按提示修 `kilocode-main` 后重跑 export，**不要**手动改 `skycode-publish` 里的业务代码。

目录被占用删不掉时，可换输出路径，例如 `../skycode-publish-20260710`，但长期建议只维护一个目录。

### 3. 查看变更并提交

```bash
cd ../skycode-publish
git status
git diff --stat

git add -A
git commit -m "feat(enterprise): <本次变更说明>"
```

提交信息建议用英文 conventional commits，scope 用 `enterprise`，示例：

- `feat(enterprise): usage assessment tab and export API`
- `fix(enterprise): platform license import validation`
- `chore: scrub internal doc refs from customer deliverable`

### 4. 推送到 GitHub

```bash
git push origin main
```

**不要**使用 `--force`，除非仓库历史损坏且与客户已确认。

### 5. 交付配套（邮件 / 工单）

随版本提供给客户（不进 Git 或单独安全通道）：

| 项 | 说明 |
|---|---|
| 变更说明 | 功能、配置变更、升级注意点 |
| `license-public.pem` | 仅当验签公钥变更时 |
| 离线 License `.json` | 续期 / 新授权时，由供应商内网 `gen-offline-license.mjs` 签发 |
| VSIX（若交付插件） | 单独附件，一般不放进 skycode 仓 |

---

## 四、异常处理

### export 检查失败

```bash
# 在 kilocode-main 单独跑检查，看完整报错
bun script/check-skycode-push.ts --root ../skycode-publish --strict
```

常见原因：新文件含测试 IP、密码、`docs/enterprise` 路径、Mock License 配置。在 **kilocode-main** 修源码或补 `export.ts` 脱敏规则后重跑 export。

### 增量状态混乱

```bash
bun deploy/enterprise/skycode/export.ts --fresh ../skycode-publish
```

清空导出目录（**保留 `.git`**）后全量重写，再 `commit` + `push`。

### Admin 后台文案/UI 未更新

确认已执行 `admin-ui` 的 `npm run build`，再跑 export（静态文件在 `platform/internal/admin/static/`）。

---

## 五、不要提交到 skycode 的内容（速查）

详见 [MANIFEST.md §2](./MANIFEST.md)。核心：

- `docs/enterprise/` 全部内部文档
- 根目录 `scripts/`（云机运维）
- `gen-offline-license.mjs`、`mock-license.mjs`、已签名 License、`.pem`
- `deploy/enterprise/skycode/`（本工具包本身）
- `*.vsix`、`*.tgz`、`*.bun-build`

---

## 六、命令速查

```bash
# 日常三板斧（kilocode-main 根目录）
bun deploy/enterprise/skycode/export.ts ../skycode-publish
cd ../skycode-publish && git add -A && git commit -m "feat(enterprise): ..." && git push origin main
```

---

## 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1 | 2026-07-10 | 增量导出 + 日常 commit/push 流程 |
