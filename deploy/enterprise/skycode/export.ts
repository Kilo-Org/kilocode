#!/usr/bin/env bun
/**
 * 按 deploy/enterprise/skycode/MANIFEST.md 导出 skycode 客户仓。
 *
 * 用法:
 *   bun deploy/enterprise/skycode/export.ts [输出目录]
 *   bun deploy/enterprise/skycode/export.ts --clone https://github.com/yoyoabc/skycode.git [输出目录]
 *   bun deploy/enterprise/skycode/export.ts --fresh [输出目录]   # 清空后全量（保留 .git）
 *
 * 默认：增量覆盖已有目录，保留 .git 与客户本地文件（如 samples/license-public.pem）。
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const SRC = path.resolve(import.meta.dir, "../../..")

const args = process.argv.slice(2)
const fresh = args.includes("--fresh")
const cloneIdx = args.indexOf("--clone")
const cloneUrl = cloneIdx >= 0 ? args[cloneIdx + 1] : undefined
const outArg = args.find((a) => !a.startsWith("--") && a !== cloneUrl)
const OUT = path.resolve(outArg ?? path.join(SRC, "..", "skycode-publish"))

const pkgIncludes = [
  "packages/opencode",
  "packages/kilo-vscode",
  "packages/sdk/js",
  "packages/core",
  "packages/script",
  "packages/kilo-gateway",
  "packages/kilo-indexing",
  "packages/kilo-telemetry",
  "packages/kilo-i18n",
  "packages/kilo-ui",
  "packages/ui",
  "packages/plugin",
  "packages/plugin-atomic-chat",
  "packages/http-recorder",
  "packages/llm",
]

const rootIncludes = [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "patches",
  "turbo.json",
  "tsconfig.json",
  "install",
  "LICENSE",
  ".editorconfig",
  ".gitattributes",
  ".oxlintrc.json",
  ".prettierignore",
]

const deployRm = [
  "deploy/enterprise/mock-license.mjs",
  "deploy/enterprise/scripts/gen-offline-license.mjs",
  "deploy/enterprise/scripts/pack-for-cloud.ps1",
  "deploy/enterprise/scripts/check-cloud-env.sh",
  "deploy/enterprise/scripts/smoke-phase2-all.sh",
  "deploy/enterprise/scripts/verify-mvp.ps1",
  "deploy/enterprise/scripts/run-mvp-acceptance.ps1",
  "deploy/enterprise/scripts/local-dev.ps1",
  "deploy/enterprise/samples/offline-license.signed.json",
  "deploy/enterprise/samples/license-dev-public.pem",
  "deploy/enterprise/samples/license-dev-private.pem",
  "deploy/enterprise/caddy",
  "deploy/enterprise/nginx",
  "deploy/enterprise/dist",
  "deploy/enterprise/skycode",
  "deploy/enterprise/env/test.cloud.logto.env.sample",
  "deploy/enterprise/.env.cloud.example",
  "packages/kilo-vscode/script/package-yoyo.ts",
]

/** 每次导出都从客户仓删掉的路径（旧版残留 / 黑名单） */
const vendorPurge = [
  "docs/enterprise",
  "scripts",
  "script",
  "packages/yoyo-auth",
  "packages/kilo-jetbrains",
  "packages/kilo-docs",
  "packages/storybook",
  "kilocode-cloud.tgz",
  ...deployRm,
]

const skipInTree = new Set(["node_modules", ".git", "dist", "bin", ".turbo", "ts-dist", ".artifacts"])

const skipFile = (name: string) => name.endsWith(".vsix") || name.endsWith(".bun-build") || name.endsWith(".tgz")

const gitDir = () => path.join(OUT, ".git")

const isGitRepo = () => existsSync(gitDir())

const copyTree = (from: string, to: string) => {
  if (!existsSync(from)) return
  mkdirSync(path.dirname(to), { recursive: true })
  const st = statSync(from)
  if (st.isFile()) {
    cpSync(from, to)
    return
  }
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    if (skipInTree.has(name)) continue
    if (skipFile(name)) continue
    copyTree(path.join(from, name), path.join(to, name))
  }
}

