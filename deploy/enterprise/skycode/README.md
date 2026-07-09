# skycode 客户仓准备

将本 monorepo 中**企业私有化交付代码**发布到客户 GitHub 仓（如 `yoyoabc/skycode`）前的工具包。

| 文件 | 作用 |
|---|---|
| [MANIFEST.md](./MANIFEST.md) | **白名单 / 黑名单** 完整清单 |
| [DELIVERY-WORKFLOW.md](./DELIVERY-WORKFLOW.md) | **日常开发后提交 skycode 的步骤** |
| [gitignore](./gitignore) | 复制到 skycode 根目录为 `.gitignore` |
| [export.ts](./export.ts) | 增量/全量导出 + 供应商侧检查 |
| [../../script/check-skycode-push.ts](../../script/check-skycode-push.ts) | 供应商推送前检查（**不进 skycode**） |

## 首次发布

```bash
# 克隆远程仓到固定工作目录（推荐长期复用）
bun deploy/enterprise/skycode/export.ts --clone https://github.com/yoyoabc/skycode.git ../skycode-publish

cd ../skycode-publish
git add -A && git commit -m "feat(enterprise): skycode delivery"
git push -u origin main
```

## 日常更新（增量，保留 git 历史）

完整步骤见 **[DELIVERY-WORKFLOW.md](./DELIVERY-WORKFLOW.md)**。

```bash
# 在 kilocode-main 开发完成后：
bun deploy/enterprise/skycode/export.ts ../skycode-publish

cd ../skycode-publish
git add -A && git commit -m "feat(enterprise): <本次变更说明>"
git push origin main
```

- **默认增量**：覆盖白名单文件、删除黑名单残留，**保留 `.git`** 与客户本地文件（如 `samples/license-public.pem`）。
- **无需 `--force`**：正常 `git push` 即可。

## 全量重置（少用）

```bash
bun deploy/enterprise/skycode/export.ts --fresh ../skycode-publish
```

清空导出目录（**保留 `.git`**）后重新写入。仅当增量状态异常时使用。

## 注意

- 本目录 **不复制给客户**；仅供应商内网仓保留。
- License **签发**工具不得进入 skycode；客户仅保留验签与后台上传。
- 默认工作目录：`../skycode-publish`（与 `kilocode-main` 同级，可长期保留一个 git clone）。
