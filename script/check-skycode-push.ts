#!/usr/bin/env bun
/**
 * skycode 客户仓推送前检查。
 * 用法（在 skycode 仓库根目录）：
 *   bun run script/check-skycode-push.ts
 *   bun run script/check-skycode-push.ts --strict   # 未跟踪的敏感文件也失败
 */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const rootFlag = process.argv.indexOf("--root")
const ROOT =
  rootFlag >= 0 ? path.resolve(process.argv[rootFlag + 1]!) : path.resolve(import.meta.dir, "..")
const STRICT = process.argv.includes("--strict")
const SELF = path.relative(ROOT, import.meta.path).replaceAll("\\", "/")

type rule = { label: string; test: (rel: string) => boolean }

const forbiddenPaths: rule[] = [
  { label: "内部交付文档", test: (f) => f === "docs/enterprise" || f.startsWith("docs/enterprise/") },
  { label: "云机运维脚本目录", test: (f) => f === "scripts" || f.startsWith("scripts/") },
  { label: "License 签发工具", test: (f) => f === "deploy/enterprise/scripts/gen-offline-license.mjs" },
  { label: "Mock License 服务", test: (f) => f === "deploy/enterprise/mock-license.mjs" },
  { label: "已签名 License 样本", test: (f) => f === "deploy/enterprise/samples/offline-license.signed.json" },
  { label: "License 公钥样本", test: (f) => f === "deploy/enterprise/samples/license-dev-public.pem" },
  { label: "License 私钥", test: (f) => f.endsWith("license-dev-private.pem") },
  { label: "VSIX 构建产物", test: (f) => f.endsWith(".vsix") },
  { label: "云打包归档", test: (f) => f.endsWith(".tgz") || f === "kilocode-cloud.tgz" },
  { label: "内网 yoyo 打包脚本", test: (f) => f === "packages/kilo-vscode/script/package-yoyo.ts" },
  { label: "yoyo-auth 扩展", test: (f) => f === "packages/yoyo-auth" || f.startsWith("packages/yoyo-auth/") },
  { label: "测试域 Nginx 配置", test: (f) => f.startsWith("deploy/enterprise/nginx/") },
  { label: "测试域 Caddy 配置", test: (f) => f.startsWith("deploy/enterprise/caddy/") },
  { label: "临时密钥/授权", test: (f) => f.startsWith("tmp-") || f === "tmp-cloud-license.json" || f === "tmp-cloud-public.pem" },
]

const forbiddenStrings: { pattern: string; reason: string; allow?: string[] }[] = [
  { pattern: "fcb326XYZ0!@#", reason: "云机 SSH 默认密码" },
  { pattern: "43.143.227.210", reason: "测试云公网 IP" },
  { pattern: "flyfishphp.cn", reason: "测试域名" },
  { pattern: "wab.flyfishphp", reason: "测试子域" },
  {
    pattern: "gen-offline-license.mjs",
    reason: "License 签发工具引用",
    allow: [
      "deploy/enterprise/skycode/MANIFEST.md",
      "script/check-skycode-push.ts",
      "deploy/enterprise/skycode/gitignore",
      "deploy/enterprise/skycode/README.md",
      "deploy/enterprise/skycode/export.ts",
    ],
  },
  {
    pattern: "docs/enterprise/",
    reason: "内部交付文档路径",
    allow: [
      "deploy/enterprise/skycode/MANIFEST.md",
      "script/check-skycode-push.ts",
      "deploy/enterprise/skycode/export.ts",
      ".gitignore",
    ],
  },
  {
    pattern: "LICENSE_MOCK_BIND",
    reason: "Mock License 服务端口（已移除）",
    allow: ["deploy/enterprise/skycode/export.ts", "script/check-skycode-push.ts"],
  },
  {
    pattern: "PHASE2-PLAN.md",
    reason: "内部 Phase 计划文档引用",
    allow: ["deploy/enterprise/skycode/export.ts", "script/check-skycode-push.ts"],
  },
  {
    pattern: "signRsaSha256",
    reason: "客户端 License 私钥签名能力（客户仓应仅验签）",
    allow: [
      "deploy/enterprise/skycode/MANIFEST.md",
      "script/check-skycode-push.ts",
      "packages/kilo-vscode/tests/unit/enterprise-license-offline.test.ts",
    ],
  },
]

const requiredPaths = [
  "package.json",
  "packages/opencode",
  "packages/kilo-vscode",
  "deploy/enterprise/platform",
  "deploy/enterprise/docker-compose.yml",
]

const isAllowed = (file: string, allow?: string[]) => {
  if (!allow) return false
  return allow.some((prefix) => file === prefix || file.startsWith(prefix))
}

const git = (args: string[]) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : ""
}

const listTracked = (): string[] => {
  const out = git(["ls-files", "-z"])
  if (!out) return []
  return out.split("\0").filter(Boolean)
}

const listUntracked = (): string[] => {
  const out = git(["ls-files", "-z", "--others", "--exclude-standard"])
  if (!out) return []
  return out.split("\0").filter(Boolean)
}

const walk = (dir: string, base = ""): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue
    const rel = base ? `${base}/${name}` : name
    const abs = path.join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) out.push(...walk(abs, rel))
    else out.push(rel.replaceAll("\\", "/"))
  }
  return out
}

const matchPathRules = (files: string[]) => {
  const hits: string[] = []
  for (const file of files) {
    if (file === SELF) continue
    for (const rule of forbiddenPaths) {
      if (rule.test(file)) {
        hits.push(`[路径] ${file} — ${rule.label}`)
        break
      }
    }
  }
  return hits
}

const scanContent = async (files: string[]) => {
  const hits: string[] = []
  for (const file of files) {
    if (file === SELF) continue
    const abs = path.join(ROOT, file)
    if (!existsSync(abs)) continue
    const st = statSync(abs)
    if (!st.isFile() || st.size > 2_000_000) continue
    const text = await Bun.file(abs).text().catch(() => "")
    if (!text) continue
    for (const rule of forbiddenStrings) {
      if (isAllowed(file, rule.allow)) continue
      if (text.includes(rule.pattern)) {
        hits.push(`[内容] ${file} — 含「${rule.pattern}」(${rule.reason})`)
      }
    }
  }
  return hits
}

const main = async () => {
  console.log(`[skycode-check] root=${ROOT}`)
  const errors: string[] = []

  const tracked = listTracked()
  const files = tracked.length > 0 ? tracked : walk(ROOT)
  if (tracked.length === 0) {
    console.warn("[skycode-check] 非 git 仓库或未跟踪文件 — 扫描工作区全部文件")
  }

  errors.push(...matchPathRules(files))

  if (STRICT) {
    errors.push(...matchPathRules(listUntracked()))
  }

  errors.push(...(await scanContent(files)))

  for (const req of requiredPaths) {
    const ok = existsSync(path.join(ROOT, req))
    if (!ok) errors.push(`[缺失] 白名单必需路径不存在: ${req}`)
  }

  if (errors.length > 0) {
    console.error(`\n[skycode-check] FAILED — ${errors.length} 项:\n`)
    for (const e of errors) console.error(`  • ${e}`)
    console.error("\n修复后重试。清单: deploy/enterprise/skycode/MANIFEST.md\n")
    process.exit(1)
  }

  console.log("[skycode-check] PASSED — 可推送到 skycode 客户仓")
}

await main()