const relFiles = (dir: string, base = ""): Set<string> => {
  const out = new Set<string>()
  if (!existsSync(dir)) return out
  const st = statSync(dir)
  if (st.isFile()) {
    out.add(base || path.basename(dir))
    return out
  }
  for (const name of readdirSync(dir)) {
    if (skipInTree.has(name)) continue
    if (skipFile(name)) continue
    const rel = base ? `${base}/${name}` : name
    const abs = path.join(dir, name)
    const child = statSync(abs)
    if (child.isFile()) out.add(rel)
    else for (const sub of relFiles(abs, rel)) out.add(sub)
  }
  return out
}

const pruneTree = (srcDir: string, outDir: string, base = "") => {
  if (!existsSync(outDir)) return
  const st = statSync(outDir)
  if (st.isFile()) return
  const srcSet = relFiles(srcDir, base)
  for (const name of readdirSync(outDir)) {
    if (skipInTree.has(name)) continue
    const rel = base ? `${base}/${name}` : name
    const srcAbs = path.join(srcDir, name)
    const outAbs = path.join(outDir, name)
    if (!existsSync(srcAbs)) {
      rmSync(outAbs, { recursive: true, force: true })
      continue
    }
    if (statSync(outAbs).isDirectory()) {
      pruneTree(srcAbs, outAbs, rel)
      if (existsSync(outAbs) && readdirSync(outAbs).length === 0) rmSync(outAbs, { recursive: true, force: true })
      continue
    }
    if (!srcSet.has(rel)) rmSync(outAbs, { force: true })
  }
}

const rmRel = (rel: string) => {
  const abs = path.join(OUT, rel)
  if (!existsSync(abs)) return
  rmSync(abs, { recursive: true, force: true })
}

const write = (rel: string, text: string) => {
  const abs = path.join(OUT, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, text)
}

const patch = (rel: string, fn: (s: string) => string) => {
  const abs = path.join(OUT, rel)
  if (!existsSync(abs)) return
  writeFileSync(abs, fn(readFileSync(abs, "utf8")))
}

const wipeExceptGit = () => {
  if (!existsSync(OUT)) return
  for (const name of readdirSync(OUT)) {
    if (name === ".git") continue
    rmSync(path.join(OUT, name), { recursive: true, force: true })
  }
}

const prepareOut = () => {
  if (cloneUrl && !existsSync(OUT)) {
    console.log(`[export] git clone ${cloneUrl} -> ${OUT}`)
    const r = spawnSync("git", ["clone", cloneUrl, OUT], { stdio: "inherit" })
    if (r.status !== 0) process.exit(r.status ?? 1)
    return
  }
  if (!existsSync(OUT)) {
    mkdirSync(OUT, { recursive: true })
    return
  }
  if (fresh) {
    console.log("[export] --fresh: wipe tree (keep .git)")
    wipeExceptGit()
  } else if (isGitRepo()) {
    console.log("[export] incremental sync into existing git clone")
  } else {
    console.log("[export] incremental sync into existing directory")
  }
}

const syncSources = () => {
  for (const rel of rootIncludes) {
    const from = path.join(SRC, rel)
    const to = path.join(OUT, rel)
    copyTree(from, to)
    if (existsSync(from) && statSync(from).isDirectory()) pruneTree(from, to)
  }
  for (const rel of pkgIncludes) {
    const from = path.join(SRC, rel)
    const to = path.join(OUT, rel)
    copyTree(from, to)
    pruneTree(from, to)
  }
  const deployFrom = path.join(SRC, "deploy/enterprise")
  const deployTo = path.join(OUT, "deploy/enterprise")
  copyTree(deployFrom, deployTo)
  pruneTree(deployFrom, deployTo)

  const pkgRoot = path.join(OUT, "packages")
  if (existsSync(pkgRoot)) {
    const keep = new Set(pkgIncludes.map((p) => p.split("/")[1]))
    for (const name of readdirSync(pkgRoot)) {
      if (!keep.has(name)) rmSync(path.join(pkgRoot, name), { recursive: true, force: true })
    }
  }
}

const purgeVendor = () => {
  for (const rel of vendorPurge) rmRel(rel)
}

const sanitizeEnv = (s: string) => {
  const lines = s.split("\n").filter((line) => {
    if (line.includes("LICENSE_MOCK_BIND")) return false
    if (line.includes("license mock") || line.includes("License mock")) return false
    return true
  })
  return lines
    .map((line) => {
      if (!line.includes("docs/enterprise")) return line
      if (line.trimStart().startsWith("#")) return "# 部署说明见 deploy/enterprise/README.md"
      return line.replace(/docs\/enterprise\/[^\s)`]+/g, "deploy/enterprise/README.md")
    })
    .map((line) => line.replace(/仅写在云机/g, "仅写在"))
    .map((line) => line.replace(/\.env\.cloud\.example/g, "deploy/enterprise/env/"))
    .join("\n")
}

const sanitizeEnvFiles = () => {
  const root = path.join(OUT, "deploy/enterprise")
  for (const name of [".env.example"]) {
    patch(`deploy/enterprise/${name}`, sanitizeEnv)
  }
  const envDir = path.join(root, "env")
  if (!existsSync(envDir)) return
  for (const name of readdirSync(envDir)) {
    if (!name.endsWith(".sample")) continue
    patch(`deploy/enterprise/env/${name}`, sanitizeEnv)
  }
}

const sanitizeCustomerDocs = () => {
  patch("deploy/enterprise/docker-compose.yml", (s) =>
    s
      .replace(
        /# Build engine image first: see docs\/enterprise\/PHASE1-DEPLOY\.md/,
        "# Build engine image first: see deploy/enterprise/README.md",
      )
      .replace(
        /# 仅当宿主机 80\/443 空闲时使用。云机已有宝塔 Nginx 时请用 nginx\/README\.md，勿启本服务。/,
        "# 仅当宿主机 80/443 空闲时使用；生产环境通常由现有反向代理终止 TLS。",
      ),
  )

  write(
    "deploy/enterprise/platform/README.md",
    `# enterprise-platform

企业控制面 Go 服务 + 嵌入式管理后台（\`/admin/\`）。

## Docker Compose

\`\`\`bash
cd deploy/enterprise
docker compose --profile platform up -d --build enterprise-platform
./scripts/smoke-phase2.sh
\`\`\`

生产镜像使用 \`go build -tags production\`：License 导入须 RSA 签名。本地 \`go run\` 为开发构建，勿用于生产。

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | \`/admin/\` | 管理后台 |
| GET/PUT | \`/api/v1/model-config\` | 模型配置 |
| POST | \`/api/v1/model-config/apply\` | 下发 Engine 配置 |
| GET | \`/api/v1/tenants\` | 租户 |
| GET | \`/api/v1/usage/summary\` | 用量 |
| GET | \`/api/v1/monitor/health\` | 健康检查 |
| GET | \`/api/v1/audit/logs\` | 审计日志 |

详见 [deploy/enterprise/README.md](../../README.md)。
`,
  )

  write(
    "deploy/enterprise/platform/admin/README.md",
    `# Admin 管理后台

Ant Design Pro 源码：\`../admin-ui/\`。构建产物在 \`internal/admin/static/\`，由 Platform 在 \`/admin/\` 提供。

## 本地开发

\`\`\`bash
cd deploy/enterprise/platform/admin-ui
npm install
npm run dev
npm run build
\`\`\`

生产环境使用 OIDC 登录。开发环境可在 \`PLATFORM_AUTH_DEV=1\` 时使用邮箱登录（勿用于生产）。
`,
  )

  write(
    "deploy/enterprise/platform/admin-ui/README.md",
    `# Enterprise Admin UI

React + Umi Max + Ant Design Pro。

## 开发

\`\`\`bash
npm install
npm run dev
\`\`\`

代理 \`/api\` → Platform \`8090\`。开发登录：\`admin@enterprise.local\`（需 \`PLATFORM_AUTH_DEV=1\`）。

## 构建

\`\`\`bash
npm run build
\`\`\`

产物同步至 \`../internal/admin/static/\`，随后重建 \`enterprise-platform\` 镜像。
`,
  )
}

const applyPatches = () => {
  cpSync(path.join(SRC, "deploy/enterprise/skycode/gitignore"), path.join(OUT, ".gitignore"))
  patch(".gitignore", (s) =>
    s
      .replace(/^deploy\/enterprise\/scripts\/gen-offline-license\.mjs\n/m, "# license signing scripts (vendor-only)\n")
      .concat("\n*.bun-build\n"),
  )

  patch("packages/kilo-vscode/src/enterprise/license-crypto.ts", (s) =>
    s.replace(/\n\/\*\* Dev\/test helper[\s\S]*$/, "\n"),
  )

  write(
    "packages/kilo-vscode/tests/unit/enterprise-license-offline.test.ts",
    `import * as crypto from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterEach, describe, expect, it } from "bun:test"
import { offlinePayloadBytes, verifyRsaSha256 } from "../../src/enterprise/license-crypto"
import { parseOfflineLicense } from "../../src/enterprise/license"

const tmpFiles: string[] = []

afterEach(() => {
  for (const file of tmpFiles) {
    try {
      fs.unlinkSync(file)
    } catch {
      // ignore
    }
  }
  tmpFiles.length = 0
})

function writeLicense(data: object) {
  const file = path.join(os.tmpdir(), \`license-\${Date.now()}-\${Math.random()}.json\`)
  fs.writeFileSync(file, JSON.stringify(data))
  tmpFiles.push(file)
  return file
}

function devKeys() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
}

function sign(payload: { key: string; expiresAt: string }, privateKey: string) {
  const canonical = JSON.stringify({ expiresAt: payload.expiresAt, key: payload.key })
  return crypto.sign("RSA-SHA256", Buffer.from(canonical), crypto.createPrivateKey(privateKey)).toString("base64")
}

describe("license-crypto", () => {
  it("verify RSA-SHA256 payload", () => {
    const keys = devKeys()
    const payload = { key: "k1", expiresAt: "2099-01-01T00:00:00.000Z" }
    const sig = sign(payload, keys.privateKey)
    expect(verifyRsaSha256(payload, sig, keys.publicKey)).toBe(true)
  })

  it("uses stable canonical bytes", () => {
    const payload = { key: "a", expiresAt: "2099-01-01T00:00:00.000Z" }
    expect(offlinePayloadBytes(payload).toString()).toBe('{"expiresAt":"2099-01-01T00:00:00.000Z","key":"a"}')
  })
})

describe("parseOfflineLicense", () => {
  it("returns null when file missing", () => {
    expect(parseOfflineLicense("", "k")).toBeNull()
  })

  it("accepts RSA-signed license", () => {
    const keys = devKeys()
    const payload = { key: "offline-rsa", expiresAt: "2099-01-01T00:00:00.000Z" }
    const signature = sign(payload, keys.privateKey)
    const file = writeLicense({ ...payload, signature, algorithm: "RSA-SHA256" })
    expect(parseOfflineLicense(file, "offline-rsa", keys.publicKey)?.reason).toBe("offline_rsa")
  })

  it("rejects bad RSA signature", () => {
    const keys = devKeys()
    const file = writeLicense({
      key: "offline-rsa",
      expiresAt: "2099-01-01T00:00:00.000Z",
      signature: Buffer.from("bad").toString("base64"),
    })
    expect(parseOfflineLicense(file, "offline-rsa", keys.publicKey)?.reason).toBe("offline_bad_signature")
  })
})
`,
  )

  patch("deploy/enterprise/platform/migrations/000003_seed.up.sql", (s) =>
    s.replace(
      /INSERT INTO licenses[\s\S]*?ON CONFLICT \(license_key\) DO NOTHING;\s*\n/,
      "-- Licenses: import vendor-signed file via admin UI (no seed keys).\n\n",
    ),
  )

  write(
    "deploy/enterprise/samples/offline-license.example.json",
    `{
  "key": "your-license-key",
  "expiresAt": "2027-12-31T23:59:59.000Z",
  "signature": "<vendor-supplied-base64-signature>",
  "algorithm": "RSA-SHA256"
}
`,
  )

  write(
    "deploy/enterprise/samples/LICENSE-PUBLIC-KEY.md",
    `# License 验签公钥

部署前由软件供应商提供 \`license-public.pem\`，放置于本目录并挂载到 Platform：

\`\`\`bash
cp /path/from/vendor/license-public.pem deploy/enterprise/samples/license-public.pem
\`\`\`

在 \`.env\` 中设置：

\`\`\`
PLATFORM_LICENSE_PUBLIC_KEY_PATH=/samples/license-public.pem
\`\`\`
`,
  )

  patch("deploy/enterprise/docker-compose.yml", (s) => {
    let out = s.replace(/\n  license-mock:[\s\S]*?restart: unless-stopped\n\n/, "\n")
    out = out.replace(/admin@flyfishphp\.cn/g, "admin@example.com")
    out = out.replace(/PLATFORM_AUTH_DEV: \$\{PLATFORM_AUTH_DEV:-1\}/, "PLATFORM_AUTH_DEV: ${PLATFORM_AUTH_DEV:-0}")
    out = out.replace(
      /PLATFORM_LICENSE_PUBLIC_KEY_PATH: \$\{PLATFORM_LICENSE_PUBLIC_KEY_PATH:-\/samples\/license-dev-public\.pem\}/,
      "PLATFORM_LICENSE_PUBLIC_KEY_PATH: ${PLATFORM_LICENSE_PUBLIC_KEY_PATH:-/samples/license-public.pem}",
    )
    out = out.replace(
      /- \.\/samples\/license-dev-public\.pem:\/samples\/license-dev-public\.pem:ro\n/,
      "      - ./samples/license-public.pem:/samples/license-public.pem:ro\n",
    )
    return out
  })

  patch("deploy/enterprise/env/test.cloud.phase2.env.sample", (s) => {
    let out = sanitizeEnv(s)
    out = out.replace(/PLATFORM_AUTH_DEV=1/, "PLATFORM_AUTH_DEV=0")
    if (out.includes("docs/enterprise") || !out.includes("idp.example.com")) {
      out = out.replace(
        /# SSO[^\n]*\n(?:# PLATFORM_OIDC[^\n]*\n)*/,
        `# SSO（示例 — 替换为客户 IdP）
# PLATFORM_OIDC_ISSUER=https://idp.example.com/oidc
# PLATFORM_OIDC_CLIENT_ID=<app-id>
# PLATFORM_OIDC_CLIENT_SECRET=<app-secret>
# PLATFORM_OIDC_REDIRECT_URL=https://<platform-domain>/api/v1/auth/callback
# PLATFORM_OIDC_VSCODE_URI=vscode://yoyo-local.yoyo-code/enterprise/callback
`,
      )
    }
    return out.split("\n").filter((line) => !line.includes("43.143.227.210")).join("\n")
  })

  patch("deploy/enterprise/env/test.cloud.ruiyumaas.env.sample", (s) =>
    s.replace(/^# 测试云 43\.143\.227\.210.*\n/, "# Enterprise deploy — Ruiyu MaaS sample\n"),
  )

  patch("packages/kilo-vscode/src/gatekeeper/login-html.ts", (s) =>
    s.replace(/https:\/\/wab\.flyfishphp\.cn/g, "https://<your-platform-domain>"),
  )

  patch("packages/kilo-vscode/package.json", (s) =>
    s.replace(/企业网关地址（如 https:\/\/wab\.flyfishphp\.cn）/, "企业网关地址（如 https://<your-platform-domain>）"),
  )

  write(
    "deploy/enterprise/README.md",
    `# Enterprise 私有化部署

企业控制面（Platform + Admin）、Kilo Engine、网关与 VS Code 扩展源码。

## 组件

| 路径 | 说明 |
|---|---|
| \`docker-compose.yml\` | Engine、Qdrant、Platform（profile \`platform\`）、网关（profile \`gateway\`） |
| \`platform/\` | Go API + 管理后台（Ant Design Pro） |
| \`apisix/\`、\`bridge/\` | API 网关与桥接 |
| \`config/\` | Engine 模型配置模板 |
| \`env/\` | 环境变量样例 |

## 快速启动（Platform）

\`\`\`bash
cd deploy/enterprise
cp env/test.cloud.phase2.env.sample .env
# 编辑 .env：PLATFORM_PG_PASSWORD、PLATFORM_JWT_SECRET、OIDC 等
cp /path/from/vendor/license-public.pem samples/license-public.pem
docker compose --profile platform up -d --build postgres redis enterprise-platform
./scripts/smoke-phase2.sh
\`\`\`

生产环境请设置 \`PLATFORM_AUTH_DEV=0\`，禁用开发直登。

## License 激活（客户）

1. 使用供应商提供的离线 License 文件（\`.json\`）。
2. 登录管理后台 → **租户** → **上传授权文件** → **激活**。
3. 详见 \`samples/LICENSE-PUBLIC-KEY.md\`（验签公钥部署）。

授权文件由**软件供应商**在客户环境外签发；本仓库仅包含验签与导入逻辑。

## VS Code 扩展

\`\`\`bash
cd packages/kilo-vscode
bun install
bun run compile
\`\`\`
`,
  )

  write(
    "README.md",
    `# skycode — 企业私有化 AI 编程工具

基于 Kilo 引擎的私有化交付源码：VS Code 扩展、CLI/Engine、企业管理后台（Platform）。

## 目录

| 路径 | 说明 |
|---|---|
| \`packages/opencode/\` | Kilo CLI / Engine |
| \`packages/kilo-vscode/\` | VS Code 扩展（企业版） |
| \`deploy/enterprise/\` | Docker Compose、Platform、部署脚本 |

## 环境要求

- [Bun](https://bun.sh) 1.3+
- Docker（部署 Platform / Engine）
- Go 1.22+（本地开发 Platform 时）

## 开始

\`\`\`bash
bun install
cd deploy/enterprise && cp env/test.cloud.phase2.env.sample .env
# 配置 .env 与 samples/license-public.pem（由供应商提供）
docker compose --profile platform up -d --build
\`\`\`

详细步骤见 [deploy/enterprise/README.md](./deploy/enterprise/README.md)。

## License

见仓库根目录 \`LICENSE\`。企业授权文件由供应商单独签发，通过管理后台上传激活。
`,
  )

  sanitizeEnvFiles()
  sanitizeCustomerDocs()
}

const runCheck = () => {
  const check = spawnSync("bun", [path.join(SRC, "script/check-skycode-push.ts"), "--root", OUT], {
    cwd: SRC,
    encoding: "utf8",
  })
  if (check.stdout) console.log(check.stdout)
  if (check.stderr) console.error(check.stderr)
  if (check.status !== 0) {
    console.error("[export] check-skycode-push FAILED")
    process.exit(check.status ?? 1)
  }
}

const gitHint = () => {
  if (!isGitRepo()) {
    console.log("\n[export] 未检测到 .git。首次发布可执行：")
    console.log(`  cd ${OUT}`)
    console.log("  git init && git branch -M main")
    console.log("  git remote add origin https://github.com/yoyoabc/skycode.git")
    console.log("  git add -A && git commit -m \"feat(enterprise): skycode delivery\"")
    console.log("  git push -u origin main")
    return
  }
  const status = spawnSync("git", ["status", "--short"], { cwd: OUT, encoding: "utf8" })
  const lines = status.stdout?.trim().split("\n").filter(Boolean) ?? []
  console.log(`\n[export] git: ${lines.length} changed file(s)`)
  if (lines.length > 0) {
    for (const line of lines.slice(0, 12)) console.log(`  ${line}`)
    if (lines.length > 12) console.log(`  ... +${lines.length - 12} more`)
  }
  console.log("\n[export] 下一步（普通 push，无需 --force）：")
  console.log(`  cd ${OUT}`)
  console.log("  git add -A && git commit -m \"feat(enterprise): <本次说明>\"")
  console.log("  git push origin main")
}

console.log(`[export] ${SRC} -> ${OUT}`)
prepareOut()
syncSources()
purgeVendor()
applyPatches()
console.log("[export] patches done")
runCheck()
console.log(`[export] OK -> ${OUT}`)
gitHint()
